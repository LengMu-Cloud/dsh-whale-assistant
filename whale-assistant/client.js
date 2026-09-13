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
				 * on an internal service just to load. Both bind orders handled —
				 * whale already eval'd → bind directly; bridge ran first → stash
				 * for the whale's boot pickup (window.__dshWhaleSessions). */
				try {
					ctx.inject(['sessions'], (sCtx) => {
						const sessions = sCtx && sCtx.sessions;
						if (window.__dshWhale && typeof window.__dshWhale.bindJumpSessions === 'function') {
							window.__dshWhale.bindJumpSessions(sessions);
						} else {
							window.__dshWhaleSessions = sessions;
						}
					});
				} catch (e) { /* sessions service unavailable on this client build */ }
			}
		};
	},
});
