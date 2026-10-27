		/* --- right-click: single click opens the menu, double right-click
		 * pets the whale (affection +1). --- */
		var ctxMenu = null;
		var ctxPanel = null;
		var lastCtxAt = 0;
		var CTX_DBL_MS = 400;
		var CTX_MENU_W = 180;

		function closeCtxMenu() {
			if (ctxMenu) ctxMenu.classList.remove('show');
		}
		function closeCtxPanel() {
			if (ctxPanel) ctxPanel.classList.remove('show');
		}
		function closeCtxFloats() {
			closeCtxMenu();
			closeCtxPanel();
			closeCtxHistory();
		}

		/* ---- 内联 SVG 图标集（P1 2026-10-28）----
		 * P0 用 20px 定宽槽解决了对齐，但 emoji 本体在各平台字形/配色仍不可控
		 * （Segoe UI Emoji vs Apple Color Emoji）。P1 把字形换成 16×16 stroke
		 * 风格的内联 SVG：stroke=currentColor 跟随面板文字色，跨平台一致。
		 * emoji 原文保留在 0 尺寸 ghost span 里——textContent 逐字节不变，
		 * 测试与读屏口径同 P0；未收录字形回落 P0 emoji 槽（新菜单项零成本）。 */
		var ICON_SVG_NS = 'http://www.w3.org/2000/svg';
		var ICON_PATHS = {
			'⏰': [['circle', { cx: 8, cy: 8.7, r: 5.1 }], ['path', { d: 'M8 6.3v2.6l1.9 1.1' }], ['path', { d: 'M2.8 3.2l1.8-1.2M13.2 3.2l-1.8-1.2' }]],
			'⏱️': [['circle', { cx: 8, cy: 9, r: 5 }], ['path', { d: 'M6.7 2.4h2.6M8 2.4v1.7M8 9l1.8-1.8' }]],
			'⏳': [['path', { d: 'M4.7 2.5h6.6M4.7 13.5h6.6M5.7 2.5v1.8c0 1.3 2.3 2.2 2.3 3.7s-2.3 2.4-2.3 3.7v1.8M10.3 2.5v1.8c0 1.3-2.3 2.2-2.3 3.7s2.3 2.4 2.3 3.7v1.8' }]],
			'➕': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M8 5.4v5.2M5.4 8h5.2' }]],
			'❌': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2' }]],
			'✅': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M5.3 8.3l1.9 1.9 3.5-4.3' }]],
			'❓': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M6.3 6.4c.2-.9 1-1.5 1.8-1.5.9 0 1.6.6 1.6 1.5 0 1.1-1.6 1.3-1.6 2.4' }], ['circle', { cx: 8, cy: 11.1, r: 0.8, fill: 'currentColor' }]],
			'🔔': [['path', { d: 'M8 2.4c-2.5 0-4 1.9-4 4.1v2.7L2.8 11.6h10.4L12 9.2V6.5c0-2.2-1.5-4.1-4-4.1z' }], ['path', { d: 'M6.7 13.5a1.3 1.3 0 0 0 2.6 0' }]],
			'🔊': [['path', { d: 'M3.1 6.2h2.2L8.9 3.2v9.6L5.3 9.8H3.1z' }], ['path', { d: 'M11 5.9a3.2 3.2 0 0 1 0 4.2M13 3.9a6.1 6.1 0 0 1 0 8.2' }]],
			'🔇': [['path', { d: 'M3.1 6.2h2.2L8.9 3.2v9.6L5.3 9.8H3.1z' }], ['path', { d: 'M10.9 6.3l3.3 3.3M14.2 6.3l-3.3 3.3' }]],
			'📖': [['path', { d: 'M8 4.4C7.1 3.5 5.3 3.1 2.9 3.3v9.3c2.4-.2 4.2.2 5.1 1.1.9-.9 2.7-1.3 5.1-1.1V3.3C10.7 3.1 8.9 3.5 8 4.4z' }], ['path', { d: 'M8 4.4v9.3' }]],
			'🎨': [['path', { d: 'M8 2.7a5.3 5.3 0 1 0 0 10.6c.9 0 1.4-.5 1.2-1.2-.3-.9.3-1.6 1.3-1.6h1.1c1.2 0 1.9-.9 1.9-2.3A5.6 5.6 0 0 0 8 2.7z' }], ['circle', { cx: 5.6, cy: 6, r: 0.9, fill: 'currentColor' }], ['circle', { cx: 8.4, cy: 4.9, r: 0.9, fill: 'currentColor' }], ['circle', { cx: 10.9, cy: 7, r: 0.9, fill: 'currentColor' }]],
			'📜': [['rect', { x: 4.1, y: 2.7, width: 7.8, height: 10.6, rx: 1 }], ['path', { d: 'M6.3 5.7h3.4M6.3 8.1h3.4M6.3 10.5h2.3' }]],
			'⚙️': [['circle', { cx: 8, cy: 8, r: 4.2 }], ['circle', { cx: 8, cy: 8, r: 1.6 }], ['path', { d: 'M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2' }]],
			'🔄': [['path', { d: 'M13.2 8A5.2 5.2 0 1 1 11.6 4.2' }], ['path', { d: 'M13.5 1.8v2.6h-2.6' }]],
			'❤️': [['path', { d: 'M8 13.1S2.9 9.9 2.9 6.4c0-1.7 1.3-2.9 2.8-2.9 1 0 1.9.5 2.3 1.4.4-.9 1.3-1.4 2.3-1.4 1.5 0 2.8 1.2 2.8 2.9 0 3.5-5.1 6.7-5.1 6.7z', fill: 'currentColor' }]],
			'🌙': [['path', { d: 'M13 9.7A5.4 5.4 0 0 1 6.3 3a5.4 5.4 0 1 0 6.7 6.7z' }]],
			'🚨': [['path', { d: 'M8 3.1L2.7 12.4h10.6L8 3.1z' }], ['path', { d: 'M8 6.8v2.6' }], ['circle', { cx: 8, cy: 11.2, r: 0.8, fill: 'currentColor' }]],
			'📊': [['path', { d: 'M3.2 12.8h9.6M5.2 12.8V8.8M8 12.8V5.2M10.8 12.8V7.2' }]],
			'📤': [['path', { d: 'M3.1 9.4v3.2h9.8V9.4' }], ['path', { d: 'M8 2.8v6.3M5.9 7L8 9.1 10.1 7' }]],
			'🩺': [['path', { d: 'M2.2 8.3h2.9l1.5-3.9 2.7 6.9 1.5-3h3' }]],
			'🎵': [['path', { d: 'M6.3 11.9V4.3l5.1-1.1v7.5' }], ['circle', { cx: 4.8, cy: 11.9, r: 1.4, fill: 'currentColor' }], ['circle', { cx: 9.9, cy: 10.7, r: 1.4, fill: 'currentColor' }]],
			'☕': [['path', { d: 'M3.5 5.9h8v3.4a3.1 3.1 0 0 1-3.1 3.1H6.6a3.1 3.1 0 0 1-3.1-3.1z' }], ['path', { d: 'M11.5 6.7h.8a1.6 1.6 0 0 1 0 3.2h-.9' }]],
			'⛑️': [['path', { d: 'M3.6 10.3a4.4 4.4 0 0 1 8.8 0' }], ['path', { d: 'M2.4 10.3h11.2M8 5.9v4.4' }]]
		};
		/** Build the inline SVG for one icon spec: stroke defaults come from
		 * here so specs carry geometry only (fill:'currentColor' opts in). */
		function buildIconSvg(spec) {
			var svg = document.createElementNS(ICON_SVG_NS, 'svg');
			svg.setAttribute('viewBox', '0 0 16 16');
			svg.setAttribute('class', 'dsh-whale-ico-svg');
			svg.setAttribute('aria-hidden', 'true');
			for (var i = 0; i < spec.length; i++) {
				var node = document.createElementNS(ICON_SVG_NS, spec[i][0]);
				var attrs = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
				var over = spec[i][1];
				for (var k in over) attrs[k] = over[k];
				for (var k2 in attrs) node.setAttribute(k2, attrs[k2]);
				svg.appendChild(node);
			}
			return svg;
		}

		/** Leading-icon wrapper (P0 UI polish 2026-10-27 / P1 SVG 2026-10-28):
		 * emoji glyph width AND look vary by platform (Segoe UI Emoji vs Apple
		 * Color Emoji), so the leading glyph is rendered as a 16×16 stroke SVG
		 * inside the fixed 20px slot (.dsh-whale-ico) — all labels on one
		 * straight left edge, identical glyphs everywhere. The emoji text
		 * itself survives in a 0-size ghost span: textContent stays
		 * byte-identical (tests and screen readers see no change). Glyphs not
		 * in the icon table fall back to the P0 emoji slot. */
		function setIconLabel(el, text) {
			var sp = text.indexOf(' ');
			var glyph = sp >= 1 && sp <= 4 ? text.slice(0, sp) : '';
			var spec = glyph ? ICON_PATHS[glyph] : null;
			el.textContent = '';
			if (spec) {
				var ic = document.createElement('span');
				ic.className = 'dsh-whale-ico';
				ic.appendChild(buildIconSvg(spec));
				var ghost = document.createElement('span');
				ghost.className = 'dsh-whale-ico-ghost';
				ghost.textContent = glyph;
				ic.appendChild(ghost);
				el.appendChild(ic);
				el.appendChild(document.createTextNode(text.slice(sp)));
				return;
			}
			if (!glyph) { el.textContent = text; return; }
			var ic0 = document.createElement('span');
			ic0.className = 'dsh-whale-ico';
			ic0.textContent = glyph;
			el.appendChild(ic0);
			el.appendChild(document.createTextNode(text.slice(sp)));
		}

		/** Sub-panel footer. Back follows the navigation hierarchy
		 * 菜单 → 设置 → 子面板 (user request): panels entered from the
		 * right-click menu (提醒我) return TO THE MENU; panels entered from
		 * settings (音色/周报/运行状态) return to settings. */
		function mkPanelFoot(panel, onClose, backToMenu) {
			var foot = document.createElement('div');
			foot.className = 'dsh-whale-panel-foot';
			var backBtn = document.createElement('div');
			backBtn.className = 'dsh-whale-wardrobe-close dsh-whale-panel-back';
			if (backToMenu) {
				backBtn.textContent = '← 返回菜单';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxPanel();
					openCtxMenu(whale.offsetLeft + 6, Math.max(8, whale.offsetTop - 12));
				});
			} else {
				backBtn.textContent = '← 返回设置';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					openSettings();
				});
			}
			foot.appendChild(backBtn);
			var closeBtn = document.createElement('div');
			closeBtn.className = 'dsh-whale-wardrobe-close';
			closeBtn.textContent = '✕ 关闭';
			closeBtn.addEventListener('click', function (event) {
				event.stopPropagation();
				if (onClose) onClose();
				else closeCtxPanel();
			});
			foot.appendChild(closeBtn);
			panel.appendChild(foot);
		}

		/** Hearts float up from the whale's head (pet reaction, milestone
		 * celebration, idle affection — count defaults to the full burst). */
		function spawnHearts(count) {
			var layer = ensureRippleLayer();
			if (!layer) return;
			var x = whale.offsetLeft + whale.offsetWidth / 2;
			var y = whale.offsetTop + whale.offsetHeight * 0.3;
			var parts = [];
			var i;
			var total = count || 7;
			for (i = 0; i < total; i++) {
				var h = document.createElement('div');
				h.className = 'dsh-whale-heart';
				/* U+2764 + U+FE0E: force the TEXT variant so the CSS color
				 * (pink) applies — without the variation selector most
				 * platforms render the emoji face and ignore the color */
				h.textContent = '\u2764\uFE0E';
				h.style.left = x + 'px';
				h.style.top = y + 'px';
				layer.appendChild(h);
				parts.push({ el: h, delay: i * 60, dx: Math.random() * 70 - 35, up: -(26 + Math.random() * 22) });
			}
			var epoch = null;
			var total = 900;
			function heartsTick(now) {
				if (epoch === null) epoch = now;
				var t = now - epoch;
				var alive = false;
				for (var p = 0; p < parts.length; p++) {
					var part = parts[p];
					var local = t - part.delay;
					if (local < 0) continue;
					var u = local / total;
					if (u >= 1) {
						part.el.style.opacity = '0';
						continue;
					}
					alive = true;
					var ease = 1 - Math.pow(1 - u, 2);
					part.el.style.opacity = String(Math.max(0, 1 - u));
					part.el.style.transform = 'translate(' + (part.dx * ease).toFixed(1) + 'px,' +
						(part.up * Math.sin(Math.PI * Math.min(1, u))).toFixed(1) + 'px)';
				}
				if (alive) {
					requestAnimationFrame(heartsTick);
				} else {
					for (var q = 0; q < parts.length; q++) {
						if (parts[q].el.parentNode) parts[q].el.parentNode.removeChild(parts[q].el);
					}
				}
			}
			requestAnimationFrame(heartsTick);
		}

		/** Right-click double: pet the whale — reaction line + hearts + a
		 * happy bounce, and +1 affection (long-term progression). */
		function petWhale() {
			closeCtxFloats();
			touchActivity(); /* an explicit interaction wakes the whale */
			affection++;
			saveAffection();
			uiSay(petLine(), 3200);
			whale.classList.remove('dsh-whale-pet');
			void whale.offsetWidth;
			whale.classList.add('dsh-whale-pet');
			setTimeout(function () {
				whale.classList.remove('dsh-whale-pet');
			}, 720);
			spawnHearts();
			maybeCelebrateMilestone();
		}

		/** Affection milestones (#12'): crossing 10/50/100 fires a ONE-TIME
		 * bigger heart burst + a dedicated line. Remembered across reloads
		 * via localStorage; the celebration waits ~1.2s so it never tramples
		 * the pet reaction line (achievement-line lesson). */
		var AFF_MILESTONES = [
			{ at: 10, line: '好感度 10！我们熟起来了 🐳💙' },
			{ at: 50, line: '好感度 50！已经是最好的同事了吧 🥰' },
			{ at: 100, line: '好感度 100！这辈子就跟着你混了 🐋❤️✨' }
		];

		function maybeCelebrateMilestone() {
			var done = {};
			try {
				(localStorage.getItem('dsh-whale:affMs') || '').split(',').forEach(function (k) { if (k) done[k] = 1; });
			} catch (e) {}
			for (var i = 0; i < AFF_MILESTONES.length; i++) {
				var m = AFF_MILESTONES[i];
				var key = String(m.at);
				if (affection < m.at || done[key]) continue;
				done[key] = 1;
				try {
					localStorage.setItem('dsh-whale:affMs', Object.keys(done).join(','));
				} catch (e) {}
				setTimeout(function (mm) {
					return function () {
						uiSay(mm.line, 4200);
						spawnHearts(12);
					};
				}(m), 1200);
				return;
			}
		}

		/** Refresh + show the context menu near (clientX, clientY), flipping
		 * at the viewport edges. Content is rebuilt on every open so the
		 * sound label and mood header are always current. */
		function openCtxMenu(clientX, clientY) {
			closeCtxPanel();
			closeCtxHistory();
			var menu = ctxMenu || document.createElement('div');
			menu.className = 'dsh-whale-menu';
			menu.textContent = '';
			/* header: mood + live jobs */
			var head = document.createElement('div');
			head.className = 'dsh-whale-menu-head';
			var liveN = liveJobs().length;
			var moodName = MOOD_STAGES[moodStageIndex()].name;
			head.textContent = '🐳 ' + moodName + (liveN > 0 ? ' · ' + liveN + ' 个任务进行中' : ' · 待命中');
			menu.appendChild(head);
			/* reminder — 快捷操作 group first (#4) */
			var remindItem = document.createElement('div');
			remindItem.className = 'dsh-whale-menu-item';
			var pendingReminders = 0;
			try { pendingReminders = JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]').length; } catch (e) {}
			setIconLabel(remindItem, '⏰ 提醒我' + (pendingReminders > 0 ? '（' + pendingReminders + ' 个待响）' : ''));
			remindItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openReminders();
			});
			menu.appendChild(remindItem);
			/* sound toggle */
			var soundItem = document.createElement('div');
			soundItem.className = 'dsh-whale-menu-item';
			setIconLabel(soundItem, soundMuted ? '🔇 声音：关' : '🔊 声音：开');
			soundItem.addEventListener('click', function (event) {
				event.stopPropagation();
				setSoundMuted(!soundMuted);
				uiSay(soundMuted ? '已静音 🔇' : '声音已开启 🔊', 1800);
				closeCtxMenu();
			});
			menu.appendChild(soundItem);
			/* group separator (#4): 快捷操作 above, 信息与设置 below */
			var menuSep = document.createElement('div');
			menuSep.className = 'dsh-whale-menu-sep';
			menu.appendChild(menuSep);
			/* help */
			var helpItem = document.createElement('div');
			helpItem.className = 'dsh-whale-menu-item';
			setIconLabel(helpItem, '📖 使用说明');
			helpItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHelp();
			});
			menu.appendChild(helpItem);
			/* wardrobe */
			var dressItem = document.createElement('div');
			dressItem.className = 'dsh-whale-menu-item';
			setIconLabel(dressItem, '🎨 我的装扮');
			dressItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openWardrobe();
			});
			menu.appendChild(dressItem);
			/* history */
			var historyItem = document.createElement('div');
			historyItem.className = 'dsh-whale-menu-item';
			setIconLabel(historyItem, '📜 历史任务');
			historyItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHistory();
			});
			menu.appendChild(historyItem);
			/* settings */
			var settingsItem = document.createElement('div');
			settingsItem.className = 'dsh-whale-menu-item';
			setIconLabel(settingsItem, '⚙️ 设置');
			settingsItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openSettings();
			});
			menu.appendChild(settingsItem);
			/* refresh (B-2 desktop): the official desktop binds NO F5/Ctrl+R —
			 * plugin updates and recovery both need a page reload, and the
			 * whale menu is the reachable way to get one */
			var refreshItem = document.createElement('div');
			refreshItem.className = 'dsh-whale-menu-item';
			setIconLabel(refreshItem, '🔄 刷新页面');
			refreshItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				setTimeout(function () { location.reload(); }, 80);
			});
			menu.appendChild(refreshItem);
			if (!ctxMenu) document.body.appendChild(menu);
			ctxMenu = menu;
			/* position near the cursor, flipping at the viewport edges — the
			 * menu's REAL height is measured (the old fixed 170px guess grew
			 * to ~240px with 7 items and clipped the bottom rows off-screen:
			 * 设置 was literally unreachable when the whale sat low) */
			var mw = CTX_MENU_W;
			var mh = menu.offsetHeight || 170;
			var left = clientX;
			var top = clientY;
			if (left + mw > window.innerWidth - 8) left = clientX - mw;
			if (top + mh > window.innerHeight - 8) top = clientY - mh;
			menu.style.left = Math.max(8, left) + 'px';
			menu.style.top = Math.max(8, top) + 'px';
			menu.classList.remove('show');
			void menu.offsetWidth;
			menu.classList.add('show');
		}

		/** Clamp a floating panel near the whale (never off-screen) and show it.
		 * The panel is MEASURED while still invisible (opacity:0 keeps layout)
		 * — fixed size guesses broke as soon as a panel grew (the sound picker
		 * is ~2× the old estimate), pushing its rows off-screen: user-reported
		 * "设置显示不全/点了没反应". Below the whale first; flips above when
		 * there is no room; CSS caps height at the viewport and the panel
		 * scrolls internally. */
		function showFloatingPanel(panel, pw, ph) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || ph;
			var left = Math.round(whale.offsetLeft + whale.offsetWidth / 2 - w / 2);
			var top = whale.offsetTop + whale.offsetHeight + 10; /* prefer below */
			if (top + h > window.innerHeight - 8) top = whale.offsetTop - h - 10; /* flip above */
			if (top < 8) top = Math.max(8, whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			/* hard clamp: even a max-height-tall panel centered on a
			 * mid-screen whale must stay inside the viewport (bottom first,
			 * then top) — the panel scrolls internally beyond this */
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			if (left < 8) left = 8;
			panel.style.left = left + 'px';
			panel.style.top = Math.max(8, top) + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wide drawers (history/weekly report): anchored LEFT of the whale,
		 * flipping to its right when the wall is closer — same measured,
		 * viewport-clamped placement as showFloatingPanel. */
		function showSidePanel(panel, pw) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || Math.min(window.innerHeight - 16, 460);
			var left = whale.offsetLeft - w - 12;
			if (left < 8) left = whale.offsetLeft + whale.offsetWidth + 12;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			var top = Math.round(whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			panel.style.left = Math.max(8, left) + 'px';
			panel.style.top = top + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wardrobe panel: gear progress + affection (dark, same language as
		 * the menu; opens near the whale, clamped to the viewport). */
		function openWardrobe() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-wardrobe';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎨 我的装扮';
			panel.appendChild(title);
			var i;
			for (i = 0; i < GEAR_DEFS.length; i++) {
				var def = GEAR_DEFS[i];
				var row = document.createElement('div');
				row.className = 'dsh-whale-wardrobe-row';
				var unlocked = unlockedGear.has(def.id);
				var leftTxt = document.createElement('span');
				setIconLabel(leftTxt, def.emoji + ' ' + def.name);
				var rightTxt = document.createElement('span');
				if (unlocked) {
					rightTxt.textContent = '✅ 已解锁';
				} else {
					var need = Math.max(0, def.at - gearStats.tasksDone);
					rightTxt.textContent = '还差 ' + need + ' 个任务';
					row.classList.add('dsh-whale-wardrobe-locked');
				}
				row.appendChild(leftTxt);
				row.appendChild(rightTxt);
				panel.appendChild(row);
			}
			var affRow = document.createElement('div');
			affRow.className = 'dsh-whale-wardrobe-row dsh-whale-wardrobe-aff';
			var affL = document.createElement('span');
			setIconLabel(affL, '❤️ 好感度');
			var affR = document.createElement('span');
			affR.textContent = '× ' + affection;
			affRow.appendChild(affL);
			affRow.appendChild(affR);
			panel.appendChild(affRow);
			mkPanelFoot(panel, null, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 210, 200);
		}

		/** 📖 使用说明: the full user manual, one scrollable side drawer.
		 * Covers what the whale is, every notification, every gesture, every
		 * settings row and where the data lives — THE authoritative doc for
		 * end users (the old 8-line gesture cheat sheet grew into this per
		 * user request, 2026-09-04). Lives in the side-drawer slot: wide,
		 * left of the whale, list scrolls, never stacks with other panels. */
		function openHelp() {
			closeCtxPanel();
			closeCtxHistory();
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history dsh-whale-manual';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📖 使用说明 ⚡ v' + PATCH_VERSION;
			panel.appendChild(title);
			/* keyword search (#5): filters rows live, jumps to the first hit */
			var mSearch = document.createElement('input');
			mSearch.className = 'dsh-whale-history-search dsh-whale-manual-search';
			mSearch.placeholder = '搜索说明…（如：红标、音色）';
			mSearch.addEventListener('click', function (event) { event.stopPropagation(); });
			panel.appendChild(mSearch);
			var mStatus = document.createElement('div');
			mStatus.className = 'dsh-whale-manual-status';
			panel.appendChild(mStatus);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			mSearch.addEventListener('input', function () {
				var q = (mSearch.value || '').trim();
				var rows = list.children;
				var n = 0;
				var first = null;
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers always stay visible */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (!first) first = el;
					}
				}
				mStatus.textContent = q ? (n > 0 ? '找到 ' + n + ' 条相关内容' : '未找到相关内容 🔍') : '';
				if (first && typeof first.scrollIntoView === 'function') {
					first.scrollIntoView({ block: 'nearest' });
				}
			});
			var sec = function (t) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				el.textContent = t;
				list.appendChild(el);
			};
			var item = function (term, desc) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				el.appendChild(t);
				if (desc) {
					var d = document.createElement('div');
					d.className = 'dsh-whale-manual-d';
					d.textContent = desc;
					el.appendChild(d);
				}
				list.appendChild(el);
			};
			var gesture = function (n, text) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-help-row';
				var num = document.createElement('span');
				num.className = 'dsh-whale-help-num';
				num.textContent = String(n);
				var text2 = document.createElement('span');
				text2.className = 'dsh-whale-help-text';
				text2.textContent = text;
				row.appendChild(num);
				row.appendChild(text2);
				list.appendChild(row);
			};
			sec('🚀 快速上手');
			item('右键点我：打开菜单', '所有功能都在右键菜单里——提醒我、装扮、历史任务、设置、使用说明。先记住这一个手势就够了。');
			item('点我一下：读通知', '有未读就逐条读给你（红标数字会减）；没有未读就陪我聊一句。');
			item('双击通知气泡：跳回对话', '任何完成/失败/提问通知，双击就能回到那条对话现场。');
			item('拖着我走：位置会记住', '按住我拖到喜欢的角落，刷新后还在这。');
			sec('🐳 我是什么');
			item('打工小鲸鱼，住在 DeepSeek Harness 右下角', '只读任务事件做播报和记录，不拦截、不修改任何任务行为，随便折腾不影响工作。任务在后台跑我也会看着，跑完 3 秒内告诉你。');
			sec('🔔 通知一览');
			item('[对话名]开工了 …', '任务开始跑。不进红标（不算未读）。');
			item('[对话名]完成了 …', '正常结束：响一声 + 红标 +1，下方同时弹出用量面板（本次消耗 / 全对话累计 / 上下文占用），和气泡同生同灭。');
			item('[对话名]失败了 …', '出错了：低沉音 + 红标 +1。双击通知气泡可回去看看。');
			item('[对话名]被截断了 …', '回复顶到 max tokens 上限，任务本身没坏。');
			item('[对话名]被中止了 ✋', '你手动停了任务，不算失败。');
			item('🤔 [对话名]需要你选择', '模型在等你作答：响铃 + 红标 +1。回到对话作答即收尾；任务还没跑完，用量等完成通知再统一看。');
			item('⚠️ [对话名]需要你审核', '有工具调用等你批准：同上。');
			item('上下文快挤爆了…建议 /compact', '上下文占用达到压力阈值时提醒一次。');
			item('⏰ 定时提醒', '右键菜单设的闹钟到点播报（不进红标，不带用量面板）。');
			sec('🐾 交互手势');
			gesture(1, '左键拖动：移动我');
			gesture(2, '左键单击：进行互动（读通知）');
			gesture(3, '左键双击：游回角落（中途可抓住）');
			gesture(4, '双击通知气泡：跳转对应对话');
			gesture(5, '左键单击红标数字：读通知');
			gesture(6, '左键双击红标数字：通知清空');
			gesture(7, '右键：打开菜单');
			gesture(8, '右键双击：触发摸摸头');
			sec('🎛️ 设置项详解');
			item('🔔 开工通知（开/关）', '关掉后"开工了"不再播报，其余通知不受影响。');
			item('🌙 免打扰', '时段内完成/失败不弹泡不响铃，只记红标；需要你动手的选择/审核照常提醒，急事不瞒你。');
			item('🔊 音量', '提示音音量，5 档循环。');
			item('🎵 音色（按通知设置）', '完成/失败/提问、定时提醒四类通知各选各的音效：单声叮 / 叮叮两连击 / 清脆上行 / 低沉下行 / 静音，下拉选中即生效并现场试听。');
			item('⏱️ 工具超时', '某个工具跑超过该时长时提示一次"可能卡住了"（只是提醒，不会打断任务）。');
			item('🚨 压力提醒', '上下文占用达到该百分比时提醒 /compact；回降到 50% 以下后重新武装。');
			item('📊 任务周报', '近 7 天按日统计任务数（完成/失败/中止/提问）与 token 消耗。');
			item('📤 导出历史', 'Markdown：复制全部历史到剪贴板；CSV：下载表格文件。');
			item('🩺 运行状态', '鲸鱼自查各条通知链路（后台通知/用量读取/跳转）；平时全部正常、不打扰，出问题我头上会亮 ⚠️，设置里点"运行状态"能看是哪一条。');
			item('🩺 调试模式', '排障用：开启后往控制台输出调试信息，并把取证数据写进 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。');
			sec('📜 历史与红标');
			item('红标数字 = 未读通知数', '左键单击读一条（读过的消失），双击一键清空。完成/失败/提问/审核计入，开工/提醒不计入。');
			item('📜 历史任务（右键菜单）', '保留最近 50 条：本地 + 服务器双存储，桌面壳和别的浏览器窗口看到同一份；支持搜索、清空、导出。想彻底遗忘某个对话：先清历史、再「清空通讯录」（历史里存的名字快照会在下次加载时回流，两步都做才真正遗忘）。');
			item('跳回对话', '双击通知气泡，或点历史抽屉里的任意一条记录。');
			sec('❤️ 陪伴小彩蛋');
			item('摸摸头', '右键双击我：好感 +1，还有小心心飘出。');
			item('状态与情绪', '任务越多我越累、会打瞌睡（拖一拖或双击我就醒）；右键菜单标题能看当前心情和进行中的任务数。');
			item('装扮与成就', '完成任务攒进度，解锁新装扮后去 右键菜单 → 🎨我的装扮 查看。');
			sec('🙋 常见问题');
			item('怎么没有声音？', '依次看：右键菜单 🔊 声音是否开 → 设置里音量 → 🎵 音色里对应通知是否选了"静音" → 是否在免打扰时段（深夜只记红标不出声）。');
			item('通知突然不来了？', '多半是页面放久了过期：刷新页面即可恢复——官方桌面端没有 F5，用我的右键菜单 🔄 刷新页面；浏览器里按 Ctrl+F5。我自己的链路自检在 设置 → 🩺 运行状态 里，哪条失效会明说。');
			item('插件更新了怎么加载新版？', '同样刷新页面：右键菜单 🔄 刷新页面（桌面端）或 Ctrl+F5（浏览器）——新版本在下次加载时自动生效。');
			item('后台任务会打扰我吗？', '不会：只有完成/失败/需要你动手时才提醒，中间过程只在状态面板安静展示；深夜时段只记红标不出声。');
			item('换浏览器历史还在吗？', '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份；跨机器不同步。');
			item('历史突然变空了？', '极少数情况下账本文件损坏会自动隔离重建，~/.dsh/ 下会出现 whale-assistant.json.corrupt-时间戳 备份文件。想救回：先关 DSH，把文件名末尾的 .corrupt-时间戳 后缀删掉、恢复原名，再启动。');
			panel.appendChild(list);
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			showSidePanel(panel, 380);
		}

		/* ———— 历史抽屉群已拆至 ui/drawers.js（§7 触发线到达，2026-10-27 K3） ———— */

		/** 🎵 音色: per-notification sound picker — 每种通知各选各的音效，
		 * 点选即切换并现场试听。 */
		function openSoundPicker() {
			var KINDS = [
				{ key: 'soundDone', kind: 'done', label: '✅ 完成通知', opts: ['ding', 'bell', 'chime', 'none'] },
				{ key: 'soundFail', kind: 'fail', label: '❌ 失败通知', opts: ['thud', 'ding', 'bell', 'chime', 'none'] },
				{ key: 'soundAttn', kind: 'attention', label: '❓ 提问回答', opts: ['chime', 'ding', 'bell', 'none'] },
				{ key: 'soundRemind', kind: 'remind', label: '⏰ 定时提醒', opts: ['bell', 'ding', 'chime', 'thud', 'none'] }
			];
			var LABELS = { ding: '单声叮', bell: '叮叮（两连击）', chime: '清脆上行', thud: '低沉下行', none: '静音' };
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			/* extra width: label + its dropdown must fit on ONE row (层级) */
			panel.className = 'dsh-whale-settings dsh-whale-sound-panel';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎵 音色';
			panel.appendChild(title);
			/* one dropdown per kind (user feedback: 同类交互统一走下拉/紧凑控件，
			 * 取代把所有选项铺满一屏的列表）；改动即试听，无需重建面板 */
			KINDS.forEach(function (k) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				setIconLabel(l, k.label);
				row.appendChild(l);
				var sel = document.createElement('select');
				sel.className = 'dsh-whale-sound-sel';
				k.opts.forEach(function (opt) {
					var opt2 = document.createElement('option');
					opt2.value = opt;
					opt2.textContent = LABELS[opt];
					sel.appendChild(opt2);
				});
				sel.value = CONFIG[k.key];
				sel.addEventListener('click', function (event) { event.stopPropagation(); });
				sel.addEventListener('change', function () {
					var pa = {}; pa[k.key] = sel.value;
					if (applyConfig(pa)) saveConfig();
					playDing(k.kind); /* 现场试听 */
				});
				row.appendChild(sel);
				panel.appendChild(row);
			});
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 220);
		}

		/* ———— 历史抽屉群已拆至 ui/drawers.js（§7 触发线到达，2026-10-27 K3） ———— */

		/** Settings panel: notify-on-start toggle, stuck threshold, volume.
		 * Each row is a cycle; changes apply + persist immediately. Reuses the
		 * floating-panel slot (ctxPanel) for outside-click close. */
		function openSettings() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
			var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '⚙️ 设置';
			panel.appendChild(title);
			var mkSection = function (label) {
				var sec = document.createElement('div');
				sec.className = 'dsh-whale-settings-section';
				sec.textContent = label;
				panel.appendChild(sec);
			};
			var mkRow = function (label, valueText, onChange, keepOpen, hint) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				/* (?) explainer (#6): CLICK-toggled one-line hint with an
				 * explicit 收起 button — never a hover tooltip (user rejected
				 * those, 2026-09-03); re-clicking (?) alone felt wrong. */
				if (hint) {
					var tip = document.createElement('div');
					tip.className = 'dsh-whale-settings-hint';
					var tipT = document.createElement('span');
					tipT.className = 'dsh-whale-settings-hint-t';
					tipT.textContent = hint;
					tip.appendChild(tipT);
					var tipX = document.createElement('span');
					tipX.className = 'dsh-whale-settings-hint-x';
					tipX.textContent = '收起 ▴';
					tipX.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.remove('show');
					});
					tip.appendChild(tipX);
					row.appendChild(tip);
					var q = document.createElement('span');
					q.className = 'dsh-whale-settings-q';
					q.textContent = '?';
					q.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.toggle('show');
						/* re-measure + re-clamp: an expansion near a screen
						 * edge must flip/shrink, never run off-screen */
						showFloatingPanel(panel, 220, 200);
					});
					row.appendChild(q);
				}
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onChange();
					/* rows that open ANOTHER panel (音色/周报) must not
					 * rebuild the settings panel afterwards — the rebuild used
					 * to paint the settings content straight over the panel
					 * that had just opened, so clicking 音色 did "nothing"
					 * (user-reported bug). */
					if (!keepOpen) openSettings();
				});
				panel.appendChild(row);
				return row;
			};
			mkSection('通知');
			mkRow('🔔 开工通知', CONFIG.notifyOnStart ? '开' : '关', function () {
				if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
			}, false, '任务开始跑时说一声"开工了"；关掉后只有结果通知（完成/失败等）才说话。');
			var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
			var dndCur = CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : '关';
			var dndIdx = -1;
			DND_PRESETS.forEach(function (pr, i) {
				if (pr && pr[0] + '-' + pr[1] === dndCur) dndIdx = i;
			});
			mkRow('🌙 免打扰', dndCur, function () {
				var next = DND_PRESETS[(dndIdx + 1) % DND_PRESETS.length];
				if (next) applyConfig({ dndEnabled: true, dndFrom: next[0], dndTo: next[1] });
				else applyConfig({ dndEnabled: false });
				saveConfig();
			}, false, '该时段只默默记红标不出声；需要你选择/审核的急事照常提醒。');
			mkSection('声音');
			mkRow('🔊 音量', Math.round(CONFIG.volume * 100) + '%', function () {
				var i = VOL_STEPS.indexOf(CONFIG.volume);
				if (applyConfig({ volume: VOL_STEPS[(i + 1) % VOL_STEPS.length] })) saveConfig();
			}, false, '提示音大小，点一下换一档。');
			mkRow('🎵 音色', '按通知设置 →', function () {
				openSoundPicker();
			}, true, '完成/失败/提问、定时提醒四类通知各配各的音效。');
			mkSection('监控');
			mkRow('⏱️ 工具超时', Math.round(CONFIG.toolStuckMs / 1000) + 's', function () {
				var i = TOOL_PRESETS.indexOf(CONFIG.toolStuckMs);
				if (applyConfig({ toolStuckMs: TOOL_PRESETS[(i + 1) % TOOL_PRESETS.length] })) saveConfig();
			}, false, '单个工具跑超过这个时长就提醒一次"可能卡住了"，不会打断任务。');
			var P_PRESETS = [50, 60, 70, 80, 90];
			mkRow('🚨 压力提醒', (CONFIG.pressureWarnPct || 70) + '%', function () {
				var i = P_PRESETS.indexOf(CONFIG.pressureWarnPct || 70);
				if (applyConfig({ pressureWarnPct: P_PRESETS[(i + 1) % P_PRESETS.length] })) saveConfig();
			}, false, '上下文占用到这个百分比就提醒 /compact，防止回复被截断。');
			mkSection('数据');
			mkRow('📊 任务周报', '最近 7 天', function () {
				openReport();
			}, true, '最近 7 天每天完成多少任务、花了多少 tokens。');
			mkRow('📤 导出历史', 'Markdown', function () {
				exportHistory('md');
			}, true, '把全部历史整理成 Markdown 复制到剪贴板。');
			mkRow('📤 导出历史', 'CSV 下载', function () {
				exportHistory('csv');
			}, true, '把全部历史下载成 CSV 表格文件。');
			/* 诊断 group; the manual is NOT a row here: 使用说明 lives in the
			 * right-click menu only (user request, 2026-09-04 — settings
			 * stays settings, the manual is a doc) */
			mkSection('诊断');
			mkRow('🩺 运行状态', '点此查看', function () {
				openHealthPanel();
			}, true, '鲸鱼自查各条通知链路是否正常；平时全部正常、不打扰，出问题我头上会亮 ⚠️。');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			mkRow('🩺 调试模式', debugNow ? '开（取证中）' : '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
			}, false, '排障时才开：往控制台输出调试信息，平时保持关闭。');
			/* 设置 itself is opened from the right-click menu: back goes to
			 * the menu (user request: bottom-left 返回菜单) */
			mkPanelFoot(panel, null, true);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 200);
		}

		/** 🩺 Health detail panel (core/health.js detects, THIS side renders:
		 * the panel slots live in uiInit's closure so the health module —
		 * an IIFE-scope inline module — delegates here). */
		function openHealthPanel() {
			closeCtxPanel();
			closeCtxHistory();
			var health = window.__dshWhale && window.__dshWhale._health;
			var rep = (health && health.state().lastReport) || (health && health.run()) || { server: 'ok', dom: 'ok', jump: 'warn' };
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🩺 运行状态';
			panel.appendChild(title);
			var rows = [
				['后台通知通道', rep.server === 'fail' ? '❌ 失效（收不到后台/失败通知）' : '✅ 正常'],
				['用量读取', rep.dom === 'fail' ? '❌ 异常（tokens 面板可能为空）' : '✅ 正常'],
				['气泡跳转', rep.jump === 'ok' ? '✅ 可用' : '⚠️ 不可用（走侧栏兜底）']
			];
			for (var i = 0; i < rows.length; i++) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = rows[i][0];
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = rows[i][1];
				row.appendChild(l);
				row.appendChild(v);
				panel.appendChild(row);
			}
			var hint = document.createElement('div');
			hint.className = 'dsh-whale-settings-section';
			hint.textContent = '多数失效是页面过期：右键菜单 🔄 刷新页面（或浏览器 Ctrl+F5）即可恢复；仍失效请看控制台 [🐋] 日志';
			panel.appendChild(hint);
			/* footer via shared helper: ← 返回设置 / ✕ 关闭 */
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 260, 190);
		}

		whale.addEventListener('contextmenu', function (event) {
			event.preventDefault();
			event.stopPropagation();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				/* double right-click: pet the whale */
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			openCtxMenu(event.clientX, event.clientY);
		});

		/* clicking anywhere else closes the floats (right button excluded —
		 * it is handled by the contextmenu path above). The history drawer is
		 * exempt too: its rows act on the CLICK event, and hiding the panel on
		 * pointerdown detaches them before that click ever arrives. */
		document.addEventListener('pointerdown', function (event) {
			if (event.button === 2) return;
			var t = event.target;
			if (ctxMenu && ctxMenu.contains(t)) return;
			if (ctxPanel && ctxPanel.contains(t)) return;
			if (ctxHistory && ctxHistory.contains(t)) return;
			closeCtxFloats();
		});

		/* right-click outside the whale: close the floats; a double
		 * right-click anywhere in the window still pets the whale */
		document.addEventListener('contextmenu', function (event) {
			var floatsOpen = (ctxMenu && ctxMenu.classList.contains('show')) ||
				(ctxPanel && ctxPanel.classList.contains('show')) ||
				(ctxHistory && ctxHistory.classList.contains('show'));
			if (!floatsOpen) return; /* outside the whale: browser menu as usual */
			event.preventDefault();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			closeCtxFloats();
		});

		function applyPos(x, y) {
			var width = whale.offsetWidth;
			var height = whale.offsetHeight;
			x = Math.max(0, Math.min(x, window.innerWidth - width));
			y = Math.max(0, Math.min(y, window.innerHeight - height));
			whale.style.left = x + 'px';
			whale.style.top = y + 'px';
			whale.style.right = 'auto';
			whale.style.bottom = 'auto';
		}

		function savePos() {
			/* v2 ANCHOR store: keep the whale anchored to the RIGHT-BOTTOM
			 * corner as pixel offsets, so a window resize re-seats it at the
			 * same corner offset instead of stranding it at a stale absolute
			 * x/y (user report 09-14: fullscreen -> windowed left the whale
			 * off-screen). x/y kept for downgrade readability. */
			var rx = Math.round(window.innerWidth - whale.offsetLeft - whale.offsetWidth);
			var by = Math.round(window.innerHeight - whale.offsetTop - whale.offsetHeight);
			safeSet(POS_KEY, {
				v: 2,
				rx: rx,
				by: by,
				x: whale.offsetLeft,
				y: whale.offsetTop
			});
		}

		/* v2 anchor re-seat with symmetric clamp: offsets are kept verbatim
		 * while they fit the current viewport; when the window shrank past
		 * the stored offset the whale clamps to the nearest edge instead of
		 * stranding off-screen (and the original offset survives for when
		 * the window grows back). */
		function seatFromAnchor(rx, by) {
			rx = Math.max(0, Math.min(rx, window.innerWidth - whale.offsetWidth));
			by = Math.max(0, Math.min(by, window.innerHeight - whale.offsetHeight));
			applyPos(
				window.innerWidth - whale.offsetWidth - rx,
				window.innerHeight - whale.offsetHeight - by
			);
		}

		function anchorFromStorage() {
			return safeGet(POS_KEY, function (v0) {
				return (v0 && typeof v0 === 'object' && typeof v0.x === 'number' && typeof v0.y === 'number') ? v0 : null;
			});
		}

		function loadPos() {
			var pos = anchorFromStorage();
			if (pos && typeof pos.rx === 'number' && typeof pos.by === 'number') {
				seatFromAnchor(pos.rx, pos.by);
				return true;
			}
			if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y);
				return true;
			}
			return false;
		}

		/* window resize: keep the whale in view. v2 anchors re-seat from the
		 * right-bottom offsets (corner semantics survive any window shape —
		 * user report 09-14: fullscreen -> windowed left the whale stranded
		 * at a stale absolute x/y); v1/legacy absolute positions are clamped
		 * back into the viewport. No stored pos = CSS right/bottom default,
		 * which already tracks the window by itself. */
		window.addEventListener('resize', function () {
			var pos = anchorFromStorage();
			if (!pos) return;
			if (typeof pos.rx === 'number' && typeof pos.by === 'number') {
				seatFromAnchor(pos.rx, pos.by);
			} else if (typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y); /* clamp happens inside applyPos */
			}
			updateStatusPos();
		});

		var wiggleTimer = null;

		function wiggle() {
			whale.classList.remove('dsh-whale-wiggle');
			void whale.offsetWidth; /* restart the animation */
			whale.classList.add('dsh-whale-wiggle');
			/* the one-shot wiggle must be dropped after it finishes,
			 * otherwise the finished animation keeps overriding the idle
			 * bob (dsh-whale-bob) and the whale freezes until reload. */
			if (wiggleTimer) clearTimeout(wiggleTimer);
			wiggleTimer = setTimeout(function () {
				wiggleTimer = null;
				whale.classList.remove('dsh-whale-wiggle');
				void whale.offsetWidth; /* let the bob restart cleanly */
			}, 500);
		}

		function liveJobs() {
			var out = [];
			known.forEach(function (view) {
				if (view.status === 'running' || view.status === 'stopping') out.push(view);
			});
			return out;
		}

		/** The click summary stays pure interaction: task status or an idle
		 * line. Token/pressure lives in the status panel on task completion. */
		function clickSummary() {
			if (asleep) return '呼… Zzz 💤';
			var live = liveJobs();
			var summary;
			if (live.length > 0) {
				var names = live.slice(0, 3)
					.map(function (view) { return '「' + truncate(taskTitle(view), live.length > 1 ? 22 : 30) + '」'; })
					.join('、');
				summary = live.length + ' 个子任务进行中：' + names + (live.length > 3 ? ' 等' : '') + ' ' + pickTail('busy');
				if (moodStageIndex() >= 3 && Math.random() < 0.4) {
					summary += ' ……还在跑，我盯着呢 🫠';
				}
			} else {
				summary = pickIdleLine();
			}
			/* recent failure: give a gentle recall hint (window from config) */
			var failAt = recentFailAt();
			if (failAt !== null && (Date.now() - failAt) < CONFIG.recentFailWindowMs) {
				summary += '\n上次任务失败了哦，双击红色通知回去看看 🥲';
			}
			return summary;
		}

