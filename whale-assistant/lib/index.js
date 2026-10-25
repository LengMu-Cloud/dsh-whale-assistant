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
import { loadStore, saveStoreAtomic, mergeHistory } from './store.js';

const inject = ['webServer', 'sessionController'];

const DOC_LIMIT = 512 * 1024;

function storeDir() {
	return join(homedir(), '.dsh');
}

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

/** Shared POST body reader: accumulate up to `limit` bytes (413 + socket
 * destroy beyond), then hand the parsed JSON (and raw text) to onBody.
 * Parse/validation failures go to onError (default: 400 with the message);
 * a transport error is answered 400 read-error instead of hanging the
 * client. Replaces the three byte-identical copies that used to live in
 * the save / debug / dev-say handlers. */
function readJsonBody(req, res, limit, onBody, onError) {
	const chunks = [];
	let size = 0;
	let done = false;
	req.on('data', (chunk) => {
		size += chunk.length;
		if (size > limit && !done) {
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
			onBody(JSON.parse(raw), raw);
		} catch (error) {
			try {
				(onError || ((err) => {
					res.writeHead(400, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":' + JSON.stringify(String(err && err.message || err)) + '}');
				}))(error);
			} catch (e) { /* headers already gone */ }
		}
	});
	req.on('error', () => {
		if (done) return;
		done = true;
		try {
			res.writeHead(400, { 'cache-control': 'no-store' });
			res.end('{"ok":false,"error":"read-error"}');
		} catch (e) { /* socket already gone */ }
	});
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
const sseClients = new Set(); /* EventSource responses (0.4.0 push channel) */

function pushFrame(frame) {
	frame.seq = ++frameSeq;
	recentFrames.push(frame);
	while (recentFrames.length > 400) recentFrames.shift();
	/* SSE fan-out: deliver the frame the moment it exists — network push is
	 * NOT throttled in hidden tabs (timers are), so background notification
	 * latency drops from "whenever the throttled 3s poll next runs" to now */
	if (sseClients.size) {
		const payload = 'data: ' + JSON.stringify(frame) + '\n\n';
		for (const res of sseClients) {
			try { res.write(payload); } catch (e) { sseClients.delete(res); }
		}
	}
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
		/* 0.3.3: inject 而非裸取——投影服务与本插件的激活顺序无保证，服务未挂载时
		 * 裸取 ctx.sessionProjections 是 undefined，`?.` 把整个订阅静默吞掉
		 * （真机验尸：真实任务后事件环 20 帧、零投影帧 = 转发代码存在但从未触发）。
		 * 投影服务文档明确要求 inject 声明；照本文件 jobs 订阅同款模式，
		 * 服务就绪后再挂 onChanged，签名 (session, key, value, seq)。 */
		ctx.inject(['sessionProjections'], (spCtx) => {
			spCtx.sessionProjections?.onChanged((session, key, value) => {
				if (!session) return;
				pushFrame({ type: 'session/projection', sessionId: session.id, key, value });
			});
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
				readJsonBody(req, res, DOC_LIMIT, (parsed) => {
					if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
						throw new Error('document must be a JSON object');
					}
					/* History arrives as a full-document replace from every
					 * window — merge (never replace) via mergeHistory
					 * (lib/store.js), then persist through the atomic writer. */
					mergeHistory(loadStore(storeDir()), parsed);
					saveStoreAtomic(storeDir(), parsed);
					res.writeHead(200, {
						'content-type': 'application/json; charset=utf-8',
						'cache-control': 'no-store'
					});
					res.end('{"ok":true}');
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
				/* Debug/diagnostics route: the alpha adapter posts DOM mutation
				 * fingerprints here while tuning turn/start + attention
				 * detection; `kind:"history-remove"` is the test-teardown hook
				 * (save is merge-only, teardown needs surgical deletion).
				 * Writes ~/.dsh/whale-debug.json (read it from disk;
				 * loopback-only like every other route). */
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
				readJsonBody(req, res, DOC_LIMIT, (parsed, raw) => {
					if (parsed && parsed.kind === 'history-remove' && typeof parsed.sessionId === 'string') {
						const doc = loadStore(storeDir());
						const before = doc && Array.isArray(doc.history) ? doc.history.length : 0;
						const kept = doc && Array.isArray(doc.history)
							? doc.history.filter((e) => e && e.sessionId !== parsed.sessionId)
							: [];
						if (doc) {
							doc.history = kept;
							saveStoreAtomic(storeDir(), doc);
						}
						res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
						res.end(JSON.stringify({ ok: true, removed: before - kept.length }));
						return;
					}
					mkdirSync(storeDir(), { recursive: true });
					writeFileSync(join(storeDir(), 'whale-debug.json'), raw, 'utf8');
					res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
					res.end('{"ok":true}');
				}, () => {
					res.writeHead(400, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"bad-json"}');
				});
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
				readJsonBody(req, res, 65536, (body) => {
					(async () => {
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
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/events/stream',
			handler: (req, res) => {
				if (req.method !== 'GET') {
					res.writeHead(405, { 'cache-control': 'no-store' });
					res.end();
					return;
				}
				if (!isLoopbackRequest(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('forbidden');
					return;
				}
				/* 0.4.0 push channel: hello + live frames + heartbeats. EventSource
				 * reconnects on its own (retry below); a dropped socket just
				 * removes the subscriber. */
				res.writeHead(200, {
					'content-type': 'text/event-stream; charset=utf-8',
					'cache-control': 'no-store',
					connection: 'keep-alive'
				});
				req.socket.setTimeout(0);
				res.write('retry: 3000\n\n');
				res.write('data: ' + JSON.stringify({ type: 'hello', bootId, now: Date.now() }) + '\n\n');
				sseClients.add(res);
				req.on('close', () => sseClients.delete(res));
				req.on('error', () => sseClients.delete(res));
			}
		}
	];
	const disposers = [];
	for (const route of routes) {
		try {
			disposers.push(ctx.webServer.register(route));
		} catch (error) {
			/* A duplicate exact route means an earlier whale instance is still
			 * serving these paths (hot reload raced its teardown, e.g. after an
			 * edit to the linked lib/). The old instance owns the routes: skip
			 * re-registering instead of failing the whole component, and its
			 * own disposer remains responsible for cleanup. */
			if (/duplicate/.test(String(error && error.message || error))) {
				console.warn('[dsh-whale-assistant] route already registered, skipping:', route.path);
				disposers.push(() => {});
			} else {
				throw error;
			}
		}
	}
	/* SSE heartbeat: a real event the whale counts toward server liveness —
	 * an IDLE server must not read as dead to the health check (R3) */
	const sseHeartbeat = setInterval(() => {
		for (const res of sseClients) {
			try { res.write('data: ' + JSON.stringify({ type: 'ping' }) + '\n\n'); } catch (e) { sseClients.delete(res); }
		}
	}, 20000);
	/* unref: the heartbeat must never be the handle keeping an otherwise-idle
	 * event loop alive (the listening server socket is the real keep-alive) */
	if (typeof sseHeartbeat.unref === 'function') sseHeartbeat.unref();
	disposers.push(() => {
		clearInterval(sseHeartbeat);
		/* end every open SSE response during disposal: the desktop update path
		 * grants the whole engine tree only ~10s before SIGTERM (main.js
		 * requireGraceful), so a live EventSource socket must not be left for
		 * the webServer teardown to chase via client disconnects */
		for (const res of sseClients) {
			try { res.end(); } catch (e) { /* client already gone */ }
		}
		sseClients.clear();
	});
	return () => {
		for (const dispose of disposers) dispose();
	};
}

export { apply, inject };