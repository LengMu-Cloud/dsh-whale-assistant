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
	factory: () => {
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

			(0, eval)(code);
			console.log('[dsh-whale-assistant] whale loaded from plugin routes');
		}).catch((e) => console.error('[dsh-whale-assistant] whale load failed', e));
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
				}
		};
	},
});
