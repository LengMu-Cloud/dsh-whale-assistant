/**
 * dsh-whale-assistant host half:
 * 1. persists whale data (task history) server-side in ~/.dsh/whale-assistant.json
 *    so every browser/window/profile sees the SAME data;
 * 2. serves the whale script itself (/api/whale-assistant/whale.js) — the whale
 *    NO LONGER needs the dist/index.html injection, so DSH upgrades/reinstalls
 *    can never wipe it again (the browser half loads it from here).
 *
 * Routes (loopback-only + the platform-style browser fence — exact routes
 * BYPASS the /api prefix fence dsh-client-connection puts in front of its
 * own routes, so this file carries its own: see isTrustedRequest):
 *   GET  /api/whale-assistant/state    -> the whole stored document
 *   POST /api/whale-assistant/save     -> replace the document (JSON body, 512KiB cap)
 *   GET  /api/whale-assistant/whale.js -> the whale script (dev source dir first)
 *
 * Mirrors the @linxin666/dsh-client-ui-task-board host-half recipe
 * (webServer.register returning disposers + exact routes).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStoreAtomic, saveFileAtomic, mergeHistory, queueStoreWrite } from './store.js';
import { applyPet } from './pet.js';

const inject = ['webServer', 'sessionController'];

const DOC_LIMIT = 512 * 1024;

/* dev-say is a headless PROMPT INJECTOR for e2e — it must not sit on a
 * production webServer. Register it only when DSH itself is started with
 * DSH_WHALE_DEV=1 (live-e2e-test.js depends on it). */
const DEV_ENDPOINTS = process.env.DSH_WHALE_DEV === '1';

function storeDir() {
	return join(homedir(), '.dsh');
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

/** The platform puts a browser fence (dsh-client-connection admit()) in
 * front of its OWN /api routes — Host check + sec-fetch-site + Origin.
 * Exact routes like ours BYPASS that prefix fence, so the whale carries
 * its own copy of the same semantics:
 * 1. Host must name THIS listener (127.0.0.1|localhost|[::1]:localPort) —
 *    the anti-DNS-rebinding line: a rebound page names the attacker's
 *    domain in the URL, and Host is the one header rebinding cannot forge;
 * 2. sec-fetch-site: cross-site is refused outright (kills the no-prefill
 *    CSRF POST a public page can send with text/plain);
 * 3. an Origin header, when a browser sends one, must be this same
 *    authority (blocks a page served from another localhost port).
 * curl / local e2e tools send none of the browser headers and pass. */
function isTrustedRequest(req) {
	const port = req.socket.localPort;
	const host = String(req.headers.host || '');
	if (!port || (host !== '127.0.0.1:' + port && host !== 'localhost:' + port && host !== '[::1]:' + port)) return false;
	const sfs = String(req.headers['sec-fetch-site'] || '');
	if (sfs === 'cross-site') return false;
	const origin = req.headers.origin;
	if (origin !== undefined) {
		try {
			if (new URL(String(origin)).host !== host) return false;
		} catch (e) { return false; }
	}
	return true;
}

/** Route guard: the connection must originate from loopback AND the
 * request must not smell like a browser-forged cross-site/rebound call. */
function isAllowed(req) {
	return isLoopbackRequest(req) && isTrustedRequest(req);
}

/** Shared POST body reader: accumulate up to `limit` bytes (413 + socket
 * destroy beyond), then hand the parsed JSON (and raw text) to onBody.
 * Parse/validation failures go to onError (default: 400 with the message);
 * a transport error is answered 400 read-error instead of hanging the
 * client. Replaces the three byte-identical copies that used to live in
 * the save / debug / dev-say handlers. */
function readJsonBody(req, res, limit, onBody, onError) {
	/* declared JSON bodies only: the content-type requirement kills the
	 * text/plain "simple request" path a public page could otherwise use
	 * to POST here without a CORS preflight (the page half and every e2e
	 * caller already send application/json) */
	const ct = String(req.headers['content-type'] || '');
	if (!/application\/json/i.test(ct)) {
		res.writeHead(415, { 'cache-control': 'no-store' });
		res.end('{"ok":false,"error":"content-type"}');
		return;
	}
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
	 * latency drops from "whenever the throttled 3s poll next runs" to now.
	 * pet clients (11-06 通知延时修复) receive the ENUMERATED frame instead:
	 * enumerateForPet runs per-frame against the SAME code book /pet/feed
	 * uses, so the pet channel stays enumerated (no real session ids, no
	 * conversation content) AND realtime. Clients are stored as
	 * {res, pet} records — a plain res is treated as a page-whale client. */
	if (sseClients.size) {
		for (const client of sseClients) {
			const res = client && client.res ? client.res : client;
			try {
				if (client && client.pet) {
					for (const ev of client.enumerate(frame)) {
						res.write('data: ' + JSON.stringify(ev) + '\n\n');
					}
				} else {
					res.write('data: ' + JSON.stringify(frame) + '\n\n');
				}
			} catch (e) { sseClients.delete(client); }
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
			/* 真名主动帧（11-06 二轮）：任务开工会铸码（pet 枚举流的合成 id
			 * 就此诞生），但老会话的标题早已生成、onChanged 永不再广播——
			 * 桌宠 SSE 稳态下 titles 预填不刷新，通知退回「任务 N」。开工会
			 * 话有真名就立即推一条 projection title（petCtl.announceTitle，
			 * 30s memo 的全量标题源），通知生成时真名已在。petCtl 未就位
			 * （boot 极早期）静默跳过——下一任务自然补上。 */
			if (event.type === 'turn/start' && petCtl && typeof petCtl.announceTitle === 'function') {
				try { petCtl.announceTitle(session.id); } catch (e) { /* title is best-effort */ }
			}
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

	/* the pet host attaches AFTER route registration (it needs the live
	 * webServer/port); the events route reads its state lazily per request */
	let petCtl = null;

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
				if (!isAllowed(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"ok":false,"error":"forbidden"}');
					return;
				}
				/* loadStore shares the corruption-quarantine path with save:
				 * the old direct readFileSync handed a corrupt ledger back
				 * as the body (and only a later save would quarantine it) */
				const doc = loadStore(storeDir());
				const body = doc === null ? '{}' : JSON.stringify(doc);
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
				if (!isAllowed(req)) {
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
					 * (lib/store.js), then persist through the atomic writer.
					 * The write goes through the SAME serialized queue the pet
					 * host uses: two interleaved load→mutate→rename cycles used
					 * to be able to lose one side's rows whole-file. */
					queueStoreWrite(storeDir(), () => {
						mergeHistory(loadStore(storeDir()), parsed);
						saveStoreAtomic(storeDir(), parsed);
					}).then(() => {
						res.writeHead(200, {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store'
						});
						res.end('{"ok":true}');
					}).catch((error) => {
						res.writeHead(500, { 'cache-control': 'no-store' });
						res.end('{"ok":false,"error":' + JSON.stringify(String(error && error.message || error)) + '}');
					});
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
				if (!isAllowed(req)) {
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
				if (!isAllowed(req)) {
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
					saveFileAtomic(join(storeDir(), 'whale-debug.json'), raw);
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
				if (!isAllowed(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('{"events":[]}');
					return;
				}
				/* 桌宠自愈心跳（11-04）：页鲸 3s 轮询=宿主唯一稳定心跳——
				 * pet 死亡（窗口消失自杀/强杀）后页鲸苏醒接管但永不再退位的
				 * 死局，在这里每拍检查重生（pet.js 内置 60s 冷却防 crash loop） */
				try { if (petCtl && typeof petCtl.heartbeat === 'function') petCtl.heartbeat(); } catch (e) { }
				res.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store'
				});
				res.end(JSON.stringify({
					events: recentFrames.slice(-360),
					now: Date.now(),
					bootId,
					/* 桌宠仲裁 flag (first batch): the page whale reads this on
					 * every poll and goes DORMANT while the screen pet owns the
					 * visuals — recording continues, whales don't double up.
					 * form rides along: a HIDDEN pet wakes the page whale
					 * (真机反馈 10-31#3). up=false during the spawn window:
					 * page whales STAY PUT until the pet window is actually
					 * visible (接力式交接 11-01，页鲸等到桌宠出现才潜水） */
					pet: {
						enabled: !!(petCtl && petCtl.state().enabled),
						form: petCtl ? petCtl.state().form : 'full',
						up: petCtl ? petCtl.state().up !== false : true,
						/* spawn 窗口标志（11-05）：页鲸凭它区分「桌宠正在出生」与
						 * 「桌宠已死」——窗口期保持休眠，开机不再双鲸同屏（真机
						 * 抓包 t2.9→t4.3 页鲸迟到潜水=用户看到的「两个同时出现」）。 */
						spawning: petCtl ? !!petCtl.state().spawning : false
					}
				}));
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
				if (!isAllowed(req)) {
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
				if (!isAllowed(req)) {
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
				if (!isAllowed(req)) {
					res.writeHead(403, { 'cache-control': 'no-store' });
					res.end('forbidden');
					return;
				}
				/* 0.4.0 push channel: hello + live frames + heartbeats. EventSource
				 * reconnects on its own (retry below); a dropped socket just
				 * removes the subscriber. 11-06: a connection carrying the LIVE
				 * pet token becomes a PET client — it receives per-frame
				 * enumerated payloads (same code book as /pet/feed) instead of
				 * the raw buffer, so the pet whale can ride realtime push
				 * without breaching the enumeration boundary. Token-less
				 * connections keep the legacy full-frame behaviour. */
				const petClient = !!(petCtl && typeof petCtl.checkToken === 'function' && petCtl.checkToken(req));
				res.writeHead(200, {
					'content-type': 'text/event-stream; charset=utf-8',
					'cache-control': 'no-store',
					connection: 'keep-alive'
				});
				req.socket.setTimeout(0);
				res.write('retry: 3000\n\n');
				/* hello carries the pet arbitration flag: an SSE-connected page
				 * never polls /events, so connect-time dormancy must ride here
				 * (2026-10-31 真机：缺它=页内鲸鱼重载后永久隐藏） */
				res.write('data: ' + JSON.stringify({
					type: 'hello',
					bootId,
					now: Date.now(),
					pet: {
						enabled: !!(petCtl && petCtl.state().enabled),
						form: petCtl ? petCtl.state().form : 'full',
						up: petCtl ? petCtl.state().up !== false : true,
						/* spawn 窗口标志（11-05）：页鲸凭它区分「桌宠正在出生」与
						 * 「桌宠已死」——窗口期保持休眠，开机不再双鲸同屏（真机
						 * 抓包 t2.9→t4.3 页鲸迟到潜水=用户看到的「两个同时出现」）。 */
						spawning: petCtl ? !!petCtl.state().spawning : false
					}
				}) + '\n\n');
				const clientRecord = { res, pet: petClient, enumerate: petClient ? petCtl.enumerateForPet : null };
				sseClients.add(clientRecord);
				req.on('close', () => sseClients.delete(clientRecord));
				req.on('error', () => sseClients.delete(clientRecord));
				/* 跳转/设置补偿（11-11 四轮，用户实报「后台挂着也要能跳」）：页鲸
				 * 不在场期间桌宠落的 pending 意图（ledger）——页鲸 SSE 接入即补投
				 * （120s 新鲜闸：过期意图不再兑现，防止陈旧跳转突袭）。走 pushFrame
				 * （入 recentFrames+SSE 扇出），页鲸消费后自动落到目标会话/设置页
				 * ——用户随手重开 DSH 窗口即自动兑现，不用再手动重跳。
				 * **只对页鲸连接补投**（!petClient）：桌宠自己的 SSE 接入若也触发
				 * 补投，会把 pending 清给一个消费不了的连接=白扔。 */
				if (!petClient) {
					try {
						const pendDoc = loadStore(storeDir());
						const pj = pendDoc && pendDoc.pendingJump;
						const pset = pendDoc && pendDoc.pendingSettings;
						const pjFresh = !!(pj && pj.sessionId && Date.now() - (pj.time || 0) < 120000);
						const psFresh = !!(pset && Date.now() - (pset.time || 0) < 120000);
						/* 单一意图语义（11-14，用户实报「跳转偶发弹开的是设置页」）：
						 * 两个 pending 同窗时只兑现**较新**的一项——用户的最新动作
						 * 取代旧承诺（点过设置后又点了会话跳转，醒来该去会话不是
						 * 设置）；被压制的旧意图一并清除（留守只会变成下一次唤醒
						 * 的过期重演）。 */
						let deliverJump = pjFresh;
						let deliverSettings = psFresh;
						if (deliverJump && deliverSettings) {
							if ((pj.time || 0) >= (pset.time || 0)) deliverSettings = false;
							else deliverJump = false;
						}
						if (deliverJump) {
							pushFrame({ type: 'pet/jump', sessionId: pj.sessionId, atMs: typeof pj.atMs === 'number' && pj.atMs > 0 ? pj.atMs : undefined, time: Date.now() });
						}
						if (deliverSettings) {
							pushFrame({ type: 'pet/open-settings', time: Date.now() });
						}
						if (pjFresh || psFresh) {
							queueStoreWrite(storeDir(), () => {
								const d = loadStore(storeDir()) || {};
								if (pjFresh) delete d.pendingJump;
								if (psFresh) delete d.pendingSettings;
								saveStoreAtomic(storeDir(), d);
								return d;
							}).catch(() => {});
						}
					} catch (e) { /* ledger 不可用：跳过补偿 */ }
				}
			}
		}
		];
		/* dev-say stays off production servers (see DEV_ENDPOINTS above) */
		const activeRoutes = DEV_ENDPOINTS ? routes : routes.filter((r) => r.path !== '/api/whale-assistant/dev-say');
		const disposers = [];
		for (const route of activeRoutes) {
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
		for (const client of sseClients) {
			const res = client && client.res ? client.res : client;
			try { res.write('data: ' + JSON.stringify({ type: 'ping' }) + '\n\n'); } catch (e) { sseClients.delete(client); }
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
		for (const client of sseClients) {
			const res = client && client.res ? client.res : client;
			try { res.end(); } catch (e) { /* client already gone */ }
		}
		sseClients.clear();
	});
	/* Pet host (桌宠, first batch): spawns pet/pet.ps1 when the ledger switch
	 * is on, serves /pet/* (page + enumerated feed + ctrl). It reuses THIS
	 * module's fence/body-reader — the security-critical predicate is never
	 * duplicated. Its disposer kills the whole process tree (taskkill /T):
	 * the ~10s desktop-update graceful window must not be spent chasing
	 * WebView2 orphans that would lock the DLLs. */
	petCtl = applyPet(ctx, {
		isAllowed,
		readJsonBody,
		getFrames: () => recentFrames,
		pushFrame,
		bootId,
		/* 跳转落点探测（11-06 常驻语义）：关窗≠退出后页鲸可能不在场（窗口
		 * 关了 DOM 就没了）——桌宠双击跳转时宿主广播 pet/jump，但没有页鲸
		 * 消费=无声失败。把「页鲸是否在场」（SSE 连接数）交给 jump 响应，
		 * 桌宠页据此提示用户而不是干点没反应。 */
		/* 「页鲸是否在场」必须**排除桌宠自己的连接**（11-11 四轮根修，用户实报
		 * 「关窗后跳转失效」）：桌宠常驻期间它自己的 pet-token SSE 恒在——旧
		 * 实现 size>0 把它当页鲸，delivered 恒 true=关窗后的跳转/刷新广播永远
		 * "有人消费"（实际无人），补偿链（pendingJump/revive）整个死路（11-06
		 * 起的 delivered 语义对这个场景一直是坏的）。pet 客户端带 pet:true
		 * 标记（见下 clientRecord），只数非 pet 连接。 */
		hasPageClients: () => {
			for (const c of sseClients) { if (c && !c.pet) return true; }
			return false;
		},
		/* 存量标题预填（11-03）：session/title 事件只在标题**变化**时广播，
		 * 桌宠起来后老会话（标题早已生成）不会有 title 帧——页鲸靠开机取
		 * 名从历史预填，桌宠走同一条路：宿主从账本历史提取 真实会话→标题，
		 * pet 层用码本转成合成 id 再下发（真实 id 永不出宿主）。 */
		getHistoryTitles: () => {
			try {
				const doc = loadStore(storeDir());
				const out = {};
				if (doc && Array.isArray(doc.history)) {
					for (const e of doc.history) {
						if (e && typeof e.sessionId === 'string' && typeof e.title === 'string' && e.title) {
							out[e.sessionId] = e.title;
						}
					}
				}
				return out;
			} catch (e) {
				return {};
			}
		},
		/* 真名全量预填（11-05，用户实报「对话通知有时候识别不到名称」）：
		 * 账本历史只是有损来源（清空过/从未记录的会话没有标题快照）——
		 * sessionController.list() 是侧栏正在用的同一份会话清单（含冷会话
		 * 的标题投影缓存），从这里拿全量 真实会话→现势标题。失败静默回落
		 * 账本路径；真实 id 仍只在宿主内存，pet 层码本转码后下发。 */
		listSessionTitles: () => {
			const sc = ctx.sessionController;
			if (!sc || typeof sc.list !== 'function') return Promise.resolve({});
			return Promise.resolve(sc.list(AbortSignal.timeout(5000))).then((items) => {
				const out = {};
				if (Array.isArray(items)) {
					for (const it of items) {
						if (!it || typeof it.sessionId !== 'string') continue;
						const t = it.projections && it.projections.values && it.projections.values.title;
						if (typeof t === 'string' && t) out[it.sessionId] = t;
					}
				}
				return out;
			}).catch(() => ({}));
		},
		/* 桌宠历史抽屉（11-05）：账本目录（loadStore/saveStoreAtomic 的落点），
		 * /pet/history 读 + clear-history 写都走这里——目录语义不重复实现。 */
		ledgerDir: () => storeDir()
	});
	disposers.push(() => { petCtl.dispose(); });

	return () => {
		for (const dispose of disposers) dispose();
	};
}

/* isTrustedRequest is exported for test-host-store.js — the fence deserves
 * the same regression coverage as the ledger it guards */
export { apply, inject, isTrustedRequest };