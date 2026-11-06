	function uiInit() {
		var whaleEl = document.getElementById('dsh-whale');
		if (!whaleEl) return;
		whale = whaleEl;
		/* 开机防双鲸（11-05 第三层，用户实报「一打开 DSH 就两只小金鱼，DSH
		 * 的闪一下才消失」）：非桌宠页**元素创建即隐藏**——不信任缓存 0
		 * （每次关 DSH 桌宠跟随死亡都会把缓存写成 0，冷开必踩 spawn 窗口
		 * =这不是罕见路径，是每次冷开的必经路径）。唤醒只走两条正路：
		 * ①权威状态（hello/轮询/pet/state 帧，force 破幂等）——宿主活着
		 * 时 <1s；②6s 兜底 reveal（仅「从未见过权威状态且内存态非休眠」
		 * ——宿主死/无桌宠宿主的降级场景）。缓存 1 的开机不踩兜底。 */
		if (!PET_MODE) {
			whaleEl.style.display = 'none';
			setTimeout(function () {
				if (!petStateEverSeen() && !petDormant) applyPetDormant(false, true);
			}, 6000);
		}
		uiReady = true;

		var bubble = document.createElement('div');
		bubble.className = 'dsh-whale-bubble';
		whale.appendChild(bubble);

		/** Mark the report currently shown in the bubble as READ: remove it
		 * from the unread queue (or resolve an in-flight replay), so the
		 * badge drops by one. Called after a double-click jump — the report
		 * the user just acted on must not still be waiting in the queue. */
		function markBubbleRead() {
			if (reading) {
				clearTimeout(readTimer);
				reading = null;
			} else if (lastShownReport) {
				var idx = reportQueue.indexOf(lastShownReport);
				if (idx >= 0) reportQueue.splice(idx, 1);
			}
			lastShownReport = null;
			renderUnread();
		}

		/** Jump to the conversation behind the CURRENT bubble (double-click
		 * on the bubble, or on a spot that overlaps it). Idle summaries
		 * carry no session and only get a hint. */
		function jumpToBubbleSession() {
			/* 桌宠（11-03 真跳转）：通知挂着枚举化合成会话（session-pet-sN），
			 * 桌宠页没有跳转桥也没有 DSH DOM——但宿主持有 编号→真实会话 的
			 * 反查表。POST /pet/ctrl jump 让宿主广播 pet/jump（页鲸用自己的
			 * 跳转桥执行切换），同时请桌宠宿主把 DSH 窗口拉到前台——用户在
			 * 桌宠上双击通知，落地就是「DSH 到眼前+停在目标对话」。 */
			if (PET_MODE) {
				var sid = currentSaySession || '';
				var m = sid.match(/^session-pet-s(\d+)$/);
				if (!m) {
					uiSay('这条消息没有对应的对话哦 🐳', 2000);
					return;
				}
				var code = parseInt(m[1], 10);
				/* 时间锚点（11-06，用户实报「跳的是对话不是任务节点」）：与页鲸
				 * 分支同源——当前通知报告的 endTime（这条报告所指的那次任务完
				 * 成时刻）。宿主原样回传 pet/jump，页鲸 openSessionAt(sid, atMs)
				 * 的翻页回溯把那条消息滚进视野。 */
				var repAt = reading || lastShownReport;
				var atMs = repAt && typeof repAt.endTime === 'number' ? repAt.endTime : undefined;
				uiSay('正在打开对话… 🐳', 1800);
				try {
					if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
						/* the pet shell raises the DSH window (jump 落点必须可见） */
						window.chrome.webview.postMessage({ c: 'jump' });
					}
				} catch (e) { /* non-pet shell: window switch is best-effort */ }
				fetch('/api/whale-assistant/pet/ctrl', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'jump', code: code, atMs: atMs })
				}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
					if (out && out.ok === true && out.delivered === false) {
						/* 常驻语义（11-06）：关窗≠退出——DSH 窗口关着时页鲸不在场
						 * （宿主广播 pet/jump 无人消费），跳转落不了地。通知**保留
						 * 未读**（红标不掉），用户重开 DSH 后再双击还能定位到任务
						 * 节点——比默默标已读丢了通知诚实得多。 */
						uiSay('DSH 窗口已关闭——打开 DSH 后再点我跳转吧 🐳', 3500);
					} else if (out && out.ok === true) {
						/* jumping counts as reading the report (same contract as
						 * the page whale): the badge drops and the notification
						 * leaves the queue */
						markBubbleRead();
					} else {
						uiSay('通知已过期，回 DSH 看看吧 🐳', 2500);
					}
				}).catch(function () { /* network hiccup: the shell switch already happened */ });
				return;
			}
			var sessionId = currentSaySession;
			if (!sessionId) {
				uiSay('这条消息没有对应的对话哦 🐳', 2000);
				return;
			}
			/* the report's endTime (the moment THIS report is about) lets the
			 * jump page back to that message — on a SAME-session jump (the
			 * alpha adapter only tracks the current conversation) open() alone
			 * would be a no-op with zero visible feedback */
			var rep = reading || lastShownReport;
			var atMs = rep && typeof rep.endTime === 'number' ? rep.endTime : undefined;
			/* 0.4.0: in-house jump (client-module bridge) with the sidebar as
			 * fallback tail — the bridge carries no title, so the sidebar
			 * tail looks the name up in the address book */
			var jumped = false;
			if (jumpReady()) {
				jumped = openSessionAt(sessionId, atMs);
				if (!jumped) {
					/* the bridge jumped but the session is gone: the report
					 * stays unread (same contract as the old hook) */
					uiSay('找不到对应的对话 🥲', 2000, sessionId);
					return;
				}
			} else if (openViaSidebarById(sessionId) || openViaSidebarByTitle(sessionTitles.get(sessionId) || bookTitle(sessionId) || '')) {
				jumped = true;
			}
			if (!jumped) {
				uiSay('跳转功能需要刷新页面（插件未加载）', 2500);
				return;
			}
			/* jumping to the conversation counts as reading the report:
			 * the badge drops by one and the notification leaves the
			 * queue (it must NOT still pop up from the red badge later) */
			markBubbleRead();
			/* keep the session attached to the bubble — the feedback
			 * must not clear currentSaySession or the NEXT double-click
			 * would lose the conversation */
			uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
		}

		/** Is viewport (x, y) inside the bubble's rendered rectangle?
		 * getBoundingClientRect when available, otherwise an estimate (the
		 * bubble floats above the whale, right-aligned with an 8px overhang).
		 * Used so a double-click whose second press drifts a few pixels off
		 * the bubble onto the whale still counts as a bubble double-click —
		 * the bubble must NEVER behave like the whale's own body. */
		function inBubbleRect(x, y) {
			var b = document.querySelector('.dsh-whale-bubble');
			if (!b) return false;
			var r = null;
			if (typeof b.getBoundingClientRect === 'function') {
				r = b.getBoundingClientRect();
			}
			if (r) {
				return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
			}
			var w = b.offsetWidth || 0;
			var h = b.offsetHeight || 0;
			var left = whale.offsetLeft + whale.offsetWidth - w + 8;
			var top = whale.offsetTop - h - 12;
			return x >= left && x <= left + w && y >= top && y <= top + h;
		}

		/** Double-click the notification bubble: jump to the conversation it
		 * belongs to (task reports and attention requests carry a session;
		 * idle summaries do not). Stops propagation so the whale's own
		 * double-click (swim home) never sees it. */
		bubble.addEventListener('dblclick', function (event) {
			event.stopPropagation();
			jumpToBubbleSession();
		});

		var badge = document.createElement('div');
		badge.className = 'dsh-whale-badge';
		whale.appendChild(badge);

		/* gear groups live inside the whale SVG (whale-logo.svg); the zzz
		 * nap indicator is a plain HTML element on top */
		var zzz = document.createElement('div');
		zzz.className = 'dsh-whale-zzz';
		zzz.textContent = '💤';
		whale.appendChild(zzz);

		var figure = whale.querySelector('svg');
		/* reveal any gear already unlocked from a previous visit */
		unlockCheck();

		onUnreadChange = function (count) {
			if (count > 0) {
				badge.textContent = count > UNREAD_CAP ? UNREAD_CAP + '+' : String(count);
				badge.style.display = 'block';
				/* pop animation on every count change */
				badge.classList.remove('pop');
				void badge.offsetWidth;
				badge.classList.add('pop');
			} else {
				badge.style.display = 'none';
			}
		};

		/* badge: single click reads one report, double-click clears everything */
		var badgeClickTimer = null;
		badge.addEventListener('pointerdown', function (event) {
			event.stopPropagation();
		});
		badge.addEventListener('pointerup', function (event) {
			event.stopPropagation();
			if (event.pointerType === 'mouse' && event.button !== 0) return; /* right-click = menu only, left reads */
			if (badgeClickTimer) {
				clearTimeout(badgeClickTimer);
				badgeClickTimer = null;
				return;
			}
			badgeClickTimer = setTimeout(function () {
				badgeClickTimer = null;
				if (!readNext()) uiSay(clickSummary());
			}, 260);
		});
		badge.addEventListener('dblclick', function (event) {
			event.stopPropagation();
			if (badgeClickTimer) {
				clearTimeout(badgeClickTimer);
				badgeClickTimer = null;
			}
			clearAllUnread();
		});

		/** Clear every unread report at once. */
		function clearAllUnread() {
			if (reportQueue.length === 0 && !reading) {
				wiggle();
				uiSay('没有未读通知哦 🐋', 2000);
				return;
			}
			var cleared = reportQueue.length + (reading ? 1 : 0);
			reportQueue.length = 0;
			if (typeof readTimer === 'number') clearTimeout(readTimer);
			reading = null;
			renderUnread();
			clearTimeout(uiSay.timer);
			var bub = document.querySelector('.dsh-whale-bubble');
			if (bub) bub.classList.remove('show');
			wiggle();
			/* faint count feedback (#10): the number answers "清了多少条" —
			 * no bubble, no bell, no unread, auto-fades */
			showWhaleNote('已清空 ' + cleared + ' 条通知', 3000);
		}

