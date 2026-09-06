/**
 * dsh-whale-assistant host half:
 * 1. persists whale data (task history) server-side in ~/.dsh/whale-assistant.json
 *    so every browser/window/profile sees the SAME data;
 * 2. serves the whale script itself (/api/whale-assistant/whale.js) — the whale
 *    NO LONGER needs the dist/index.html injection, so DSH upgrades/reinstalls
 *    can never wipe it again (the browser half loads it from here).
 *
 * Routes (loopback-only, like the task-board fence):
 *   GET  /api/whale-assistant/state    -> the whole stored document
 *   POST /api/whale-assistant/save     -> replace the document (JSON body, 512KiB cap)
 *   GET  /api/whale-assistant/whale.js -> the whale script (dev source dir first)
 *
 * Mirrors the @linxin666/dsh-client-ui-task-board host-half recipe
 * (webServer.register returning disposers + exact routes).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const inject = ['webServer', 'sessionController'];

const DOC_LIMIT = 512 * 1024;

function storeFile() {
	return join(homedir(), '.dsh', 'whale-assistant.json');
}

/** Whale script source: the plugin dir's own copy (release layout).
 * build-whale.js keeps lib/whale.js byte-identical to the tree build. */
function whaleSources() {
	const here = dirname(fileURLToPath(import.meta.url));
	return [join(here, 'whale.js')];
}

/** Static assets: style.css lives in parts/, the logo svg in the root. */
function assetSources(name) {
	const here = dirname(fileURLToPath(import.meta.url));
	const rel = name === 'style.css' ? join('parts', 'style.css') : name;
	return [join(here, rel)];
}

function readFirst(candidates) {
	for (const candidate of candidates) {
		try {
			return readFileSync(candidate, 'utf8');
		} catch (error) { /* try next */ }
	}
	return null;
}

/** Loopback-only guard (task-board fence, trimmed): the desktop shell and
 * every local browser hit 127.0.0.1; anything else is refused. */
function isLoopbackRequest(req) {
	const addr = String(req.socket.remoteAddress || '');
	if (addr === '::1' || addr.startsWith('::ffff:127.')) return true;
	if (/^127\.\d+\.\d+\.\d+$/.test(addr)) return true;
	return false;
}

/** Rolling buffer of wire frames the whale polls (background-session
 * notifications + authoritative turn reasons). The host sits in the same
 * cordis container as the session service, so `ctx.on("session/event")`
 * sees every session — including ones no window is looking at — and
 * `sessionProjections` carries titles/usage for naming notifications. */
const recentFrames = [];
let frameSeq = 0;
/* identity of THIS server generation: the whale persists its last-seen seq
 * per bootId — a host restart resets frameSeq, and a stale seq from the
 * previous generation would silently drop every new frame */
const bootId = globalThis.crypto?.randomUUID?.() || 'boot-' + Date.now();
function pushFrame(frame) {
	frame.seq = ++frameSeq;
	recentFrames.push(frame);
	while (recentFrames.length > 400) recentFrames.shift();
}

function apply(ctx) {
	try {
		ctx.on('session/event', (session, event) => {
			if (!session || !event) return;
			/* assistant/chunk 是逐 token 的流式噪声（一轮可产生上百帧）：
			 * 不加过滤它会在 3s 轮询窗口内把环形缓冲里排在前面的
			 * turn/start 挤出路由窗口，鲸鱼从此永远收不到"开工"帧
			 * （2026-09-03 用户实测：完成通知正常、开工通知消失）。
			 * 页面侧本来就不消费 chunk，宿主直接不缓冲。 */
			if (event.type === 'assistant/chunk') return;
			pushFrame({
				type: 'session/event',
				sessionId: session.id,
				event: { type: event.type, time: event.time, data: event.data }
			});
		});
	} catch (e) { /* events unavailable on this host version */ }
	try {
		ctx.sessionProjections?.onChanged((session, key, value) => {
			if (!session) return;
			pushFrame({ type: 'session/projection', sessionId: session.id, key, value });
		});
	} catch (e) { /* projections unavailable */ }
	try {
		ctx.inject(['jobs'], (jobsCtx) => {
			jobsCtx.jobs?.onJobsChanged?.((owner) => {
				if (!owner) return;
				pushFrame({ type: 'session/jobs', sessionId: owner.id !== undefined ? owner.id : String(owner), jobs: [] });
			});
		});
	} catch (e) { /* jobs service unavailable */ }

	const routes = [
		{
			kind: 'exact',
			path: '/api/whale-assistant/state',
			handler: (req, res) => {
				if (req.method !== 'GET') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"forbidden"}');
					return;
				}
				let body = '{}';
				try {
					body = readFileSync(storeFile(), 'utf8');
				} catch (error) {
					body = '{}'; /* first run: no file yet */
				}
				res.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store'
				});
				res.end(body);
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/save',
			handler: (req, res) => {
				if (req.method !== 'POST') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"forbidden"}');
					return;
				}
				const chunks = [];
				let size = 0;
				let done = false;
				req.on('data', (chunk) => {
					size += chunk.length;
					if (size > DOC_LIMIT && !done) {
						done = true;
						res.writeHead(413, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":"body-too-large"}');
						req.destroy();
						return;
					}
					chunks.push(chunk);
				});
				req.on('end', () => {
					if (done) return;
					done = true;
					try {
						const raw = Buffer.concat(chunks).toString('utf8');
						const parsed = JSON.parse(raw); /* must be valid JSON */
						if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
							throw new Error('document must be a JSON object');
						}
						/* History arrives as a full-document replace from every
						 * window — two live windows (or a page reload mid-push)
						 * would silently erase each other's records. Merge the
						 * incoming history with the stored one instead: union by
						 * the client's dedupe key (sessionId|endTime|kind),
						 * preferring the richer entry (a real title beats the
						 * 未命名任务 placeholder, then the newer `at`). */
						let existing = null;
						try {
							existing = JSON.parse(readFileSync(storeFile(), 'utf8'));
						} catch (e) { /* first run */ }
						if (Array.isArray(parsed.history)) {
							/* Deletion sync: a 清空历史 bumps `clearAt` (a generation
							 * marker persisted in this doc). Merge-only sync can
							 * never propagate a deletion — records cleared on one
							 * window resurrected from the store on the next pull.
							 * Every record OLDER than clearAt is dropped here and
							 * on every client-side merge. */
							const clearAt = Math.max((existing && existing.clearAt) || 0, parsed.clearAt || 0);
							parsed.clearAt = clearAt;
							const alive = (e) => !clearAt || (e && (e.at || 0) >= clearAt);
							const richness = (e) => (e && e.title && e.title !== '未命名任务' ? 2 : 0) + (e && (e.endTime || e.at) ? 1 : 0);
							const seen = new Map();
							const put = (e) => {
								if (!e || typeof e !== 'object' || Array.isArray(e)) return;
								const key = [e.sessionId || '', e.endTime || e.at || 0, e.kind || ''].join('|');
								const prev = seen.get(key);
								if (prev === undefined) { seen.set(key, e); return; }
								if (richness(e) > richness(prev)) seen.set(key, e);
								else if (richness(e) === richness(prev) && (e.at || 0) > (prev.at || 0)) seen.set(key, e);
							};
							/* second pass: collapse same-turn re-fires (the DOM chip
							 * can race a page reload and push one turn twice with
							 * 70ms-different endTime, which the exact key misses) */
							const all = [...seen.values()].sort((x, y) => (x.at || 0) - (y.at || 0));
							seen.clear();
							/* (clear BEFORE the rebuild: rebuilding into the same map
							 * without clearing left the original exact keys in place
							 * and the whole pass was a no-op) */
							for (const e of all) {
								const near = [...seen.keys()].find((k) => {
									const p = seen.get(k);
									return p.sessionId === e.sessionId && p.kind === e.kind
										&& Math.abs((p.turnTokens || 0) - (e.turnTokens || 0)) < 1
										&& Math.abs((e.at || 0) - (p.at || 0)) < 120000;
								});
								if (near !== undefined) {
									if (richness(e) > richness(seen.get(near))) seen.set(near, e);
									continue;
								}
								seen.set([...seen.keys()].length + '|' + (e.at || 0) + '|' + (e.kind || ''), e);
							}
							for (const e of (existing && Array.isArray(existing.history) ? existing.history : []).filter(alive)) put(e);
							for (const e of parsed.history.filter(alive)) put(e);
							parsed.history = [...seen.values()]
								.sort((x, y) => (y.at || 0) - (x.at || 0))
								.slice(0, 500);
						}
						mkdirSync(join(homedir(), '.dsh'), { recursive: true });
						writeFileSync(storeFile(), JSON.stringify(parsed), 'utf8');
						res.writeHead(200, {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store'
						});
						res.end('{"ok":true}');
					} catch (error) {
						res.writeHead(400, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":' + JSON.stringify(String(error && error.message || error)) + '}');
					}
				});
				req.on('error', () => {
					if (done) return;
					done = true;
					try {
						res.writeHead(400, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":"read-error"}');
					} catch (e) {}
				});
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/assets',
			handler: (req, res) => {
				if (req.method !== 'GET') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"error":"forbidden"}');
					return;
				}
				const css = readFirst(assetSources('style.css')) || '';
				const svg = readFirst(assetSources('whale-logo.svg')) || '';
				res.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store'
				});
				res.end(JSON.stringify({ css, svg }));
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/debug',
			handler: (req, res) => {
				/* TEMP instrumentation: the alpha adapter posts DOM mutation
				 * fingerprints here while tuning turn/start + attention
				 * detection. Writes ~/.dsh/whale-debug.json (read it from
				 * disk; loopback-only like every other route). */
				if (req.method !== 'POST') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"forbidden"}');
					return;
				}
				const chunks = [];
				let size = 0;
				let done = false;
				req.on('data', (chunk) => {
					size += chunk.length;
					if (size > DOC_LIMIT && !done) {
						done = true;
						res.writeHead(413, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":"body-too-large"}');
						req.destroy();
						return;
					}
					chunks.push(chunk);
				});
				req.on('end', () => {
					if (done) return;
					done = true;
					try {
						const raw = Buffer.concat(chunks).toString('utf8');
						const parsed = JSON.parse(raw); /* must be valid JSON */
						/* history-remove: surgical removal by sessionId (test
						 * teardown / diagnostics) — a plain save cannot delete
						 * because save is merge-only. Loopback-only like every
						 * route here. */
						if (parsed && parsed.kind === 'history-remove' && typeof parsed.sessionId === 'string') {
							let doc = null;
							try { doc = JSON.parse(readFileSync(storeFile(), 'utf8')); } catch (e) {}
							const before = doc && Array.isArray(doc.history) ? doc.history.length : 0;
							const kept = doc && Array.isArray(doc.history)
								? doc.history.filter((e) => e && e.sessionId !== parsed.sessionId)
								: [];
							if (doc) {
								doc.history = kept;
								mkdirSync(join(homedir(), '.dsh'), { recursive: true });
								writeFileSync(storeFile(), JSON.stringify(doc), 'utf8');
							}
							res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
							res.end(JSON.stringify({ ok: true, removed: before - kept.length }));
							return;
						}
						mkdirSync(join(homedir(), '.dsh'), { recursive: true });
						writeFileSync(join(homedir(), '.dsh', 'whale-debug.json'), raw, 'utf8');
						res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
						res.end('{"ok":true}');
					} catch (error) {
						res.writeHead(400, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":"bad-json"}');
					}
				});
				req.on('error', () => {});
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/events',
			handler: (req, res) => {
				if (req.method !== 'GET') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"events":[]}');
					return;
				}
				res.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store'
				});
				res.end(JSON.stringify({ events: recentFrames.slice(-360), now: Date.now(), bootId }));
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/dev-say',
			handler: (req, res) => {
				/* DEV/diagnostic: admit one prompt into a session through the
				 * sessionController service (the same entry the UI remote
				 * client calls). Loopback only. Body: {sessionId, text}. Lets
				 * the whale pipeline be tested headlessly — the page reacts
				 * while no window has focus. */
				if (req.method !== 'POST') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"forbidden"}');
					return;
				}
				const chunks = [];
				let size = 0;
				let done = false;
				req.on('data', (chunk) => {
					size += chunk.length;
					if (size > 65536 && !done) {
						done = true;
						res.writeHead(413, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":"body-too-large"}');
						req.destroy();
						return;
					}
					chunks.push(chunk);
				});
				req.on('end', () => {
					if (done) return;
					done = true;
					(async () => {
						const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
						const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
						const text = typeof body.text === 'string' ? body.text.slice(0, 4000) : '';
						if (!sessionId || !text) throw new Error('need sessionId + text');
						/* the session controller service exposes the SAME prompt the
						 * UI's remote client calls (service key 'sessionController'):
						 * full admission path (queue/steer, busy checks) without
						 * importing anything from its package */
						const sc = ctx.sessionController;
						if (!sc || typeof sc.prompt !== 'function') throw new Error('sessionController service unavailable');
						const result = await sc.prompt({
							requestId: 'whale-dev-' + Date.now(),
							sessionId: sessionId,
							mode: 'queue',
							content: [{ type: 'text', text: text }]
						}, AbortSignal.timeout(60000));
						res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
						res.end(JSON.stringify({ ok: true, result: result || null }));
					})().catch((error) => {
						/* the async work itself failed (bad args / service missing /
						 * prompt rejected): ALWAYS answer, never leave the client
						 * hanging on a silent timeout */
						try {
							res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
							res.end('{"ok":false,"error":' + JSON.stringify(String(error && error.message || error)) + '}');
						} catch (e) {}
					});
				});
				req.on('error', () => {});
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/whale.js',
			handler: (req, res) => {
				if (req.method !== 'GET') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('/* forbidden */');
					return;
				}
				let code = null;
				for (const candidate of whaleSources()) {
					try {
						code = readFileSync(candidate, 'utf8');
						break;
					} catch (error) { /* try next source */ }
				}
				if (code === null) {
					res.writeHead(404, { 'cache-control': 'no-store' });
					res.end('console.error("[dsh-whale] whale.js not found on the host");');
					return;
				}
				res.writeHead(200, {
					'content-type': 'application/javascript; charset=utf-8',
					'cache-control': 'no-store'
				});
				res.end(code);
			}
		}
	];
	const disposers = [];
	for (const route of routes) disposers.push(ctx.webServer.register(route));
	return () => {
		for (const dispose of disposers) dispose();
	};
}

export { apply, inject };