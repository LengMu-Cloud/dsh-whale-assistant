/* dsh-whale-assistant browser half: loads the WHALE (script + style + svg) from
 * the host routes — the whale no longer relies on the dist index.html
 * injection, so DSH upgrades/reinstalls can never wipe it.
 * 0.4.0: apply also bridges the client-side sessions service into the whale
 * (the jump feature moved in-house) via runtime ctx.inject — the
 * conversation-client patch (apply-plugin-hook.ps1) is retired.
 *
 * CONTRACT (learned the hard way — a bad return breaks ALL plugin loading):
 * the factory must return a function OR an object with an `apply` method;
 * the loader applies client modules as cordis plugins too. */
window.__ModuleLoader__.load({
	id: '@lengmu-cloud/dsh-whale-assistant',
	factory: (require) => {
		/* 11-08 侧边栏页（官方 slots API，路线①）：宿主 loader 给 factory 发
		 * CJS 风格 require——官方包就拿它 require("react")（ui-sidebar 同款），
		 * 同一实例零双 React 风险。拿不到（老引擎/registry 缺席）→ 页面注册
		 * 整体跳过，鲸鱼其余功能不受影响。 */
		let React = null;
		try { React = require('react'); } catch (e) { React = null; }
		/* 侧边栏图标：whale-logo.svg 的鲸鱼主体路径（出处声明见 README），
		 * React 组件收 {size, active}（sidebar/client.js 传入，展开 16px/收起 18px）；
		 * active 态只由宿主行背景表达，图标自身不加透明度戏法（11-11 基线⑨） */
		var WHALE_ICON_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z';
		function WhalePanelIcon(props) {
			props = props || {};
			var size = props.size || 18;
			return React.createElement('svg', {
				width: size,
				height: size,
				viewBox: '0 0 50 50',
				style: { display: 'block' }
			}, React.createElement('path', { d: WHALE_ICON_PATH, fill: 'currentColor', 'fill-rule': 'nonzero' }));
		}
		function WhalePanelPage() {
			/* 页面本体住在页面半区（src/ui/panel-page.js 经 window 挂载面）：
			 * CONFIG/抽屉函数全在 uiInit 闭包，client 半部保持零业务逻辑 */
			return React.createElement('div', {
				className: 'dsh-whale-pp-host',
				ref: function (el) {
					if (!el) return;
					try {
						if (window.__dshWhalePanel && typeof window.__dshWhalePanel.mount === 'function') {
							window.__dshWhalePanel.mount(el);
						} else {
							el.textContent = '小鲸鱼助手页面还在加载——请关闭后重新点开。';
						}
					} catch (e) {
						el.textContent = '小鲸鱼助手页面渲染失败：' + (e && e.message || e);
					}
				}
			});
		}
		Promise.all([
			fetch('/api/whale-assistant/whale.js').then((r) => (r.ok ? r.text() : Promise.reject(new Error('whale.js http ' + r.status)))),
			fetch('/api/whale-assistant/assets').then((r) => (r.ok ? r.json() : Promise.reject(new Error('assets http ' + r.status)))),
		]).then(([code, assets]) => {
			/* take over from the OLD dist-injected whale if present: the
			 * index.html patch is retired, but the element it created may
			 * still be on the page — rebuild it fresh with current assets */
			const old = document.getElementById('dsh-whale');
			if (old) old.remove();
			delete window.__dshWhale;

			if (assets.css) {
				const style = document.createElement('style');
				style.textContent = assets.css;
				document.head.appendChild(style);
			}
			const holder = document.createElement('div');
			holder.id = 'dsh-whale';
			holder.setAttribute('aria-hidden', 'true');
			holder.innerHTML = assets.svg || '';
			document.body.appendChild(holder);
			/* 桌宠仲裁防闪烁（第一批）：pet 开启时页面鲸鱼休眠——boot 即按
			 * 缓存隐藏（whale.js 起来后由 /events pet.enabled 校正），避免
			 * 双鲸并存闪现 3 秒 */
			try {
				if (localStorage.getItem('dsh-whale:petDormant') === '1') holder.style.display = 'none';
			} catch (e) { /* storage unavailable: whale.js path still corrects */ }

			(0, eval)(code);
			console.log('[dsh-whale-assistant] whale loaded from plugin routes');
			/* 侧边栏页竞态兜底（11-11 审计 P3-1）：whale.js 此刻才就绪——把
			 * 点开过早、还停在兜底文案的页面实例重新挂载，用户不用关了重开 */
			try {
				const staleHost = document.querySelector('.dsh-whale-pp-host');
				if (staleHost && window.__dshWhalePanel && typeof window.__dshWhalePanel.mount === 'function'
					&& String(staleHost.textContent || '').indexOf('还在加载') >= 0) {
					window.__dshWhalePanel.mount(staleHost);
				}
			} catch (e) { /* 页面没开：无需兜底 */ }
		}).catch((e) => {
			console.error('[dsh-whale-assistant] whale load failed', e);
			/* eval 失败时兜底文案不能永远谎称「还在加载」 */
			try {
				const fh = document.querySelector('.dsh-whale-pp-host');
				if (fh && String(fh.textContent || '').indexOf('还在加载') >= 0) {
					fh.textContent = '小鲸鱼助手页面加载失败——请刷新页面（右键菜单 🔄 / Ctrl+F5）重试。';
				}
			} catch (e2) { /* 页面没开 */ }
		});
			return {
				apply(ctx) {
					/* 0.4.0: bridge the client-side sessions service into the whale —
					 * the jump feature moved in-house (the client.js patch is retired).
					 * Runtime inject, NOT manifest inject: the whale must never wait
					 * on an internal service just to load. */
					/* 0.2.0 (B-2): the sessions service became a manager (no `.open`),
					 * and `.conversation` is an INJECT-GATED property. Until the jump
					 * adaptation lands (交接报告第35章五), the callback must be
					 * FULLY self-guarded — **the inject callback runs OUTSIDE the
					 * try/catch below** (it fires on later service delivery), and a
					 * cordis ctx proxy THROWS on undeclared property reads — neither
					 * the proxy nor the raw service may be stashed onto window:
					 * the whale's boot pickup reads `.open` off it and the throw
					 * kills the whole whale boot (frozen whale, no notifications —
					 * 09-29 user report). Bind attempt in-place, guarded, no stash. */
					try {
						ctx.inject(['sessions', 'conversation'], (sCtx) => {
							try {
								let conversation = null;
								try { conversation = sCtx.conversation; } catch (e) { /* gated */ }
								window.__dshWhaleConversation = conversation;
								if (window.__dshWhale && typeof window.__dshWhale.bindJumpSessions === 'function') {
									let sessions = null;
									try { sessions = sCtx.sessions; } catch (e) { /* gated */ }
									window.__dshWhale.bindJumpSessions(sessions, conversation, window.__dshWhaleUiWorkspace);
								}
							} catch (e) { console.warn('[dsh-whale-assistant] bridge bind skipped:', e && e.message); }
						});
					} catch (e) { /* sessions service unavailable on this client build */ }
					/* 0.2.0 jump adaptation (第35章九): the official view switch lives
					 * on the uiWorkspace service — sidebar row click → onOpen →
					 * uiWorkspace.openSession(id) → replaceMain(id, signal, "reveal").
					 * SEPARATE inject on purpose: bundling it with ['sessions',
					 * 'conversation'] would hang the whole bridge on engines that
					 * never mount uiWorkspace (0.1.x web). Stash the FACE (a real
					 * service instance, not the throwing ctx proxy) for the whale's
					 * boot pickup; the whale binds it guarded. */
					try {
						ctx.inject(['uiWorkspace'], (sCtx) => {
							try {
								let uiw = null;
								try { uiw = sCtx.uiWorkspace; } catch (e) { /* gated */ }
								if (!uiw || typeof uiw.openSession !== 'function') return;
								window.__dshWhaleUiWorkspace = uiw;
								if (window.__dshWhale && typeof window.__dshWhale.bindJumpSessions === 'function') {
									let sessions = null;
									try { sessions = sCtx.sessions; } catch (e) { /* gated */ }
									window.__dshWhale.bindJumpSessions(sessions, null, uiw);
								}
							} catch (e) { console.warn('[dsh-whale-assistant] uiWorkspace bind skipped:', e && e.message); }
						});
					} catch (e) { /* uiWorkspace unavailable on this engine */ }
					/* 11-08 侧边栏入口+页面（官方 slots API，路线①——与插件页/
					 * 自动化任务页/第三方「上下文洞察」dsh-context 完全同构）：
					 * panellist id 与 main key 成对注册（layout.selectPanel 校验
					 * main 同 key，缺一即抛）。React 缺席（老引擎）→ 整体跳过。 */
					try {
						ctx.inject(['slots'], (sCtx) => {
							try {
								let slots = null;
								try { slots = sCtx.slots; } catch (e) { /* gated */ }
								if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function' || !React) return;
								slots.inject('sidebar.panellist', function () {
									return slots.register({
										name: 'sidebar.panellist',
										id: 'whale-assistant',
										order: 30,
										label: '小鲸鱼助手'
									}, WhalePanelIcon);
								});
								slots.inject('main', function () {
									return slots.register({ name: 'main', key: 'whale-assistant' }, WhalePanelPage);
								});
							} catch (e) { console.warn('[dsh-whale-assistant] sidebar register skipped:', e && e.message); }
						});
					} catch (e) { /* slots 服务不可用（0.1.x web 老引擎） */ }
					/* 11-11 真机修复轮（用户要求右键菜单恢复「设置」）：官方页面
					 * 切换 API=ctx.layout.selectPanel(id)（缺 key 抛异常且保持
					 * 现状——app.asar 内嵌文档实锤）。桥=stash 服务实例的脸到
					 * window，菜单防御式调；0.1.x web 老引擎/桌宠页无 layout
					 * 服务 → 桥缺席 → 菜单回落 uiSay 指路。 */
					try {
						ctx.inject(['layout'], (sCtx) => {
							try {
								let layout = null;
								try { layout = sCtx.layout; } catch (e) { /* gated */ }
								if (!layout || typeof layout.selectPanel !== 'function') return;
								window.__dshWhaleSelectPanel = function (id) { return layout.selectPanel(id); };
							} catch (e) { console.warn('[dsh-whale-assistant] layout bind skipped:', e && e.message); }
						});
					} catch (e) { /* layout 服务不可用 */ }
					/* 11-11 三报：桌宠菜单「设置」→宿主广播 pet/open-settings 帧
					 * →server-events 派发事件→这里执行真跳转。监听常驻（layout
					 * 桥经异步 inject 送达，帧到达时桥必然已就位——inject 先于
					 * 任何用户交互）。 */
					try {
						window.addEventListener('dsh-whale:pet-open-settings', function () {
							try {
								if (typeof window.__dshWhaleSelectPanel === 'function') {
									window.__dshWhaleSelectPanel('whale-assistant');
								}
							} catch (e) { console.warn('[dsh-whale-assistant] open-settings jump skipped:', e && e.message); }
						});
					} catch (e) { /* window listener unavailable */ }
				}
		};
	},
});
