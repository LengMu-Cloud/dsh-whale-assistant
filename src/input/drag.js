		/* --- dragging (pointer events, click suppressed after a move) --- */
		var drag = null;
		var clickTimer = null;
		var caughtFlag = false;
		/* I-①-3（0.4.3 阶段 C）：单击/双击区分阈值收口——硬编码 260 曾与红标
		 * badgeClickTimer（bootstrap.js BADGE_CLICK_VS_DBL_MS）同值不同源，
		 * 改一漏一即行为分叉。模块独立不跨文件共享常量（build 全 IIFE 共享
		 * 作用域的重名禁令），两处各自文件顶部具名。 */
		var CLICK_VS_DBL_MS = 260;

		/** Quick trembling shake of the whale's body (used when caught). */
		function caughtShake() {
			if (!figure) return;
			var poses = ['rotate(-6deg)', 'rotate(5deg)', 'rotate(-4deg)', 'rotate(3deg)', ''];
			var i = 0;
			var shakeStep = function () {
				if (i >= poses.length) return;
				figure.style.transition = 'transform 0.08s ease';
				figure.style.transform = poses[i++];
				setTimeout(shakeStep, 80);
			};
			shakeStep();
		}

		whale.addEventListener('pointerdown', function (event) {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			/* the first interaction also unlocks the audio context */
			ensureAudio();
			/* touching the whale closes any open float immediately */
			closeCtxFloats();
			/* grabbing mid-swim: catch feedback (bubble + splash + shake) */
			var caught = cancelSwim();
			caughtFlag = false;
			if (caught) {
				caughtFlag = true;
				uiSay(pickCatchLine(), 2600);
				spawnWaterSplash(
					whale.offsetLeft + whale.offsetWidth / 2,
					whale.offsetTop + whale.offsetHeight * 0.8,
					2, 0, 6
				);
				caughtShake();
			}
			drag = {
				id: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				left: whale.offsetLeft,
				top: whale.offsetTop,
				moved: false
			};
			try {
				whale.setPointerCapture(event.pointerId);
			} catch (error) {
				/* unsupported */
			}
			whale.classList.add('dsh-whale-dragging');
		});

		whale.addEventListener('pointermove', function (event) {
			if (!drag || drag.id !== event.pointerId) return;
			var dx = event.clientX - drag.startX;
			var dy = event.clientY - drag.startY;
			if (Math.abs(dx) + Math.abs(dy) > 4) {
				if (!drag.moved) touchActivity(); /* starting to drag wakes the whale */
				drag.moved = true;
			}
			if (drag.moved) {
				applyPos(drag.left + dx, drag.top + dy);
				/* re-flow the open status panel live while dragging, so it
				 * never runs off the viewport edge */
				updateStatusPos();
			}
		});

		function finishDrag(event) {
			if (!drag || drag.id !== event.pointerId) return false;
			var moved = drag.moved;
			drag = null;
			whale.classList.remove('dsh-whale-dragging');
			if (moved) {
				savePos();
				updateStatusPos();
			}
			return moved;
		}

		whale.addEventListener('pointerup', function (event) {
			/* only the left button interacts (right-click is reserved) */
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			if (finishDrag(event)) return;
			/* a catch already gave its feedback; don't overwrite with a click summary */
			if (caughtFlag) {
				caughtFlag = false;
				return;
			}
			/* click: delay briefly so a double-click can cancel it */
			if (clickTimer) {
				clearTimeout(clickTimer);
				clickTimer = null;
				return;
			}
			clickTimer = setTimeout(function () {
				clickTimer = null;
				spawnRipple(event.clientX, event.clientY); /* click-confirmed halo (#13) */
				wiggle();
				/* an explicit click on the whale closes open floats */
				closeCtxFloats();
				if (asleep) {
					/* napping: a click gets a sleepy mumble, no wake-up */
					uiSay('呼… Zzz 别吵我 🥱', 2000);
					return;
				}
				if (readNext()) return;
				/* nothing new to read: if a read is still displayed, finish it now,
				 * so a lingering badge "1" clears on the next click */
				if (reading) {
					clearTimeout(readTimer);
					reading = null;
					renderUnread();
				}
				uiSay(clickSummary());
			}, CLICK_VS_DBL_MS);
		});

		whale.addEventListener('pointercancel', function (event) {
			finishDrag(event);
			caughtFlag = false;
		});

		whale.addEventListener('dblclick', function (event) {
			if (clickTimer) {
				clearTimeout(clickTimer);
				clickTimer = null;
			}
			/* a double-click whose presses land ON the bubble (or drift a
			 * few pixels onto the whale) jumps to that conversation — the
			 * bubble is an independent surface, never the whale's body */
			var onBubble = false;
			var t = event && event.target;
			if (t && t !== whale && bubble.contains(t)) onBubble = true;
			if (!onBubble && event && typeof event.clientX === 'number') {
				onBubble = inBubbleRect(event.clientX, event.clientY);
			}
			if (onBubble) {
				jumpToBubbleSession();
				return;
			}
			/* swimming away also closes any open float (menu/wardrobe/help/
			 * history/settings) so the UI never leaves an orphaned drawer */
			closeCtxFloats();
			touchActivity(); /* double-clicking to swim wakes the whale */
			swimToCorner();
		});

		/* no hover tooltip (user request): the native title flashed its
		 * gesture list on every accidental hover — the same list now lives
		 * in the 右键菜单 → 📖 使用说明 drawer (menu.js openHelp) */

		loadPos();

		/* BUG-1 boot 推 + 采用缝（11-16 实机验收）：桌宠中继端口每-boot 随机 →
		 * pet 页 origin 变 → localStorage 失忆。origin 幸存时本地落点补推服务端
		 * （账本缺货兜底，与 pushPetConfig boot 一推同款）；origin 全新（重启
		 * 后端口变了）本地无存量——不推，等 /pet/state 下发经 _petSyncPos 采用
		 * （seatFromAnchor 自带对称钳制，窗口形状无关）。 */
		if (loadPos()) {
			posSyncKnown = true;   /* 本地存量=本 boot 权威值（v2 锚点或 legacy x/y） */
			var bootAnchor = PET_MODE ? anchorFromStorage() : null;
			if (bootAnchor && typeof bootAnchor.rx === 'number' && typeof bootAnchor.by === 'number') {
				pushPetSync({ pos: { rx: bootAnchor.rx, by: bootAnchor.by, x: bootAnchor.x, y: bootAnchor.y } });
			}
		}
		window.__dshWhale._petSyncPos = function (pos) {
			if (!pos || posSyncKnown) return;
			if (typeof pos.rx !== 'number' || typeof pos.by !== 'number') return;
			posSyncKnown = true;
			try {
				seatFromAnchor(pos.rx, pos.by);
				/* 落盘与 savePos 同构（v2 锚点 + x/y 兜底）：此后 resize 重摆、
				 * 下一次 savePos 都从这份锚点出发。 */
				safeSet(POS_KEY, { v: 2, rx: pos.rx, by: pos.by, x: whale.offsetLeft, y: whale.offsetTop });
			} catch (e) {}
		};

		/* 桌宠入场（第一批）：PET_MODE 下落位后同步执行——首帧即画在「落点
		 * 向屏幕中心回拉」的拉入位，随后游向最近边缘（弧线+涟漪+到达水花+
		 * 引导台词），uiInit 同步无跳变。见 swim.js petEntranceSwim。 */
		if (PET_MODE) {
			try { petEntranceSwim(); } catch (e) {}
		}

		/* nap timer starts at page load: 5 idle minutes -> sleep
		 * (defensive clear: drag.js must never leave a stale timer around —
		 * the shared sleepTimer var belongs to core/sleep.js) */
		clearTimeout(sleepTimer);
		sleepTimer = setTimeout(goSleep, sleepMsOverride || SLEEP_AFTER_MS);

		/* diagnostic seam for tests */
		window.__dshWhale.swimToCorner = swimToCorner;
		window.__dshWhale.swimState = function () {
			return swim;
		};
		window.__dshWhale.whale = whale;
		window.__dshWhale.openCtxMenu = openCtxMenu;
		/* ⑳真机六追修（11-17 用户拍板）：桌宠 flyout 行首图标缝——🔄 等已收录
		 * 字形复用本图标集（跨面板一致），🖥️ 由 page.html 走 DSH 官方图标
		 * （img 槽）；未收录字形返回 null=裸 emoji 照旧 */
		window.__dshWhale.menuIcon = function (glyph) {
			var spec = ICON_PATHS[glyph];
			return spec ? buildIconSvg(spec) : null;
		};
		window.__dshWhale.petWhale = petWhale;
		window.__dshWhale.ctxMenuOpen = function () {
			return !!(ctxMenu && ctxMenu.classList.contains('show'));
		};
		window.__dshWhale.ctxMenuEl = function () {
			return ctxMenu;
		};
		window.__dshWhale.panelOpen = function () {
			return !!(ctxPanel && ctxPanel.classList.contains('show'));
		};
		window.__dshWhale.panelEl = function () {
			return ctxPanel;
		};
		window.__dshWhale.openHistory = openHistory;
		/* openSettings export retired (11-08): the drawer is gone — settings
		 * live on the sidebar page (panel-page.js via window.__dshWhalePanel) */
		window.__dshWhale.openReminders = openReminders;
		/* reminder fire loop seam (回归 11-14): due-consume + triple chime */
		window.__dshWhale._fireReminders = fireDueReminders;
		window.__dshWhale.openHealthPanel = openHealthPanel;
		/* heart spawner lives in the uiInit closure — mood.js idle hearts and
		 * milestone celebrations reach it through this seam */
		window.__dshWhale.spawnHearts = spawnHearts;
		window.__dshWhale.CONFIG = CONFIG;
		window.__dshWhale.historyList = function () {
			return history;
		};
		window.__dshWhale.pushHistory = pushHistory;
		window.__dshWhale.getClearAt = getClearAt;
		window.__dshWhale.bumpClearAt = bumpClearAt;
		window.__dshWhale.drawerOpen = function () {
			return !!(ctxHistory && ctxHistory.classList.contains('show'));
		};
		window.__dshWhale.drawerEl = function () {
			return ctxHistory;
		};

		/* drain messages queued before the UI was ready */
		pendingSay.forEach(function (message) {
			uiSay(message.text, message.duration, message.sessionId);
		});
		pendingSay = [];
		renderUnread();
	}
