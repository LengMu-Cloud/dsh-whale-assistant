		/* --- right-click: single click opens the menu, double right-click
		 * pets the whale (affection +1). --- */
		var ctxMenu = null;
		var ctxPanel = null;
		var lastCtxAt = 0;
		var CTX_DBL_MS = 400;
		var CTX_MENU_W = 180;

		function closeCtxMenu() {
			if (ctxMenu) ctxMenu.classList.remove('show');
			/* 桌宠子菜单跟随主菜单生命周期（⑳）：凡收主菜单的路径都汇到
			 * 这里，子菜单级联收起——否则主菜单没了、子菜单孤儿漂浮 */
			closePetFloats();
		}
		function closeCtxPanel() {
			if (ctxPanel) ctxPanel.classList.remove('show');
		}
		function closeCtxFloats() {
			closeCtxMenu();
			closeCtxPanel();
			closeCtxHistory();
		}
		/* ---- 桌宠浮层缝（⑳ 切换形态子菜单）----
		 * 桌宠页经 __dshPetHost.menuFloats() 登记额外浮层（形态二级菜单），
		 * 与主菜单同进退：
		 *  1) closeCtxMenu 级联收起（closeCtxFloats 与一切单收路径都汇于它）；
		 *  2) 外部 pointerdown 的关闭判定把它们视作主菜单的一部分——子菜单行
		 *     上按下时不误收（pointerdown 收起会把浮层 pointer-events 转 none，
		 *     随后的 click 落空=选形态点了没反应）；
		 *  3) 右键 double-pet 判定同样计入，避免子菜单开着时右键落成摸头。
		 * 页鲸（侧边栏）无此缝：menuFloats 缺席=空数组=零行为变化。 */
		function petFloatEls() {
			try {
				if (window.__dshPetHost && typeof window.__dshPetHost.menuFloats === 'function') {
					var els = window.__dshPetHost.menuFloats();
					if (els && els.length) return els;
				}
			} catch (e) { }
			return [];
		}
		function petFloatHas(t) {
			var els = petFloatEls();
			for (var i = 0; i < els.length; i++) {
				try { if (els[i] && els[i].contains(t)) return true; } catch (e2) { }
			}
			return false;
		}
		function petFloatShown() {
			var els = petFloatEls();
			for (var i = 0; i < els.length; i++) {
				try { if (els[i] && els[i].classList && els[i].classList.contains('show')) return true; } catch (e3) { }
			}
			return false;
		}
		function closePetFloats() {
			var els = petFloatEls();
			for (var i = 0; i < els.length; i++) {
				try { if (els[i]) els[i].classList.remove('show'); } catch (e4) { }
			}
		}

		/* ---- 内联 SVG 图标集（P1 2026-10-28）----
		 * P0 用 20px 定宽槽解决了对齐，但 emoji 本体在各平台字形/配色仍不可控
		 * （Segoe UI Emoji vs Apple Color Emoji）。P1 把字形换成 16×16 stroke
		 * 风格的内联 SVG：stroke=currentColor 跟随面板文字色，跨平台一致。
		 * emoji 原文保留在 0 尺寸 ghost span 里——textContent 逐字节不变，
		 * 测试与读屏口径同 P0；未收录字形回落 P0 emoji 槽（新菜单项零成本）。 */
		var ICON_SVG_NS = 'http://www.w3.org/2000/svg';
		/* P1-1 图标体系统一（UI 审美 v5 落地 2026-11-19）：品牌鲸鱼 path
		 * （whale-logo.svg 主 path，50 viewBox）成为 🐳 菜单头 / 🐋 完整形态 /
		 * 🎭 切换形态 的共用规格——实心 currentColor（mockup-01/02 批准画法），
		 * scale(0.32) 落进 16 盒。🪟/🙈 几何取自批准 mockup 的 24 viewBox
		 * （rect 圆角窗 / feather eye-off），scale(2/3) 折进 16 盒、stroke-width
		 * 2.4 折算后与兄弟 16 盒线稿（1.6）同视觉重量。三个彩色 emoji 位图的
		 * 语义由 ghost span 保口径（textContent 逐字节不变）。 */
		var ICON_WHALE_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z';
		var ICON_WHALE_SPEC = [['path', { d: ICON_WHALE_PATH, fill: 'currentColor', stroke: 'none', transform: 'scale(0.32)' }]];
		var ICON_PATHS = {
			'🐳': ICON_WHALE_SPEC,
			'🐋': ICON_WHALE_SPEC,
			'🎭': ICON_WHALE_SPEC,
			'🪟': [['rect', { x: 4, y: 5, width: 16, height: 14, rx: 2.5, transform: 'scale(0.6667)', 'stroke-width': 2.4 }]],
			'🙈': [['path', { d: 'M17.94 17.94A10 10 0 0 1 12 20C5 20 1 12 1 12a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19', transform: 'scale(0.6667)', 'stroke-width': 2.4 }], ['path', { d: 'M14.12 14.12a3 3 0 1 1-4.24-4.24', transform: 'scale(0.6667)', 'stroke-width': 2.4 }]],
			'⏰': [['circle', { cx: 8, cy: 8.7, r: 5.1 }], ['path', { d: 'M8 6.3v2.6l1.9 1.1' }], ['path', { d: 'M2.8 3.2l1.8-1.2M13.2 3.2l-1.8-1.2' }]],
			'ℹ️': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M8 7.4v3' }], ['circle', { cx: 8, cy: 5.4, r: 0.9, fill: 'currentColor' }]],
			/* P1-1 追修五（11-19 使用说明 Tab，设计专项方案 §3.2 五枚新字形——分区头
			 * 🚀🎮🔧ℹ️ 与组头 🛠🖥 装饰线稿；16vb/stroke 1.6/round 与全站同族） */
			'🚀': [['path', { d: 'M8 2.4c1.9 1.7 2.9 3.8 2.9 5.9 0 1.8-.8 3.3-2.9 4.7-2.1-1.4-2.9-2.9-2.9-4.7 0-2.1 1-4.2 2.9-5.9z' }], ['circle', { cx: 8, cy: 6.6, r: 1.35 }], ['path', { d: 'M5.2 8.5 3.9 11.2l1.9-.5M10.8 8.5l1.3 2.7-1.9-.5' }], ['path', { d: 'M8 13.2v1.6' }]],
			'🎮': [['rect', { x: 2, y: 5.2, width: 12, height: 6.6, rx: 3.3 }], ['path', { d: 'M5.5 7.2v2.6M4.2 8.5h2.6' }], ['circle', { cx: 10.9, cy: 7.6, r: 0.8, fill: 'currentColor' }], ['circle', { cx: 12.2, cy: 9.4, r: 0.8, fill: 'currentColor' }]],
			'🔧': [['path', { d: 'M13.6 3.1a2.8 2.8 0 0 1-3.7 3.5L5.5 11a1.35 1.35 0 0 1-1.9-1.9L8 4.7a2.8 2.8 0 0 1 3.5-3.7l-1.9 1.9.4 1.7 1.7.4 1.9-1.9z' }]],
			'🛠': [['path', { d: 'M4.9 6.6 9.7 1.8', 'stroke-width': 3 }], ['path', { d: 'M7.3 4.2l5.3 5.3' }]],
			'🖥': [['rect', { x: 1.8, y: 3, width: 12.4, height: 8.4, rx: 1.2 }], ['path', { d: 'M8 11.4v1.9M5.1 13.3h5.8' }]],
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

		/** Inline icon for PROSE references to UI glyphs (P1-1 追修三 11-19):
		 * hint lines quote menu items / chips / console tags — render the same
		 * SVG the referenced surface now uses, emoji原文进 ghost 保口径.
		 * Shared scope: panel-page.js 恢复提示行同款复用。 */
		function whInlineIcon(glyph) {
			var ic = document.createElement('span');
			ic.className = 'dsh-whale-ico';
			ic.appendChild(buildIconSvg(ICON_PATHS[glyph]));
			var gh = document.createElement('span');
			gh.className = 'dsh-whale-ico-ghost';
			gh.textContent = glyph;
			ic.appendChild(gh);
			return ic;
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
			/* P3-11（UI 审美 v5 落地）：粒子起步点避让气泡——评审实拍（ui-10）
			 * 粒子压在气泡边缘上。气泡在场时起步点外移到气泡边缘外 8px 起步
			 * （上方态=气泡下缘下 8px；flip 态=气泡上缘上 8px 对称），不再压面板 */
			try {
				var bub = document.querySelector('.dsh-whale-bubble');
				if (bub && bub.classList.contains('show')) {
					var flip = bub.classList.contains('dsh-whale-bubble-flip');
					if (flip) {
						/* flip 态气泡在鲸鱼下方，粒子起步点天然在外且向上远离——
						 * 只兜底不落进气泡内 */
						var topEdge = whale.offsetTop + whale.offsetHeight + 12;
						if (y > topEdge - 8) y = topEdge - 8;
					} else {
						/* 常态气泡悬在鲸鱼上方：起步点上移到气泡下缘外 8px */
						var botEdge = whale.offsetTop - 12;
						if (y > botEdge - 8) y = botEdge - 8;
					}
				}
			} catch (eHearts) { }
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
			/* BUG-1 sync（11-16）：好感度上报服务端 petDoc（桌宠页 origin 每-boot
			 * 变、localStorage 不可跨重启）；本地变更后本 boot 权威值在本地，
			 * /pet/state 轮询回声不再反向覆盖。 */
			affectionKnown = true;
			pushPetSync({ aff: affection });
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
				/* BUG-1 sync（11-16）：里程碑随好感度同一条通道上报——不然好感度
				 * 跨重启恢复后、里程碑旗标还在新 origin 的空 localStorage 里，
				 * 10/50/100 的庆祝会在每次重启后重放。 */
				pushPetSync({ affMs: Object.keys(done).join(',') });
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
			closePetFloats(); /* 重开卫生：菜单每次重建，子菜单不许带着上一场的 .show 残留 */
			var menu = ctxMenu || document.createElement('div');
			menu.className = 'dsh-whale-menu';
			menu.textContent = '';
			/* header: mood + live jobs. P1-1（UI 审美 v5 落地）：头部 🐳 彩色
			 * emoji 位图 → 品牌鲸鱼线标（ICON_PATHS['🐳']，实心 currentColor，
			 * 槽色 #8fb7ff 由 .dsh-whale-menu-head 品牌规则上色）；ghost 保
			 * textContent 口径（测试断言 includes('🐳') 不变） */
			var head = document.createElement('div');
			head.className = 'dsh-whale-menu-head';
			var liveN = liveJobs().length;
			var moodName = MOOD_STAGES[moodStageIndex()].name;
			setIconLabel(head, '🐳 ' + moodName + (liveN > 0 ? ' · ' + liveN + ' 个任务进行中' : ' · 待命中'));
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
							/* v2（11-12）：无论 delivered 都唤回窗口——delivered=true
							 * 也可能只是退出挂起的僵尸渲染层在场；c:'revive' 由 ps1
							 * 分流（有窗=前台化，无窗=杀僵尸壳+重拉，pendingSettings
							 * 在新页鲸接入时 hello 补投自动打开设置页） */
							try {
								if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
									window.chrome.webview.postMessage({ c: 'revive' });
								}
							} catch (e2) { }
							if (out && out.ok === true && out.delivered === false) {
								uiSay('DSH 窗口已关——正在重开并进入设置页，稍等 🐳', 3500);
							} else if (out && out.ok === true) {
								uiSay('已打开小鲸鱼助手设置 ✓', 1800);
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
			 * 假装刷新成功。
			 * ⑳真机六（11-17 用户拍板）：桌宠菜单的刷新项升格为「🖥️ DSH 窗口 ›」
			 * flyout 父项（子项=🔄 刷新 DSH 窗口[原刷新语义原位保留] +
			 * 🖥️ 打开 DSH 窗口[ps1 c:'revive' 唤回前台/壳死重生]），与「切换
			 * 形态」同款交互、共用同一枚 flyout 壳与择位/避鲸链；页鲸菜单
			 * （非 PET_MODE）保持 🔄 刷新页面不变。 */
			if (PET_MODE && window.__dshPetHost && typeof window.__dshPetHost.makeFlyoutRow === 'function') {
				menu.appendChild(window.__dshPetHost.makeFlyoutRow('🖥️ DSH 窗口', function () {
					return [
						{ label: '🔄 刷新 DSH 窗口', onPick: function () {
							closeCtxMenu();
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
						} },
						{ label: '🖥️ 打开 DSH 窗口', onPick: function () {
							closeCtxMenu();
							try { window.__dshPetHost.reviveDsh(); } catch (eRevive) { }
							uiSay('已唤 DSH 窗口 🐬', 2000);
						} }
					];
				}));
			} else {
				var refreshItem = document.createElement('div');
				refreshItem.className = 'dsh-whale-menu-item';
				setIconLabel(refreshItem, '🔄 刷新页面');
				refreshItem.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxMenu();
					setTimeout(function () { location.reload(); }, 80);
				});
				menu.appendChild(refreshItem);
			}
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
			/* P1-1 追修三：🩺 彩色 emoji → SVG 心电线稿（ghost 保口径） */
			setIconLabel(title, '🩺 运行状态');
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
			/* P1-1 追修三：行内 UI 引用图形同步 SVG（🔄=菜单刷新行同款、
			 * [🐋]=品牌鲸标进方括号）；emoji 原文进 ghost，textContent 口径不变 */
			hint.textContent = '';
			hint.appendChild(document.createTextNode('多数失效是页面过期：右键菜单 '));
			hint.appendChild(whInlineIcon('🔄'));
			hint.appendChild(document.createTextNode(' 刷新页面（或浏览器 Ctrl+F5）即可恢复；仍失效请看控制台 ['));
			hint.appendChild(whInlineIcon('🐋'));
			hint.appendChild(document.createTextNode('] 日志'));
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
			if (petFloatHas(t)) return; /* 桌宠子菜单行上按下不算外部（⑳） */
			closeCtxFloats();
		});

		/* right-click outside the whale: close the floats; a double
		 * right-click anywhere in the window still pets the whale */
		document.addEventListener('contextmenu', function (event) {
			var floatsOpen = (ctxMenu && ctxMenu.classList.contains('show')) ||
				(ctxPanel && ctxPanel.classList.contains('show')) ||
				(ctxHistory && ctxHistory.classList.contains('show')) ||
				petFloatShown(); /* 桌宠子菜单开着也算浮层在场（⑳） */
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

		/* BUG-1 sync（11-16）：本 boot 位置已有权威值（boot 存量/本地落笔/服务端
		 * 采用三处置位）——_petSyncPos 只在权威值缺席时采用服务端下发落点。 */
		var posSyncKnown = false;

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
			/* BUG-1 sync（11-16）：落点上服务端 petDoc（拖动结束/游回角落/躲猫猫
			 * 落点共用 savePos=四个调用点一处收口）。 */
			posSyncKnown = true;
			pushPetSync({ pos: { rx: rx, by: by, x: whale.offsetLeft, y: whale.offsetTop } });
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

