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
				/* 设置抽屉退役（11-08 侧边栏页）：falsy 返回键=单纯收起浮层
				 * （音色/周报/运行状态现在从侧边栏页打开，收起即回到页面）；
				 * 两个浮层家族都关（ctxPanel=音色选择器 / ctxHistory=周报） */
				backBtn.textContent = '← 返回';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxPanel();
					closeCtxHistory();
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
			/* ⚙️ 设置（11-11 真机修复轮，用户要求恢复）：跳转 DSH 侧边栏
			 * 「小鲸鱼助手」页——layout.selectPanel 桥（client.js inject
			 * stash），桥缺席（0.1.x web 老引擎/桌宠页无 layout 服务）时
			 * uiSay 指路兜底。注意：11-08 收口删项时这里的旧注释声称「桌宠
			 * 共享同一份配置」是**错误假设**（桌宠 WebView2 独立分区，页面
			 * 设置根本到不了桌宠——正是用户实报的音色不生效根因），已由设置
			 * relay（/pet/config → state 轮询）纠正。 */
			var settingsItem = document.createElement('div');
			settingsItem.className = 'dsh-whale-menu-item';
			setIconLabel(settingsItem, '⚙️ 设置');
			settingsItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				if (PET_MODE) {
					/* 桌宠页没有 layout 桥也没有 DSH DOM——走宿主广播（与「刷新
					 * DSH 页面」同通道）：POST open-settings → pet/open-settings
					 * 帧 → 页鲸 selectPanel 打开侧边栏设置页；delivered 后再用
					 * c:'jump' 让 ps1 把 DSH 拉前台（ps1 该分支只做前台化，无
					 * 会话语义，11-03 机制复用）。页鲸不在场（DSH 关着）=
					 * delivered:false → 提示，不假装成功。 */
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'open-settings' })
						}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
							if (out && out.ok === true && out.delivered === true) {
								try {
									if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
										window.chrome.webview.postMessage({ c: 'jump' });
									}
								} catch (e2) { }
								uiSay('已在 DSH 打开小鲸鱼助手设置 ✓', 2200);
							} else if (out && out.ok === true) {
								uiSay('DSH 窗口未打开——先打开 DSH 再从桌宠菜单进设置 🐳', 3500);
							} else {
								uiSay('跳转指令没有送达，稍后再试 🥲', 2500);
							}
						}).catch(function () { uiSay('跳转指令没有送达，稍后再试 🥲', 2500); });
					} catch (e) { uiSay('设置住在 DSH 侧边栏的「小鲸鱼助手」页面里', 2600); }
					return;
				}
				/* 页鲸：layout 桥直达（client.js inject stash）；桥缺席=0.1.x
				 * web 老引擎 → 气泡指路兜底 */
				var jumped = false;
				try {
					if (typeof window.__dshWhaleSelectPanel === 'function') {
						window.__dshWhaleSelectPanel('whale-assistant');
						jumped = true;
					}
				} catch (e) { jumped = false; }
				if (!jumped) uiSay('设置住在 DSH 侧边栏的「小鲸鱼助手」页面里', 2600);
			});
			menu.appendChild(settingsItem);
			/* refresh (B-2 desktop): the official desktop binds NO F5/Ctrl+R —
			 * plugin updates and recovery both need a page reload, and the
			 * whale menu is the reachable way to get one.
			 * 11-07 语义拆分（用户实报「桌宠的刷新页面失效」）：页鲸菜单的刷新
			 * =刷 DSH 页（location.reload，本页就是 DSH 页 ✓）；桌宠菜单的刷新
			 * 旧实现刷的是**桌宠自己的页面**（桌宠鲸闪一下重载，DSH 页原封不动
			 * =用户眼中的「失效」）。现桌宠分支改走宿主广播：POST /pet/ctrl
			 * reload-page → pet/reload-page 帧 → 页鲸执行真正的 reload；页鲸
			 * 不在场（DSH 窗口关着）时宿主回 delivered=false，桌宠提示而不是
			 * 假装刷新成功。 */
			var refreshItem = document.createElement('div');
			refreshItem.className = 'dsh-whale-menu-item';
			setIconLabel(refreshItem, PET_MODE ? '🔄 刷新 DSH 页面' : '🔄 刷新页面');
			refreshItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				if (PET_MODE) {
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'reload-page' })
						}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
							if (out && out.ok === true && out.delivered === false) {
								uiSay('DSH 窗口已关闭——打开 DSH 后页面会自动加载新版 🐳', 3500);
							} else if (out && out.ok === true) {
								uiSay('已让 DSH 页面刷新 🐳', 2000);
							} else {
								uiSay('刷新指令没有送达，稍后再试 🥲', 2500);
							}
						}).catch(function () { uiSay('刷新指令没有送达，稍后再试 🥲', 2500); });
					} catch (e) { uiSay('刷新失败，稍后再试 🥲', 2500); }
					return;
				}
				setTimeout(function () { location.reload(); }, 80);
			});
			menu.appendChild(refreshItem);
			/* 桌宠常驻（第九轮用户定稿）：页面侧不再有「桌宠模式」开关——小鲸鱼
			 * 默认活动范围=整个桌面，开机即常驻（不支持平台由页内鲸鱼兜底）。
			 * 桌宠窗口里由 __dshPetHost 缝追加三态形态组 */
			/* pet seam: the screen-pet window injects 形态组 (完整/气泡/隐藏)
			 * into every rebuilt menu via __dshPetHost — a no-op everywhere else */
			try {
				if (window.__dshPetHost && typeof window.__dshPetHost.appendMenuItems === 'function') {
					window.__dshPetHost.appendMenuItems(menu);
				}
			} catch (e) { }
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
			/* 11-05 用户实报「右键菜单会挡住小鲸鱼」：菜单锚在光标上，而右键的
			 * 光标就在鲸鱼身上——视口翻转后整块压在鲸鱼上（真机截图：菜单
			 * 右下角=光标=鲸鱼身）。翻转后与鲸鱼布局盒求交，相交就从
			 * 右/左/上/下四个候选位挑第一个**完整入屏且零重叠**的（各留
			 * 10px 缝）；全放不下取夹紧后重叠最小的。布局盒 offset* 免疫
			 * bob 动画 transform（同 clampBubble 原理）。 */
			if (whale && whale.offsetWidth > 0) {
				var wx = whale.offsetLeft, wy = whale.offsetTop;
				var ww = whale.offsetWidth, wh = whale.offsetHeight;
				function menuHitsWhale(ml, mt) {
					return ml < wx + ww && ml + mw > wx && mt < wy + wh && mt + mh > wy;
				}
				if (menuHitsWhale(left, top)) {
					var GAP = 10, MARG = 8;
					var cands = [
						{ l: wx + ww + GAP, t: top },
						{ l: wx - mw - GAP, t: top },
						{ l: left, t: wy - mh - GAP },
						{ l: left, t: wy + wh + GAP }
					];
					var bestL = left, bestT = top, bestOv = Infinity;
					for (var ci = 0; ci < cands.length; ci++) {
						var cl = Math.min(Math.max(cands[ci].l, MARG), window.innerWidth - mw - MARG);
						var ct = Math.min(Math.max(cands[ci].t, MARG), window.innerHeight - mh - MARG);
						if (!menuHitsWhale(cl, ct)) { bestL = cl; bestT = ct; bestOv = 0; break; }
						var ox = Math.max(0, Math.min(cl + mw, wx + ww) - Math.max(cl, wx));
						var oy = Math.max(0, Math.min(ct + mh, wy + wh) - Math.max(ct, wy));
						if (ox * oy < bestOv) { bestOv = ox * oy; bestL = cl; bestT = ct; }
					}
					left = bestL;
					top = bestT;
				}
			}
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

		/* 11-11 菜单收口：使用说明/音色/设置三块已迁至侧边栏页
		 * src/ui/panel-page.js（音色随设置页行内化），对应函数已删除；
		 * 历史抽屉群早已拆至 ui/drawers.js（2026-10-27 K3）。 */

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
				/* 桌宠页的跳转走宿主通道（与通知 feed 同路由同 token），健康
				 * 判据不同——别把页鲸的「侧栏兜底」文案搬到桌宠上误导用户
				 * （11-03 实机：桌宠跳转修好了，面板还在报「不可用」） */
				['气泡跳转', PET_MODE
					? (rep.jump === 'ok' ? '✅ 可用（双击通知直达）' : '⚠️ 不可用（宿主通道异常）')
					: (rep.jump === 'ok' ? '✅ 可用' : '⚠️ 不可用（走侧栏兜底）')]
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

