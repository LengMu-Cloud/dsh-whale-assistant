	function uiInit() {
		var whaleEl = document.getElementById('dsh-whale');
		if (!whaleEl) return;
		whale = whaleEl;
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
			var sessionId = currentSaySession;
			if (!sessionId) {
				uiSay('这条消息没有对应的对话哦 🐳', 2000);
				return;
			}
			var opener = window.__dshOpenSession;
			if (typeof opener !== 'function') {
				uiSay('跳转功能需要刷新页面（插件未加载）', 2500);
				return;
			}
			/* the report's endTime (the moment THIS report is about) lets the
			 * host page back to that message — on a SAME-session jump (the
			 * alpha adapter only tracks the current conversation) open() alone
			 * would be a no-op with zero visible feedback */
			var rep = reading || lastShownReport;
			var atMs = rep && typeof rep.endTime === 'number' ? rep.endTime : undefined;
			try {
				opener(sessionId, atMs);
				/* jumping to the conversation counts as reading the report:
				 * the badge drops by one and the notification leaves the
				 * queue (it must NOT still pop up from the red badge later) */
				markBubbleRead();
				/* keep the session attached to the bubble — the feedback
				 * must not clear currentSaySession or the NEXT double-click
				 * would lose the conversation */
				uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
			} catch (error) {
				/* the jump failed: the report stays unread */
				uiSay('找不到对应的对话 🥲', 2000, sessionId);
			}
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

