/**
 * dsh-whale-assistant PET host (桌宠, first batch — architecture v6):
 * spawns and supervises the screen-level whale window (pet/pet.ps1, a WPF +
 * WebView2 shell that runs the REAL whale.js), serves the pet page and an
 * ENUMERATED data feed over the plugin webServer, and owns the pet switch
 * (ledger key `pet`, shared with every window).
 *
 * Security shape (four-layer review, 2026-10-31 — all four reviewers):
 * - token: 32 random bytes, memory-only (regenerated every spawn; a restart
 *   invalidates it), handed to the pet process through ENV (never argv/URL —
 *   WebView2 persists full navigation URLs to its History store and argv is
 *   readable via WMI). The pet page itself injects it as the
 *   `X-DSH-Pet-Token` request header via CoreWebView2
 *   WebResourceRequested — the page JS never needs to know the value.
 * - AND-stacking, pet channel ONLY: /pet/page|whale.js|style.css|feed|state
 *   require the platform-style browser fence AND the token. The fence alone
 *   still guards every other route (it defends against BROWSERS; local
 *   processes are the platform's existing trust boundary — the token raises
 *   that bar for the pet data channel without creating a global bypass).
 * - /pet/ctrl is fence-only BY DESIGN: it flips config switches (same trust
 *   class as /save, which replaces the whole ledger) and must be callable
 *   from ordinary whale windows (they don't hold the token).
 * - /pet/feed is ENUMERATED: session ids become stable per-boot codes
 *   (pet-s1, pet-s2...), titles/usage/projections are dropped entirely, so
 *   the pet profile on disk never sees conversation content. The pet whale
 *   announces 「任务 N」 instead of real names.
 * - title-channel payloads are region rectangles only (coordinates), as in
 *   the POC — never the token.
 */
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, saveStoreAtomic, queueStoreWrite } from './store.js';

export const inject = [];

const PET_TOKEN_HEADER = 'x-dsh-pet-token';
export const PET_FORMS = ['full', 'bubble', 'hidden'];

function petAssetsDir() {
	return join(dirname(fileURLToPath(import.meta.url)), '..', 'pet');
}
function petRunDir() {
	return join(homedir(), '.dsh', 'pet');
}

/** Tolerant read of the ledger's `pet` key. Unknown shapes fall back to
 * defaults instead of throwing — a hand-edited ledger must not kill boot. */
export function normalizePetDoc(doc) {
	const pet = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.pet : null;
	const enabled = !!(pet && pet.enabled === true);
	let form = pet && typeof pet.form === 'string' ? pet.form : 'full';
	if (PET_FORMS.indexOf(form) === -1) form = 'full';
	return { enabled, form };
}

/** Pure token check (exported for test-host-store.js): constant-time
 * compare of the X-DSH-Pet-Token header against the live token. Absent
 * token / absent header / length mismatch all refuse without throwing. */
export function checkPetToken(req, tokenHex) {
	if (!tokenHex) return false;
	const given = String((req && req.headers && req.headers[PET_TOKEN_HEADER]) || '');
	if (!given || given.length !== tokenHex.length) return false;
	try {
		return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(tokenHex, 'utf8'));
	} catch (e) {
		return false;
	}
}

/* --- enumerated feed ----------------------------------------------------- */

/** Per-boot session code book: real session ids never leave the host in pet
 * payloads; each distinct id maps to a stable small integer.
 * `rev` is the code→session reverse index for the pet jump action (11-03):
 * codes are reassigned per TURN (see codeOf), so the forward map only ever
 * holds a session's LATEST code — rev keeps every code ever issued so an
 * older notification still jumps to the right conversation. */
function newCodeBook() {
	return { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
}

function codeOf(book, sessionId) {
	let n = book.codes.get(sessionId);
	if (n === undefined) {
		n = ++book.next;
		book.codes.set(sessionId, n);
		if (book.rev) book.rev.set(n, sessionId);
	}
	return n;
}

/** Re-open the code for a session that starts a NEW turn: every task gets
 * its own number, so two tasks in one conversation announce as 任务 1 /
 * 任务 2 instead of both reading 任务 1 (11-03 实机：同会话多任务全部
 * 「任务 1」，用户无法区分是哪条任务完成). The reverse index still grows
 * (older notifications keep their jump target). */
function turnCodeOf(book, sessionId) {
	const n = ++book.next;
	book.codes.set(sessionId, n);
	book.rev.set(n, sessionId);
}

/** Boot-stable per-session code（11-05）：enumerateHistory **不许**用每任务
 * 换号的 codes——turnCodeOf 每个新任务都会重开同会话的号，同会话的合成
 * id 跨拉取漂移，抽屉的 dedupe 键（sessionId|endTime|kind）随之失效=
 * 同一条记录以两个合成 id 重复存在。stable 码 boot 内一次铸定永不换，
 * 共享 next 计数器与 rev 反查（历史行跳转与通知跳转同一条链）。 */
function stableCodeOf(book, sessionId) {
	const m = book.stable || (book.stable = new Map());
	let n = m.get(sessionId);
	if (n === undefined) {
		n = ++book.next;
		m.set(sessionId, n);
		if (book.rev) book.rev.set(n, sessionId);
	}
	return n;
}

/** Reverse lookup (exported for /pet/ctrl jump + tests): code → real
 * session id, or null for unknown/expired codes. */
function resolvePetCode(book, n) {
	const sid = book.rev.get(n);
	return typeof sid === 'string' ? sid : null;
}

/** Pure enumerator (exported for test-host-store.js). Whitelist of frames
 * the pet may see, with every content-bearing field stripped:
 * - session/projection: ONLY title / tokenUsage (4 aggregate counts) /
 *   contextPressure (3 counts) survive — the notification name and the
 *   three-line usage report are part of the DESIGNED notification contract
 *   (附录C 通知主干：[真实会话名]完成了 + 本轮/累计/上下文% 三行；11-03 用户
 *   拍板：真名与聚合 token 数落 pet profile，对话正文仍剥离);
 * - session/title events: the real title rides along (same boundary as above);
 * - assistant/message: ONLY the three aggregate usage counts survive
 *   (input/output/cacheRead — no turn/step/message ids, no text);
 * - tool/call: only ask_user_question survives, with a SYNTHETIC callId;
 * - turn/end: only the reason.kind enum survives;
 * - turn/start: kept (开工 announcement), payload emptied;
 * - everything else (message text, tool arguments, execution detail): dropped.
 * Frame-level `seq` is preserved verbatim so the pet whale's last-seen-seq
 * bookkeeping tracks the SAME buffer the page whale consumes. */
/** 审计 D-C1/GAP-11（2026-11-04）：自愈心跳的**纯判定门**（可单测）。
 * 全 true 才允许重生：平台支持 + 常驻开关开 + 不在 spawn 中 + 进程已死
 * （child.exitCode!==null 或从未 spawn 成功）+ 距上次 spawn ≥60s（冷却防
 * crash loop）。 */
export function heartbeatGate(st, now) {
	if (!st || typeof now !== 'number') return false;
	if (!st.supported || !st.enabled || st.spawning) return false;
	if (st.childAlive) return false;
	if (typeof st.lastSpawnAt !== 'number') return false;
	if (now - st.lastSpawnAt < 60000) return false;
	return true;
}

export function enumerateFrames(frames, book) {
	const out = [];
	if (!Array.isArray(frames)) return out;
	for (const frame of frames) {
		if (!frame || typeof frame !== 'object') continue;
		const sid = typeof frame.sessionId === 'string' ? frame.sessionId : '';
		if (!sid || typeof frame.seq !== 'number') continue;
		/* projections: the pet page consumes them through the SAME consume()
		 * branch as the page whale (title naming / tokenUsage totals /
		 * contextPressure percent). Only the three keys the notification
		 * contract needs pass; codes follow the session's CURRENT task code
		 * (no new code — a title arriving before the first turn/start is
		 * dropped rather than forked onto a stray code). */
		if (frame.type === 'session/projection') {
			const cur = book.codes.get(sid);
			if (!cur) continue;
			let value;
			if (frame.key === 'title' && typeof frame.value === 'string') {
				value = frame.value;
			} else if (frame.key === 'tokenUsage' && frame.value && typeof frame.value === 'object') {
				const v = frame.value;
				value = {
					uncachedInputTokens: v.uncachedInputTokens | 0,
					outputTokens: v.outputTokens | 0,
					cacheReadTokens: v.cacheReadTokens | 0,
					cacheWriteTokens: v.cacheWriteTokens | 0
				};
			} else if (frame.key === 'contextPressure' && frame.value && typeof frame.value === 'object') {
				const v = frame.value;
				value = {
					pressureTokens: v.pressureTokens | 0,
					projectedTokens: v.projectedTokens | 0,
					contextWindow: v.contextWindow | 0
				};
			} else {
				continue; /* every other projection key stays stripped */
			}
			out.push({ seq: frame.seq, type: 'session/projection', sessionId: 'session-pet-s' + cur, key: frame.key, value });
			continue;
		}
		if (frame.type !== 'session/event') continue;
		if (!frame.event || typeof frame.event !== 'object') continue;
		const ev = frame.event;
		let data;
		if (ev.type === 'turn/start') {
			/* every task gets its own number (turnCodeOf): the code re-opens
			 * per turn so notifications read 任务 1 / 任务 2 / … — each
			 * session keeps the SET of already-consumed start seqs so the
			 * ring-buffer REPLAY (every /pet/feed request re-runs this
			 * enumerator over the same frames) cannot churn codes, while a
			 * genuinely new start (new seq) still opens a fresh number.
			 * Books WITHOUT a turns map (older hand-rolled test fixtures)
			 * keep the legacy one-code-per-session behaviour. */
			if (book.turns) {
				let seen = book.turns.get(sid);
				if (!seen) { seen = new Set(); book.turns.set(sid, seen); }
				if (!seen.has(frame.seq)) {
					seen.add(frame.seq);
					turnCodeOf(book, sid);
				}
			}
			data = {};
		} else if (ev.type === 'turn/end') {
			const kind = ev.data && ev.data.reason && ev.data.reason.kind;
			if (kind !== 'completed' && kind !== 'error' && kind !== 'max-tokens' && kind !== 'aborted') continue;
			data = { reason: { kind } };
		} else if (ev.type === 'session/title') {
			/* the REAL conversation name (11-03 用户拍板): the pet page's own
			 * naming chain (session/title → projection → sessionTitles →
			 * 晚到真名改写) takes it from here; the 「任务 N」合成名 stays as
			 * the pre-title placeholder. Uses the CURRENT code so the name
			 * lands on the same synthetic id the notifications announce. */
			const t = ev.data && typeof ev.data.title === 'string' ? ev.data.title : '';
			if (!t) continue;
			data = { title: t };
		} else if (ev.type === 'assistant/message') {
			/* the three-line usage report's "this turn" line accumulates from
			 * these frames (frames.js adds input+output+cacheRead). Only the
			 * three aggregate counts pass — no ids, no message text. */
			const d = ev.data || {};
			const u = d.usage || (d.message && d.message.usage) || null;
			if (!u) continue;
			data = {
				usage: {
					inputTokens: u.inputTokens | 0,
					outputTokens: u.outputTokens | 0,
					cacheReadTokens: u.cacheReadTokens | 0
				}
			};
		} else if (ev.type === 'approval/asked') {
			/* 审核请求（11-06，用户实报「审核通知不了」）：与 ask_user_question
			 * 同级放行——只带工具名（元数据非对话内容）；id/callId/reason 全部
			 * 剥掉（reason 可能携带审批上下文文本）。桌宠页把它转成
			 * approval/requested 注意帧（⚠️ [会话名]需要你审核）。 */
			const tool = ev.data && typeof ev.data.toolName === 'string' ? ev.data.toolName : '';
			if (!tool) continue;
			data = { name: tool };
		} else if (ev.type === 'tool/call') {
			if (!(ev.data && ev.data.name === 'ask_user_question')) continue;
			data = { name: 'ask_user_question', callId: 'pet-q' + codeOf(book, sid) + ':' + frame.seq };
		} else {
			continue; /* message text, tool noise, execution detail… */
		}
		out.push({
			seq: frame.seq,
			type: 'session/event',
			/* 'session-pet-sN' (NOT bare 'pet-sN'): the whale's sub-agent silence
			 * gate drops every non-'session-' id — a bare synthetic id would
			 * mute ALL task notifications on the pet (smoke-proven 10-31). The
			 * 'session-' prefix routes the synthetic session through the normal
			 * main-task announce path; the pet naming branch in
			 * server-events.js (PET_SID_PREFIX) turns it into 「任务 N」 until
			 * the real title frame lands. */
			sessionId: 'session-pet-s' + codeOf(book, sid),
			event: { type: ev.type, time: ev.time || Date.now(), data }
		});
	}
	return out;
}

/** 桌宠历史抽屉（2026-11-05，用户实报「历史任务里面读取不到，桌宠的时候还会
 * 出现」）：把共享账本的历史记录枚举化后发给桌宠页。第一批把桌宠页的读写
 * 双门全关（pet profile 磁盘零历史），但右键菜单里的「📜 历史任务」入口
 * 还在——抽屉永远空、通知照常出，功能成了半成品。现在读路接通：真实
 * sessionId 永不出宿主（码本转合成 id，rev 同步可反查跳转），字段白名单
 * 只留通知契约已含的 标题/kind/时间/聚合 token 数，其余全部剥离；
 * **本地磁盘仍然零写入**（页内 pull 的 safeSet/回写在 PET 分支全部跳过），
 * clearAt 世代标记沿用页鲸合并语义（at < clearAt 不返回）。
 * 纯函数导出供 test-host-store.js 单测。 */
const HISTORY_KIND_RE = /^[a-z][\w-]{0,19}$/;
export function enumerateHistory(doc, book, cap) {
	const out = { history: [], clearAt: null };
	if (!doc || typeof doc !== 'object') return out;
	out.clearAt = typeof doc.clearAt === 'number' ? doc.clearAt : null;
	const entries = Array.isArray(doc.history) ? doc.history : [];
	/* newest first regardless of how the doc was written (the client drawer
	 * renders in array order; mergeHistories sorts desc but a hand-edited or
	 * legacy doc may not be sorted) */
	const sorted = entries
		.filter((e) => e && typeof e === 'object' && typeof e.sessionId === 'string' && e.sessionId)
		.filter((e) => out.clearAt === null || (e.at || 0) >= out.clearAt)
		.sort((a, b) => (b.at || 0) - (a.at || 0));
	const limit = typeof cap === 'number' && cap > 0 ? cap : 200;
	for (let i = 0; i < sorted.length && out.history.length < limit; i++) {
		const e = sorted[i];
		const rec = { sessionId: 'session-pet-s' + stableCodeOf(book, e.sessionId) };
		if (typeof e.title === 'string' && e.title) rec.title = e.title.slice(0, 120);
		if (typeof e.kind === 'string' && HISTORY_KIND_RE.test(e.kind)) rec.kind = e.kind;
		if (typeof e.at === 'number') rec.at = e.at;
		/* 跳转锚点（11-06 二轮）：endTime 缺失的记录（attention 类/未来
		 * kind）用 at 顶上——at=记录落账时刻≈完成时刻，保证每条历史行都
		 * 带有效时间锚，翻页定位不会退化成「只跳对话」。 */
		if (typeof e.endTime === 'number') rec.endTime = e.endTime;
		else if (typeof e.at === 'number') rec.endTime = e.at;
		if (typeof e.turnTokens === 'number') rec.turnTokens = e.turnTokens;
		out.history.push(rec);
	}
	return out;
}

/* --- WebView2 runtime detection ------------------------------------------ */

/** Evergreen runtime presence: the standard per-machine install root holds
 * one version directory per installed runtime. Without it (and without any
 * fixed runtime shipped alongside) the WPF control dies at ensure — the pet
 * must refuse to spawn with a clear console line instead. */
export function detectWebView2Runtime() {
	const roots = [
		'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application',
		'C:\\Program Files\\Microsoft\\EdgeWebView\\Application'
	];
	for (const root of roots) {
		try {
			if (readdirSync(root).some((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))) return 'evergreen';
		} catch (e) { /* absent */ }
	}
	return null;
}

/* --- process management --------------------------------------------------- */

function killTree(pid) {
	return new Promise((resolve) => {
		if (!pid || process.platform !== 'win32') return resolve(false);
		try {
			const child = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
			child.on('close', (code) => resolve(code === 0));
			child.on('error', () => resolve(false));
		} catch (e) {
			resolve(false);
		}
	});
}

/* --- apply ----------------------------------------------------------------- */

/**
 * Attach the pet to a live plugin context. `deps` carries the pieces
 * lib/index.js already owns so the security-critical fence is NOT duplicated:
 *   isAllowed(req)  — the loopback + browser fence predicate
 *   readJsonBody    — shared POST body reader
 *   getFrames()     — the host's recentFrames ring buffer (array)
 *   bootId          — this server generation's id (feed freshness semantics)
 * Returns a disposer that kills the pet process tree (taskkill /T — the PS
 * process owns WebView2 child processes; leaving any of them alive locks the
 * DLLs and turns an uninstall into a ghost directory).
 */
	function applyPet(ctx, deps) {
		const supported = process.platform === 'win32';
		let tokenHex = null;
		let child = null;
		let enabled = false;
		let form = 'full';
		let spawning = false;
		/* 桌宠常驻（第九轮用户定稿）：没有进入/退出——只要平台支持，开机即
		 * 常开；up 仲裁（petUp）照旧：页鲸等到桌宠**真出现**才潜水（petUp 由
		 * 桌宠页面 boot 后 POST {action:'ready'} 置位），spawn 失败或 15s 超时
		 * 则广播 up:false 让页鲸兜底苏醒（永不无鱼可看）。 */
		let petUp = false;
		let readyTimer = null;
		let lastSpawnAt = 0;   /* heartbeat cooldown anchor (自愈 11-04) */
		/* 闪现循环退避（11-06，用户实报「下午反复闪现」）：看护误判自杀 ×
		 * 心跳 30~90s 重生 = 桌宠/页鲸反复接力闪烁。除了看护侧 6s 防抖
		 * （pet.ps1），宿主侧对**快速连死**退避：3 分钟窗口内死亡 ≥2 次
		 * 时心跳本拍不重生（页鲸顶班兜底），等最早一次死亡滑出窗口再试
		 * ——把「无限闪现」变成「最多闪两次然后页鲸稳定接管」。 */
		let rapidDeaths = [];
		const book = newCodeBook();
		/* 设置 relay（11-11 真机修复轮）：页面半区的 CONFIG/总静音快照——
		 * 页面 POST /pet/config 写入（fence-only，与 /pet/ctrl 同信任级），
		 * /pet/state 随 2s 轮询下发，桌宠页差分应用。ledger 持久化：宿主
		 * 重启后桌宠 boot 也能拿到（页面 boot 也会补推一拍）。只含设置
		 * 不含会话内容——枚举化边界不破。 */
		let petRelay = null;

		/** Broadcast a pet/state frame through the host's event pipeline:
		 * lands in recentFrames (pollers) AND fans out to every live SSE
		 * client instantly. Without this, an SSE-connected page never polls
		 * /events and would miss the dormancy flip FOREVER (2026-10-31 真机：
		 * 退出桌宠后页内鲸鱼永久隐藏——SSE 页面收不到 pet.enabled=false）。
		 * carries FORM too: a HIDDEN pet must wake the page whale (it becomes
		 * the only visible whale + the recall entry), or the user hits a
		 * dead end with no way back (真机反馈 10-31#3）. */
		function broadcastPetState() {
			try {
				if (typeof deps.pushFrame === 'function') {
					/* spawning 随帧下发（11-05）：页鲸用「up=false 且 spawning」
					 * 区分 spawn 窗口期与真死亡——窗口期页鲸也休眠（桌宠马上要
					 * 出现），真死亡才苏醒顶班（开机双鲸同屏的根修）。 */
					deps.pushFrame({ type: 'pet/state', enabled: enabled, form: form, up: petUp, spawning: !!spawning });
				}
			} catch (e) { /* pipeline down: pollers still get the response flag */ }
		}

	function petState() {
		return {
			supported,
			enabled,
			form,
			up: petUp,
			spawning: !!spawning,
			runtime: supported ? detectWebView2Runtime() : null,
			running: !!(child && child.pid && child.exitCode === null)
		};
	}

	function clearReadyTimer() {
		if (readyTimer) {
			clearTimeout(readyTimer);
			readyTimer = null;
		}
	}

	/** sessionController.list() 的 30s promise memo（11-05 真名扩容）：桌宠
	 * 页 ~3s 轮询一次 feed，不能每次都打全量会话列表（冷会话读取带工作
	 * 切片）。memo 的是 promise 本身——慢查询期间并发的轮询共享同一次；
	 * 拒绝一律吞成 {}（标题尽力而为，账本兜底仍在）。 */
	let listTitlesPromise = null;
	let listTitlesAt = 0;
	function listSessionTitlesCached() {
		const now = Date.now();
		if (listTitlesPromise && now - listTitlesAt < 30000) return listTitlesPromise;
		listTitlesAt = now;
		listTitlesPromise = (typeof deps.listSessionTitles === 'function'
			? Promise.resolve(deps.listSessionTitles())
			: Promise.resolve({})
		).catch(() => ({}));
		return listTitlesPromise;
	}

	function log(line) {
		try { console.log('[dsh-whale-assistant/pet] ' + line); } catch (e) { /* console gone */ }
		/* 11-06 一次性诊断（宿主 spawn 链取证，收口后删）：引擎 stdout 无处
		 * 可见（壳 GUI 吞掉），pet 生命周期问题（静默 spawn 失败/秒死）只能
		 * 落盘查。 */ 
		try { appendFileSync(join(homedir(), '.dsh', 'pet', 'host-debug.log'), new Date().toISOString().slice(11, 23) + ' ' + line + '\n'); } catch (e2) { }
	}

	function writePetDoc(patch) {
		return queueStoreWrite(join(homedir(), '.dsh'), () => {
			const doc = loadStore(join(homedir(), '.dsh')) || {};
			const next = normalizePetDoc(doc);
			if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
			if (patch.form && PET_FORMS.indexOf(patch.form) !== -1) next.form = patch.form;
			doc.pet = next;
			saveStoreAtomic(join(homedir(), '.dsh'), doc);
			return next;
		});
	}

	function stopPet(reason, kill) {
		const pid = child && child.pid;
		child = null;
		petUp = false;
		clearReadyTimer();
		/* 11-06 常驻语义：dispose（引擎收尾）**不杀桌宠**——桌宠跟**父进程**
		 * 走（pet.ps1 parentWatch：父死 1s 内自退）。关窗会触发引擎的收尾
		 * dispose，但引擎进程往往继续驻留（真机实锤收尾挂起数小时）——
		 * 此时桌宠应常驻（用户实报「关窗≠退出但小鲸鱼跟着消失」）。
		 * kill=false：只清宿主状态（心跳/仲裁），token 保留（桌宠页继续
		 * 轮询到路由注销为止，404 只降级不死）；升级/强杀路径靠父死跟随，
		 * DLL 锁在引擎死后由桌宠 1s 自退释放。respawn 路径仍 killTree
		 * （真换新实例时才清旧树）。 */
		if (kill === false) {
			log('soft-stopping pet supervision (' + reason + ') — pet follows the parent process');
			return Promise.resolve(false);
		}
		tokenHex = null;
		if (!pid) return Promise.resolve(false);
		log('stopping pet tree (pid ' + pid + ', ' + reason + ')');
		return killTree(pid);
	}

	/* 评估 P1-1（11-08）：三条环境性早退（WebView2 缺失/资产缺失/端口缺失）
	 * 必须落 spawning=false 并广播 up:false——否则 spawning 卡 true 双重死锁：
	 * 心跳门（heartbeatGate 要求 !spawning）永不重试，页端 petDormantOf 判
	 * 「up=false 且 spawning」=页鲸也永久休眠 → 无 WebView2 的干净机器首装
	 * 一屏无鱼且重启前无自愈。15s readyTimer 帮不上：它在这三个 return 之后
	 * 才挂载。广播语义=「真死亡」而非「窗口期」：页鲸立即顶班（永不无鱼）。 */
	function abortSpawn(why) {
		log(why);
		spawning = false;
		petUp = false;
		broadcastPetState();
	}

	async function spawnPet() {
		if (!supported || spawning) return;
		spawning = true;
		lastSpawnAt = Date.now();
		try {
			const runtime = detectWebView2Runtime();
			if (!runtime) {
				abortSpawn('WebView2 Runtime not found — pet stays off (install the Evergreen Runtime to enable)');
				return;
			}
			const dllDir = join(petAssetsDir(), 'dlls');
			const ps1 = join(petAssetsDir(), 'pet.ps1');
			if (!existsSync(ps1) || !existsSync(join(dllDir, 'Microsoft.Web.WebView2.Wpf.dll'))) {
				abortSpawn('pet assets incomplete (pet.ps1 / dlls missing) — pet stays off');
				return;
			}
			const port = ctx && ctx.webServer && Number(ctx.webServer.port);
			if (!port || port <= 0) {
				abortSpawn('webServer port unavailable — pet stays off');
				return;
			}
			const run = petRunDir();
			mkdirSync(run, { recursive: true });
			mkdirSync(join(run, 'webview'), { recursive: true });
			/* one pet per Windows session: two DSH profiles both enabling the
			 * pet spawn two shells — the session-local mutex in pet.ps1 turns
			 * the second one into a clean no-op exit */
			await stopPet('respawn');
			tokenHex = randomBytes(32).toString('hex');
			const logFile = join(run, 'pet.log');
			const env = Object.assign({}, process.env, {
				DSH_PET_TOKEN: tokenHex,
				DSH_PET_PORT: String(port),
				DSH_PET_FORM: form,
				DSH_PET_PARENT_PID: String(process.pid),
				/* executable name of the process family that owns the DSH main
				 * window — the jump action's foreground switch locates it by
				 * NAME (the owning pid is the ENGINE process, not the Electron
				 * process that actually holds the window, 实证 11-03） */
				DSH_PET_HOSTPROC: String(process.execPath ? basename(process.execPath) : ''),
				DSH_PET_DLLDIR: dllDir,
				DSH_PET_USERDATA: join(run, 'webview'),
				DSH_PET_LOG: logFile,
				WEBVIEW2_DEFAULT_BACKGROUND_COLOR: '00FFFFFF',
				/* 11-11 三轮（用户实报「第一条通知无声，双击红标后恢复」）：
				 * 桌宠 WebView2 默认 autoplay 策略=窗口无用户激活时音频
				 * resume() 被拒——桌宠开机后用户未必先点它，第一条通知的
				 * 音频解锁被拒即静音。桌宠页只跑我们自己的 whale.js（播的
				 * 是自家通知音，非任意外部内容）——直接豁免手势要求，根除
				 * 该类（页鲸侧由 dings.js 的手势重试兜底）。 */
				WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--autoplay-policy=no-user-gesture-required'
			});
			log('spawning pet (port ' + port + ', form ' + form + ', runtime ' + runtime + ', log ' + logFile + ')');
			child = spawn('powershell.exe', [
				'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1
			], { env, stdio: 'ignore', windowsHide: true });
			/* 审计 D-C3（11-04）：闭包捕获本次 pid——respawn 后旧进程的迟到
			 * exit 不得检查/影响新 child（否则新 ready 后收到一次假 up:false，
			 * 页鲸闪现） */
			const spawnedPid = child.pid;
			child.on('exit', (code) => {
				if (spawnedPid !== (child && child.pid)) return;   /* stale exit of a previous shell */
				/* 快速连死退避记录（11-06）：所有死亡都计入（看护自杀/崩溃/
				 * 强杀），heartbeat 据此在 3 分钟窗口 ≥2 次时退避 */
				rapidDeaths.push(Date.now());
				if (rapidDeaths.length > 5) rapidDeaths.shift();
				/* a non-zero exit while enabled is a real failure (mutex exits
				 * are code 0 — the OTHER instance's shell) — surfaced here,
				 * never auto-respawned by the exit path itself: a broken
				 * environment must not turn into a crash loop. The heartbeat
				 * (60s cooldown) is the ONLY respawn path. */
				if (child && child.pid && child.exitCode !== null && child.exitCode !== 0) {
					log('pet process exited (code ' + code + ')');
				}
				/* spawning 状态化（11-05）：进程死亡=窗口期结束——up:false 广播
				 * 必须带 spawning:false，页鲸才认「真死了」并苏醒顶班。 */
				spawning = false;
				/* 审计 P0-1（11-01）：ready 之后的任何死亡（托盘退出/自杀/
				 * 看门狗/崩溃）此前不广播——页鲸永久休眠=一屏无鱼死局。
				 * 死亡即广播 up:false：页鲸原地苏醒；ledger 保持 enabled，
				 * 下次 DSH 启动桌宠自然回归。 */
				if (enabled) {
					petUp = false;
					broadcastPetState();
				}
			});
			/* 审计 D-C2（11-04）：spawn 失败（ENOENT 等）走 'error' 事件——
			 * 无监听=未捕获异常可击穿引擎进程，且 exitCode 恒 null 使
			 * heartbeat 把从未存在过的进程当「活着」永不再生。置回 null 让
			 * 心跳冷却后兜底重试。 */
			child.on('error', (err) => {
				if (spawnedPid !== (child && child.pid)) return;
				log('pet spawn error: ' + String(err && err.message || err));
				child = null;
				spawning = false; /* 同 exit：窗口期随失败终止（页鲸苏醒兜底） */
				if (enabled) {
					petUp = false;
					broadcastPetState();
				}
			});
			/* 15s ready 超时（11-06 补全——注释自第一批就承诺「spawn 失败或
			 * 15s 超时则广播 up:false」，但 readyTimer 从未被 setTimeout：
			 * WebView2 卡死/出生闸门等待期等 hang 场景下 spawning 恒 true
			 * （或 up 恒 false）=页鲸永久休眠一屏无鱼。超时只广播不杀——
			 * 进程可能仍在挣扎，清场留给看护/心跳；若它之后真 ready，
			 * up:true 广播会重新接管（页鲸重新休眠，语义幂等）。 */
			clearReadyTimer();
			readyTimer = setTimeout(() => {
				readyTimer = null;
				if (spawnedPid !== (child && child.pid)) return;   /* stale timer of a previous shell */
				if (!enabled || petUp) return;
				log('pet ready timeout (15s) — broadcasting up:false as page-whale fallback');
				spawning = false;
				petUp = false;
				broadcastPetState();
			}, 15000);
		} catch (e) {
			log('spawn failed: ' + String(e && e.message || e));
			/* 同步失败（11-05）：spawning 必须落回 false——页鲸靠
			 * 「up:false 且非 spawning」苏醒兜底；卡在 true 会把页鲸
			 * 永久藏住（一屏无鱼）。广播补全（评估 P1-1，11-08）：光落
			 * 标志不推帧，SSE 页面拿不到唤醒信号——与三条环境性早退
			 * 同契约（真死亡语义，页鲸立即顶班）。 */
			spawning = false;
			petUp = false;
			broadcastPetState();
		}
	}

	/** 自愈心跳（2026-11-04 用户实报「小鲸鱼突然变回 DSH 内样式，重进也一样」）：
	 * pet 进程死亡后（窗口消失自杀/宿主强杀/崩溃）页鲸原地苏醒接管，但
	 * spawnPet 只在 boot 跑一次、死亡不自动重生（防 crash loop 的设计挡死
	 * 了自己）——引擎活着时窗口回来页鲸也永远退位不回去。取证 15:48→15:52：
	 * 用户重进 DSH 四分钟后 pet「host windows gone」自杀，页鲸样式直到
	 * 引擎彻底重启。修复=宿主检查 enabled 且 pet 已死且距上次 spawn 超 60s
	 * （冷却防 crash loop）→ 重新 spawn。真退出不受影响：引擎 dispose 时
	 * enabled=false，且引擎死后无定时器=无心跳。pet 回归后 ready 握手让
	 * 页鲸重新休眠。审计 D-C1（11-04）：原实现挂页鲸 /events 轮询当心跳——
	 * 页鲸 SSE 在线时 poll 直接 return（server-events `if (sseUp) return`），
	 * 心跳源消失=自愈失效。改为**宿主自主 30s 定时器**（unref：绝不单独
	 * 拖住引擎进程），任何页面状态都跑；/events 挂点保留（死后 3s 内的
	 * 快路径）。 */
	function heartbeat() {
		/* 快速连死退避（11-06）：先于常规 60s 冷却检查——一个死亡滑出 3 分钟
		 * 窗口后才允许下一次尝试。日志留痕，行为可从宿主控制台审计。 */
		const hbNow = Date.now();
		rapidDeaths = rapidDeaths.filter((t) => hbNow - t < 180000);
		if (rapidDeaths.length >= 2) {
			log('heartbeat: pet died ' + rapidDeaths.length + 'x within 3min — backing off this tick');
			return false;
		}
		if (!heartbeatGate({
			supported: supported,
			enabled: enabled,
			spawning: spawning,
			childAlive: !!(child && child.exitCode === null),
			lastSpawnAt: lastSpawnAt
		}, Date.now())) return false;
		log('pet heartbeat: process gone while enabled — respawning');
		spawnPet();
		return true;
	}

	function readAsset(file) {
		try {
			return readFileSync(file, 'utf8');
		} catch (e) {
			return null;
		}
	}

	const routes = [
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/page',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				const html = readAsset(join(petAssetsDir(), 'page.html'));
				if (html === null) return plain(res, 404, 'pet page missing', 'text/plain; charset=utf-8');
				/* svg lives in lib/ (build-synced copy) — a plugin-root path reads
				 * NOTHING and ships an invisible whale (2026-10-31 真机实测） */
				const svg = readAsset(join(dirname(fileURLToPath(import.meta.url)), 'whale-logo.svg')) || '';
				plain(res, 200, html.replace(/__WHALE_SVG__/, () => svg), 'text/html; charset=utf-8');
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/whale.js',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				const code = readAsset(join(dirname(fileURLToPath(import.meta.url)), 'whale.js'));
				if (code === null) return plain(res, 404, 'console.error("[dsh-whale] whale.js not found on the host");', 'application/javascript; charset=utf-8');
				plain(res, 200, code, 'application/javascript; charset=utf-8');
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/style.css',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				const css = readAsset(join(dirname(fileURLToPath(import.meta.url)), 'parts', 'style.css'));
				if (css === null) return plain(res, 404, '', 'text/css; charset=utf-8');
				plain(res, 200, css, 'text/css; charset=utf-8');
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/feed',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				/* 真名预填（11-05 扩容，用户实报「对话通知有时候识别不到名称」）。
				 * 旧实现两个时序洞：① titles 在 enumerateFrames **之前**构建——
				 * 本拍 turn/start 刚铸的码查不到（预填永远慢一拍）；② 来源只有
				 * 账本历史 ×「已有码」双重过滤——新 boot 零码时 titles 恒空
				 * （真机实测 /pet/feed titles={}）。现在：
				 * 1) 先枚举帧铸码，再查码本——本轮任务会话立即带真名（开工
				 *    通知不再先上「任务 N」）；
				 * 2) 叠加 sessionController.list() 全量会话现势标题（5s 超时 +
				 *    30s promise memo，失败静默回落账本）——侧栏所有会话一次
				 *    到位，从未被记录过的会话也有真名。
				 * 真实 id 仍不出宿主（码本转码，pet profile 只落合成键+标题）。 */
				const events = enumerateFrames(deps.getFrames(), book);
				listSessionTitlesCached().then((listTitles) => {
					const titles = {};
					try {
						const hist = typeof deps.getHistoryTitles === 'function' ? deps.getHistoryTitles() : {};
						const sources = [hist, listTitles];
						for (const src of sources) {
							for (const realSid of Object.keys(src || {})) {
								const code = book.codes.get(realSid);
								const t = src[realSid];
								if (code && typeof t === 'string' && t) titles['session-pet-s' + code] = t;
							}
						}
					} catch (e) { /* titles are best-effort */ }
					plain(res, 200, JSON.stringify({
						events,
						titles,
						bootId: deps.bootId,
						now: Date.now()
					}));
				}, () => {
					/* unreachable (cached fn never rejects) — keep the response contract */
					plain(res, 200, JSON.stringify({ events, titles: {}, bootId: deps.bootId, now: Date.now() }));
				});
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/history',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				/* 桌宠历史抽屉（11-05）：feed 的标题只覆盖「有码」会话，抽屉要
				 * 完整最近记录——共享账本经 enumerateHistory 白名单下发。 */
				let doc = null;
				try {
					doc = typeof deps.ledgerDir === 'function' ? loadStore(deps.ledgerDir()) : null;
				} catch (e) { doc = null; }
				plain(res, 200, JSON.stringify(enumerateHistory(doc, book, 200)));
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/config',
			handler: (req, res) => {
				if (req.method !== 'POST') return plain(res, 405, '');
				if (!deps.isAllowed(req)) return plain(res, 403, '{"ok":false,"error":"forbidden"}');
				deps.readJsonBody(req, res, 16384, (body) => {
					const cfg = body && body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : null;
					const snd = body && (body.sound === 'off' || body.sound === 'on') ? body.sound : null;
					if (!cfg && !snd) {
						plain(res, 400, JSON.stringify({ ok: false, error: 'config object or sound on|off required' }));
						return;
					}
					petRelay = { config: cfg, sound: snd, at: Date.now() };
					queueStoreWrite(join(homedir(), '.dsh'), () => {
						const doc = loadStore(join(homedir(), '.dsh')) || {};
						doc.petConfig = petRelay;
						saveStoreAtomic(join(homedir(), '.dsh'), doc);
						return doc;
					}).catch((e) => log('petConfig persist failed: ' + String(e && e.message || e)));
					plain(res, 200, JSON.stringify({ ok: true }));
				});
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/state',
			handler: (req, res) => {
				if (req.method !== 'GET') return plain(res, 405, '');
				if (!deps.isAllowed(req) || !checkPetToken(req, tokenHex)) return plain(res, 403, fatalHtml(), 'text/html; charset=utf-8');
				const st = petState();
				plain(res, 200, JSON.stringify({
					ok: true,
					form: st.form,
					enabled: st.enabled,
					running: st.running,
					/* 设置 relay（11-11 真机修复轮）：页面 CONFIG/总静音快照随
					 * 2s 轮询下发，桌宠页差分应用（桌宠 WebView2 独立分区，
					 * 页面设置此前永远到不了桌宠=「设了叮叮响单声叮」根因） */
					petConfig: petRelay
				}));
			}
		},
		{
			kind: 'exact',
			path: '/api/whale-assistant/pet/ctrl',
			handler: (req, res) => {
				if (req.method !== 'POST') return plain(res, 405, '');
				if (!deps.isAllowed(req)) return plain(res, 403, '{"ok":false,"error":"forbidden"}');
					deps.readJsonBody(req, res, 4096, (body) => {
						const action = body && body.action;
						if (action === 'ready') {
						/* 桌宠页面 boot 完成 handshake：此刻桌宠窗口已可见——
						 * 这时才广播 dormancy，页鲸让位（接力棒交接）。
						 * **延迟 350ms**：ready 与首帧区域载荷同一拍到达，但
						 * 广播走 HTTP 即时、区域走 ps1 的 16ms 合流定时器——
						 * 立刻广播会让页鲸先消失、桌宠鲸鱼 1-2 帧后才现身
						 * =空窗闪烁。给区域构建留出时间，桌宠鲸鱼可见后页鲸
						 * 才隐藏。 */
						if (enabled && !petUp) {
							petUp = true;
							spawning = false; /* 窗口期在 ready 时刻结束（11-05 状态化） */
							clearReadyTimer();
							log('pet ready — page whales step aside in 350ms (region build first)');
							setTimeout(() => {
								if (enabled && petUp) broadcastPetState();
							}, 350);
						}
						plain(res, 200, JSON.stringify({ ok: true, pet: petState() }));
						return;
					}
					if (action === 'form') {
						if (PET_FORMS.indexOf(body.value) === -1) throw new Error('form must be one of ' + PET_FORMS.join('|'));
						form = body.value;
						writePetDoc({ form }).then(() => {
							broadcastPetState();
							plain(res, 200, JSON.stringify({ ok: true, pet: petState() }));
						}).catch((e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) })));
						return;
					}
					if (action === 'jump') {
						/* 桌宠通知双击跳转（11-03）：pet 页只有枚举化合成会话，
						 * 没有跳转桥也没有 DSH DOM——宿主是唯一能把合成码还原成
						 * 真实会话的一层。反查成功后广播 pet/jump：页鲸（数据管线
						 * 在休眠期间仍活跃）用自带跳转桥 openSessionAt 执行；
						 * 窗口前台化由桌宠进程自己完成（postMessage c:'jump'）。
						 * 载荷只含编号，不回落任何标题/内容（枚举化边界不变）。
						 * 时间锚点（11-06，用户实报「跳的是对话不是任务节点」）：
						 * body.atMs（通知报告的 endTime / 历史行 endTime）原样
						 * 回传——时间戳不是对话内容，边界不破；页鲸
						 * openSessionAt(sid, atMs) 的翻页回溯把那条消息滚进视野。 */
						const code = Number(body.code);
						const realId = Number.isInteger(code) && code > 0 ? resolvePetCode(book, code) : null;
						if (!realId) {
							plain(res, 200, JSON.stringify({ ok: false, error: 'stale' }));
							return;
						}
						const atMs = Number(body.atMs);
						const anchor = Number.isFinite(atMs) && atMs > 0 ? atMs : undefined;
						try {
							if (typeof deps.pushFrame === 'function') {
								deps.pushFrame({ type: 'pet/jump', sessionId: realId, atMs: anchor, time: Date.now() });
							}
							/* delivered（11-06 常驻语义）：关窗≠退出后页鲸可能不在
							 * 场（SSE 无页鲸连接）——pet/jump 广播出去没人消费=
							 * 无声失败。false 时桌宠页不标已读、提示用户先打开
							 * DSH（通知保留，开窗后再跳还能定位到任务节点）。 */
							const delivered = typeof deps.hasPageClients === 'function' ? !!deps.hasPageClients() : true;
							/* 跳转补偿 v2（11-12）：**无条件**落 ledger pendingJump——
							 * delivered=true 也不可信：关窗后壳可能停在退出挂起态，
							 * 渲染层残留在里面（SSE 还连着=hasPageClients 真），跳转
							 * 帧广播给一个看不见的窗口=用户眼中的「跳转失效」。落库
							 * 后由 ps1 revive（杀僵尸壳+重拉）+ 新页鲸 hello 补投兜底；
							 * 窗口正常在场的场景 pending 无人消费、120s 后自然过期。 */
							try {
								const dir = deps.ledgerDir();
								queueStoreWrite(dir, () => {
									const doc = loadStore(dir) || {};
									doc.pendingJump = { sessionId: realId, atMs: anchor || 0, time: Date.now() };
									saveStoreAtomic(dir, doc);
									return doc;
								}).catch((e2) => log('pendingJump persist failed: ' + String(e2 && e2.message || e2)));
							} catch (e3) { /* ledger 不可用：跳过补偿 */ }
							plain(res, 200, JSON.stringify({ ok: true, delivered: delivered }));
						} catch (e) {
							plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }));
						}
						return;
					}
					if (action === 'reload-page') {
						/* 刷新 DSH 页面（11-07，用户实报「桌宠的刷新页面失效」）：
						 * 桌宠菜单旧实现的刷新刷的是桌宠自己的页面——用户要的是
						 * 刷 DSH 页（插件更新加载/页面过期恢复）。宿主广播
						 * pet/reload-page 帧，页鲸（数据管线常活）收到即执行
						 * location.reload()；页鲸不在场（窗口关着）时回
						 * delivered=false，桌宠提示而不是假装成功。 */
						try {
							if (typeof deps.pushFrame === 'function') {
								deps.pushFrame({ type: 'pet/reload-page', time: Date.now() });
							}
							const delivered = typeof deps.hasPageClients === 'function' ? !!deps.hasPageClients() : true;
							plain(res, 200, JSON.stringify({ ok: true, delivered: delivered }));
						} catch (e) {
							plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }));
						}
						return;
					}
					if (action === 'open-settings') {
						/* 桌宠菜单「设置」跳转（11-11 三报，用户实报「点设置只弹
						 * 提示没有意义」）：桌宠页没有 layout 桥——宿主广播
						 * pet/open-settings，页鲸（数据管线常活）收到即
						 * selectPanel('whale-assistant') 打开侧边栏设置页。
						 * delivered 语义与 reload-page 相同（页鲸不在场=DSH
						 * 关着，桌宠提示；DSH 前台化由桌宠进程 c:'jump' 完成）。 */
						try {
							if (typeof deps.pushFrame === 'function') {
								deps.pushFrame({ type: 'pet/open-settings', time: Date.now() });
							}
							const delivered = typeof deps.hasPageClients === 'function' ? !!deps.hasPageClients() : true;
							/* 设置跳转补偿 v2（11-12）：同 pendingJump——无条件落库
							 * （delivered=true 也可能是「僵尸渲染层在场」的假象）。 */
							try {
								const dir = deps.ledgerDir();
								queueStoreWrite(dir, () => {
									const doc = loadStore(dir) || {};
									doc.pendingSettings = { time: Date.now() };
									saveStoreAtomic(dir, doc);
									return doc;
								}).catch((e2) => log('pendingSettings persist failed: ' + String(e2 && e2.message || e2)));
							} catch (e3) { /* ledger 不可用：跳过补偿 */ }
							plain(res, 200, JSON.stringify({ ok: true, delivered: delivered }));
						} catch (e) {
							plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }));
						}
						return;
					}
					if (action === 'clear-history') {
						/* 桌宠历史抽屉的清空（11-05）：清的就是共享账本——与页内
						 * 清空同一份数据（抽屉读的也是它）。cutoff=null=清空全部；
						 * 数字=世代标记，at < cutoff 的记录清除（页内清空同款语义）。 */
						const cutoff = body && typeof body.cutoff === 'number' ? body.cutoff : null;
						if (typeof deps.ledgerDir !== 'function') {
							plain(res, 500, JSON.stringify({ ok: false, error: 'ledger unavailable' }));
							return;
						}
						const dir = deps.ledgerDir();
						queueStoreWrite(dir, () => {
							const doc = loadStore(dir) || {};
							if (cutoff === null) {
								doc.history = [];
							} else {
								doc.history = (Array.isArray(doc.history) ? doc.history : [])
									.filter((e) => e && typeof e === 'object' && (e.at || 0) >= cutoff);
							}
							doc.clearAt = cutoff === null ? Date.now() : cutoff;
							saveStoreAtomic(dir, doc);
							return doc;
						}).then(
							() => plain(res, 200, JSON.stringify({ ok: true })),
							(e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }))
						);
						return;
					}
					throw new Error('unknown action');
				});
			}
		}
	];

	function plain(res, status, text, type) {
		res.writeHead(status, {
			'content-type': type || 'application/json; charset=utf-8',
			'cache-control': 'no-store'
		});
		res.end(text);
	}

	/* 403 bodies must be SELF-REPORTING: a navigation-level 403 (token rotated
	 * away / profile restarted) replaces the whole pet page — plain text would
	 * leave the shell alive with no page JS to raise the fatal. This tiny HTML
	 * runs in the pet WebView2 and posts the fatal control frame itself. */
	function fatalHtml() {
		return '<!DOCTYPE html><html><body>forbidden<script>' +
			'try{window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage({c:"fatal",r:"auth"});}catch(e){}' +
			'try{document.title=\'WR:{"fatal":1}\';}catch(e){}' +
			'</script></body></html>';
	}

	const disposers = [];
	for (const route of routes) {
		try {
			disposers.push(ctx.webServer.register(route));
		} catch (error) {
			if (/duplicate/.test(String(error && error.message || error))) {
				disposers.push(() => {});
			} else {
				throw error;
			}
		}
	}

	/* boot state: whatever the ledger says */
	/* boot state: 桌宠常驻（第九轮用户定稿）——没有进入/退出开关，只要平台
	 * 支持就常开（不支持时页内鲸鱼兜底）；ledger 只保留形态记忆 */
	const bootDoc = loadStore(join(homedir(), '.dsh'));
	const boot = normalizePetDoc(bootDoc);
	/* 设置 relay（11-11 真机修复轮）：宿主重启后从 ledger 恢复最近一份页面
	 * 设置快照——桌宠 boot 首个 state 轮询即可拿到（页面 boot 补推前的空窗
	 * 也覆盖）。损坏/缺失→null，桌宠用默认值等页面下一次推送。 */
	try {
		petRelay = bootDoc && bootDoc.petConfig && typeof bootDoc.petConfig === 'object' && !Array.isArray(bootDoc.petConfig) ? bootDoc.petConfig : null;
	} catch (e) { petRelay = null; }
	enabled = supported;
	form = boot.form;
	spawnPet();
	/* 审计 D-C1（11-04）：自愈心跳=宿主自主定时器（30s，unref），任何页面
	 * 状态都跑——页鲸 SSE 在线时 /events 轮询被短路（sseUp return），
	 * 「挂页面心跳」在 SSE 稳态下失效；60s 冷却使死后 30~90s 内必重生。
	 * /events 挂点保留作死后 3s 内的快路径。 */
	let hbTimer = null;
	if (supported) {
		hbTimer = setInterval(() => {
			try { heartbeat(); } catch (e) { /* never kill the engine loop */ }
		}, 30000);
		if (typeof hbTimer.unref === 'function') hbTimer.unref();
	}

	return {
		state: petState,
		heartbeat,
		/* 真名主动帧（11-06 二轮，用户实报「对话名称又出问题」）：桌宠改走
		 * SSE 枚举流后 titles 预填只在 poll 首拍发生（SSE 稳态 poll return）
		 * ——老会话（标题早已生成、永不触发 onChanged）的码只有在它跑任务时
		 * 才铸出，铸码后没有任何 title 帧会到达=通知永远「任务 N」。
		 * 宿主在 turn/start 事件时调本方法：查 30s memo 的全量会话标题，
		 * 有真名就推一条 projection title 帧（真实 sid，页鲸全量流与桌宠
		 * 枚举流都消费）——开工/完成通知生成时真名已在通讯录，晚到的
		 * 也有 _correctReports 改写兜底。 */
		announceTitle: (sessionId) => {
			if (typeof sessionId !== 'string' || !sessionId) return;
			/* 主源=账本标题（11-06 诊断实锤：sessionController.list 的标题提取
			 * 路径 listLen=0 从未生效——R3 验证的 33 条真名全部来自账本源）。
			 * 账本同步可读：title 帧与 turn/start 帧同拍入环，完成通知生成时
			 * 真名必已就位。list 源（冷会话/未记录会话）保留为异步补充。 */
			let hist = {};
			try {
				hist = typeof deps.getHistoryTitles === 'function' ? deps.getHistoryTitles() : {};
			} catch (e) { hist = {}; }
			const t = hist[sessionId];
			if (typeof t === 'string' && t && typeof deps.pushFrame === 'function') {
				deps.pushFrame({ type: 'session/projection', sessionId: sessionId, key: 'title', value: t });
			}
			listSessionTitlesCached().then((list) => {
				const t2 = list && list[sessionId];
				if (typeof t2 === 'string' && t2 && t2 !== t && typeof deps.pushFrame === 'function') {
					deps.pushFrame({ type: 'session/projection', sessionId: sessionId, key: 'title', value: t2 });
				}
			});
		},
		/* SSE 枚举流（11-06，用户实报「任务通知有延时」）：桌宠页此前不订
		 * /events/stream（SSE 推全量原文帧，枚举边界不允许）只能 3s 轮询
		 * feed——通知天然慢 3s。现在宿主按 token 把 SSE 连接分成 pet 连接，
		 * 推帧前用本闭包的码本逐帧枚举（与 /pet/feed 完全同源，边界不破）。
		 * checkToken 在宿主 stream 路由连接时验 pet token（无 token/不匹配
		 * =普通页鲸连接，推全量帧，行为不变）；enumerateForPet 用宿主进站
		 * 原始帧返回枚举帧数组（0..N 条，entry 帧被剥掉时为 0）。 */
		checkToken: (req) => checkPetToken(req, tokenHex),
		enumerateForPet: (frame) => enumerateFrames([frame], book),
		dispose: function disposePet() {
			if (hbTimer) { try { clearInterval(hbTimer); } catch (e) { } hbTimer = null; }
			for (const dispose of disposers) {
				try { dispose(); } catch (e) { /* route already gone */ }
			}
			enabled = false;
			/* kill=false（11-06 常驻语义）：桌宠跟父进程走，不在收尾时连坐 */
			return stopPet('dispose', false);
		}
	};
}

export { applyPet, resolvePetCode, turnCodeOf };
