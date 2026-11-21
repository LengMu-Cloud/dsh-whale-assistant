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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledgerAppend, loadStore, saveStoreAtomic, queueStoreWrite } from './store.js';

export const inject = [];

const PET_TOKEN_HEADER = 'x-dsh-pet-token';
export const PET_FORMS = ['full', 'bubble', 'hidden'];

/* --- 0.4.3 阶段 B（BUG-1 后半程）：桌宠页四类状态的结构/容量守卫 ---------
 * 提醒/总静音/引导台词日限/每日装饰计数此前困在桌宠页每-boot 失忆的
 * localStorage（桌宠中继端口每-boot 随机 → origin 变 → localStorage 按
 * origin 隔离）。现沿 aff/affMs/pos 同一条 petDoc 通道跨重启：读写两侧
 * 共用下面这组纯守卫（normalizePetDoc=读侧出口、normalizePetSyncPatch=
 * 写侧出口），坏形状整字段/整条丢弃、不抛错——手改账本必须无害。
 * 显式容量预算（历史前科：affMs 64 字符静默截断）：
 * - reminders    cap 20 条；单条 text ≤50 字符、id ≤64 字符、at 必须有限
 *                正数。整字段 JSON 最坏 ≈20×(64+50+17+引号键名)≈2.8KB，
 *                落在 /pet/ctrl sync 载荷上限 4096 字节内；
 * - soundMuted   布尔（dings.js SOUND_KEY 现值语义，'off'/'on'）；
 * - petHintDate  'YYYY-MM-DD' 字面正则（mood.js todayKey 同款形状），10 字符；
 * - petHintCount 0..999 钳顶（页侧日限实际 ≤3 语音 +3 心形，999 余量足）；
 * - gearStats    {date 正则, count 0..9999999 钳顶（与 aff 同款钳顶值）}，
 *                整字段 ≈30 字符。 */
const PET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REMINDER_CAP = 20;
const REMINDER_TEXT_MAX = 50;
const REMINDER_ID_MAX = 64;
const HINT_COUNT_CAP = 999;
const GEAR_COUNT_CAP = 9999999;

/** reminders 数组守卫：非数组 → null（整字段丢弃）；逐条校验（at 有限正数
 * + text 非空字符串），坏条目单丢，超过 REMINDER_CAP 的尾部条目丢弃
 * （「第 21 条丢弃」）。返回数组（可能是空数组=合法的「已清空」）。 */
function saneReminders(list) {
	if (!Array.isArray(list)) return null;
	const out = [];
	for (let i = 0; i < list.length && out.length < REMINDER_CAP; i++) {
		const it = list[i];
		if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
		if (typeof it.at !== 'number' || !isFinite(it.at) || it.at <= 0) continue;
		if (typeof it.text !== 'string' || !it.text) continue;
		const entry = { at: it.at, text: it.text.slice(0, REMINDER_TEXT_MAX) };
		if (typeof it.id === 'string' && it.id) entry.id = it.id.slice(0, REMINDER_ID_MAX);
		out.push(entry);
	}
	return out;
}

/** 日限计数守卫：非有限负数 → 0（页侧把「缺计数」当「今天还没说过话」），
 * 有限非负 → 地板化 + HINT_COUNT_CAP 钳顶。 */
function saneHintCount(n) {
	return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.min(HINT_COUNT_CAP, Math.floor(n)) : 0;
}

/** gearStats 守卫：形状/日期不对 → null（整字段丢弃）；count 地板化 +
 * GEAR_COUNT_CAP 钳顶。 */
function saneGearStats(gs) {
	if (!gs || typeof gs !== 'object' || Array.isArray(gs)) return null;
	if (typeof gs.date !== 'string' || !PET_DATE_RE.test(gs.date)) return null;
	if (typeof gs.count !== 'number' || !isFinite(gs.count) || gs.count < 0) return null;
	return { date: gs.date, count: Math.min(GEAR_COUNT_CAP, Math.floor(gs.count)) };
}

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
	/* BUG-1（11-16 实机验收）：桌宠中继端口每-boot 随机（DSH_PET_PORT 由 DSH
	 * desktop 分配，插件侧无法固定）→ pet 页 origin 变 → localStorage 按
	 * origin 隔离=每次重启都是新网站，好感度/里程碑/位置失忆（形态幸存是
	 * 因为走本账本）。三样随 petDoc 跨重启（与 form 同一条通道）。容错读：
	 * 脏数据回落 null，手改账本不得杀死 boot。 */
	const aff = pet && typeof pet.aff === 'number' && isFinite(pet.aff) && pet.aff >= 0
		? Math.floor(pet.aff) : null;
	const affMs = pet && typeof pet.affMs === 'string' ? pet.affMs.slice(0, 64) : null;
	const p = pet && pet.pos && typeof pet.pos === 'object' && !Array.isArray(pet.pos) ? pet.pos : null;
	const pos = p && typeof p.rx === 'number' && isFinite(p.rx) && typeof p.by === 'number' && isFinite(p.by)
		? {
			rx: p.rx,
			by: p.by,
			x: typeof p.x === 'number' && isFinite(p.x) ? p.x : 0,
			y: typeof p.y === 'number' && isFinite(p.y) ? p.y : 0
		}
		: null;
	/* 0.4.3 阶段 B：四类状态容错读。字段只在「账本携带且形状合法」时出现在
	 * 返回值里（不造键：账本没有新字段时返回形状与阶段 A 完全一致，既有
	 * 断言/老账本零感知），坏形状整字段丢弃。 */
	const next = { enabled, form, aff, affMs, pos };
	const rem = saneReminders(pet ? pet.reminders : null);
	if (rem) next.reminders = rem;
	if (pet && typeof pet.soundMuted === 'boolean') next.soundMuted = pet.soundMuted;
	if (pet && typeof pet.petHintDate === 'string' && PET_DATE_RE.test(pet.petHintDate)) next.petHintDate = pet.petHintDate;
	if (pet && typeof pet.petHintCount === 'number' && isFinite(pet.petHintCount) && pet.petHintCount >= 0) {
		next.petHintCount = saneHintCount(pet.petHintCount);
	}
	const gs = saneGearStats(pet ? pet.gearStats : null);
	if (gs) next.gearStats = gs;
	return next;
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

/** 0.4.3 阶段 C（P-09 数据地基）：互动入账白名单（纯函数，测试可及）。
 * sync 载荷的 `interact` 与 /pet/ctrl ledger 动作的 `kind` 共用同一道闸：
 * 只有 'pet'（摸头）/ 'wake'（唤起）合法，其余（含 undefined/垃圾值）一律
 * null=不入账——互动账是计数不是内容，白名单外没有可宽容的形状。 */
export function normalizePetInteract(v) {
	return v === 'pet' || v === 'wake' ? v : null;
}

/* --- 0.4.3 阶段 C（D-A1）：whale.js 条件 GET 的 ETag 纯函数对 -----------
 * 两条 whale.js 路由（index.js 页鲸 / pet.js 桌宠 /pet/whale.js）共用同一
 * 指纹与匹配判定——弱校验器语义一处实现，两侧不会漂移。处理器本体落在
 * 闭包里（pet 路由还有 token 闸，测试驱动不可达），纯函数导出给
 * test-host-store.js 做行为断言；路由接线由源码断言钉住。 */

/** 内容指纹弱校验器：SHA-1 前 16 hex + 字节长度双指纹。构建产物任何变化
 * 都会换值；每次请求现算（文件可能已被构建刷新，不能按进程缓存）。 */
export function petScriptEtag(code) {
	return 'W/"' + createHash('sha1').update(code).digest('hex').slice(0, 16) + '-' + Buffer.byteLength(code) + '"';
}

/** If-None-Match 匹配判定（RFC 7232 弱比较的实用子集）：'*' 通配 + 精确
 * 串/多值列表子串命中；头缺席/空串=不匹配（必须 200 全量）。 */
export function etagMatches(ifNoneMatch, etag) {
	const inm = String(ifNoneMatch == null ? '' : ifNoneMatch).trim();
	if (!inm) return false;
	return inm === '*' || inm.indexOf(etag) !== -1;
}

/** BUG-1（11-16）：/pet/ctrl action:sync 载荷校验（纯函数，测试可及——
 * 处理器本体落在 applyPet 闭包里，直接驱动会写真实 ~/.dsh 账本）。
 * 返回 null=无有效字段（处理器回 400）；否则返回只含有效字段的 patch：
 * aff 整数≥0（钳 9999999）、affMs 字符串（截 64）、pos v2 锚点 rx/by 必带
 * （x/y 缺失补 0）。与 normalizePetDoc 的容错读互为镜像。 */
export function normalizePetSyncPatch(body) {
	const patch = {};
	let touched = false;
	if (body && typeof body === 'object' && !Array.isArray(body)) {
		if (typeof body.aff === 'number' && isFinite(body.aff) && body.aff >= 0) {
			patch.aff = Math.min(9999999, Math.floor(body.aff));
			touched = true;
		}
		if (typeof body.affMs === 'string') {
			patch.affMs = body.affMs.slice(0, 64);
			touched = true;
		}
		if (body.pos && typeof body.pos.rx === 'number' && isFinite(body.pos.rx)
			&& typeof body.pos.by === 'number' && isFinite(body.pos.by)) {
			patch.pos = {
				rx: body.pos.rx,
				by: body.pos.by,
				x: typeof body.pos.x === 'number' && isFinite(body.pos.x) ? body.pos.x : 0,
				y: typeof body.pos.y === 'number' && isFinite(body.pos.y) ? body.pos.y : 0
			};
			touched = true;
		}
		/* 0.4.3 阶段 B：四类状态随 sync 上报——与读侧同一组 sane* 守卫
		 * （cap 20/text≤50/日期正则/计数钳顶），坏形状不带键；字段级合并
		 * 语义不变（只携带出现的字段，writePetDoc 未携带即保留账本现值）。 */
		const rem = saneReminders(body.reminders);
		if (rem) {
			patch.reminders = rem;
			touched = true;
		}
		if (typeof body.soundMuted === 'boolean') {
			patch.soundMuted = body.soundMuted;
			touched = true;
		}
		if (typeof body.petHintDate === 'string' && PET_DATE_RE.test(body.petHintDate)) {
			patch.petHintDate = body.petHintDate;
			touched = true;
		}
		if (typeof body.petHintCount === 'number' && isFinite(body.petHintCount) && body.petHintCount >= 0) {
			patch.petHintCount = saneHintCount(body.petHintCount);
			touched = true;
		}
		const gs = saneGearStats(body.gearStats);
		if (gs) {
			patch.gearStats = gs;
			touched = true;
		}
	}
	return touched ? patch : null;
}

/** BUG-1 boot seeding（11-17 二轮，用户实报「先开在右下角，然后闪到上次退出
 * 的位置」）：boot 时宿主已从账本读出 aff/affMs/pos（镜像变量）——把它种进
 * /pet/page 的 <head>：新 origin 的 localStorage 在 whale.js 求值前就落好，
 * loadPos/loadAffection 走本地存量路径，鲸鱼淡入即在上次落点（消除「默认
 * 角→2s 后闪到老位置」两拍）。信封形状与 savePos/saveAffection 写出的完全
 * 同构（v:1 外层 + v:2 锚点 / value）；幂等（localStorage 已有键则跳过——
 * origin 幸存时本地是最新的）。affMs/affMs 含 `<` 时 JSON 转义防 </script>
 * 逃逸。全空（首次启用/账本缺货）返回空注释占位=首次运行鲸鱼在默认角，
 * 照旧。纯函数（测试可及，处理器在 applyPet 闭包内）。 */
export function petBootStateScript(aff, affMs, pos) {
	const boot = {};
	if (typeof aff === 'number' && isFinite(aff) && aff >= 0) boot.aff = Math.floor(aff);
	if (typeof affMs === 'string' && affMs) boot.affMs = affMs.slice(0, 64);
	if (pos && typeof pos.rx === 'number' && isFinite(pos.rx)
		&& typeof pos.by === 'number' && isFinite(pos.by)) {
		boot.pos = {
			rx: pos.rx,
			by: pos.by,
			x: typeof pos.x === 'number' && isFinite(pos.x) ? pos.x : 0,
			y: typeof pos.y === 'number' && isFinite(pos.y) ? pos.y : 0
		};
	}
	if (Object.keys(boot).length === 0) return '/* pet boot state: none (first run / empty ledger) */';
	const json = JSON.stringify(boot).replace(/</g, '\\u003c');
	return '(function(){try{var b=' + json + ';'
		+ 'if(b.pos&&typeof b.pos.rx==="number"&&!localStorage.getItem("dsh-whale:pos")){'
		+ 'localStorage.setItem("dsh-whale:pos",JSON.stringify({v:1,data:{v:2,rx:b.pos.rx,by:b.pos.by,x:b.pos.x,y:b.pos.y}}));}'
		+ 'if(typeof b.aff==="number"&&!localStorage.getItem("dsh-whale:affection")){'
		+ 'localStorage.setItem("dsh-whale:affection",JSON.stringify({v:1,data:{value:b.aff}}));}'
		+ 'if(b.affMs&&!localStorage.getItem("dsh-whale:affMs")){localStorage.setItem("dsh-whale:affMs",b.affMs);}'
		+ '}catch(e){}})();';
}

/** 0.4.3 阶段 B（BUG-1 后半程）boot 种入·四类状态半区：提醒/总静音/引导
 * 台词日限/每日装饰计数随 petDoc 快照种进 /pet/page 的 <head>（与
 * petBootStateScript 同一 `__DSH_PET_BOOT__` 标记拼接注入——既有断言钉死
 * 老函数的三参调用文本形状，test-host-store.js append-only 不得改，故新增
 * 本函数而非扩参）。信封形状=各键页侧写出的形状：reminders/petHint 裸
 * JSON（drawers.js saveReminders/mood.js savePetHint 直读直写），sound/
 * stats 走 safeSet 的 {v:1,data} 信封（dings.js/gear.js 读侧经 safeGet 解
 * 信封）。种入闸门=键缺失才种（origin 幸存时本地最新，幂等，与老三键的
 * !getItem 模板同语义；文本形状不同是刻意的——老三键的模板计数断言）。
 * 空数组 `[]` 也是合法快照（「已清空」），照种。全空返回注释占位。纯函数
 * （测试可及）。 */
export function petExtrasBootScript(extras) {
	const seeds = [];
	if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
		const rem = saneReminders(extras.reminders);
		if (rem) seeds.push(['dsh-whale:reminders', JSON.stringify(rem)]);
		if (typeof extras.soundMuted === 'boolean') {
			seeds.push(['dsh-whale:sound', JSON.stringify({ v: 1, data: extras.soundMuted ? 'off' : 'on' })]);
		}
		if (typeof extras.petHintDate === 'string' && PET_DATE_RE.test(extras.petHintDate)) {
			seeds.push(['dsh-whale:petHint', JSON.stringify({ day: extras.petHintDate, n: saneHintCount(extras.petHintCount) })]);
		}
		const gs = saneGearStats(extras.gearStats);
		if (gs) seeds.push(['dsh-whale:stats', JSON.stringify({ v: 1, data: { tasksDone: gs.count, date: gs.date } })]);
	}
	if (seeds.length === 0) return '/* pet boot extras: none */';
	const seedsJson = JSON.stringify(seeds).replace(/</g, '\\u003c');
	return '(function(){try{var e=' + seedsJson + ';'
		+ 'for(var i=0;i<e.length;i++){if(localStorage.getItem(e[i][0])===null){localStorage.setItem(e[i][0],e[i][1]);}}'
		+ '}catch(eX){}})();';
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
		/* pet/state / pet/dismiss 直通（11-14 用户实报「设置切形态比桌宠右键
		 * 菜单慢一拍」）：枚举流此前把非 session/* 全剥，桌宠页感知 form 变化
		 * 只剩 2s fetchState 兜底轮询。这两类帧全是布尔/枚举串/整数编号，
		 * 零会话内容，白名单字段放行=枚举化边界不破。 */
		if (frame.type === 'pet/state') {
			out.push({ seq: typeof frame.seq === 'number' ? frame.seq : 0, type: 'pet/state', enabled: frame.enabled === true, form: typeof frame.form === 'string' ? frame.form : 'full', up: frame.up === true, spawning: frame.spawning === true });
			continue;
		}
		if (frame.type === 'pet/dismiss') {
			out.push({ seq: typeof frame.seq === 'number' ? frame.seq : 0, type: 'pet/dismiss', code: Number(frame.code) | 0 });
			continue;
		}
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
		/* BUG-1 sync（11-16）镜像：/pet/state 2s 轮询下发用——轮询高频，不重读
		 * 账本盘；boot 从 petDoc 恢复、ctrl sync 动作实时更新。 */
		let petAff = null;
		let petAffMs = null;
		let petPos = null;
		/* 0.4.3 阶段 B（BUG-1 后半程）镜像：四类状态（提醒/总静音/引导台词
		 * 日限/每日装饰计数）同款镜像——一个对象装五个归一化字段（值或
		 * null），boot 从 petDoc 恢复、sync 动作实时跟更、state 轮询下发。 */
		let petExtras = null;

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
		/* 宿主 spawn 链取证落盘（11-06 起诊断；2026-11-18 全面分析 C-8 转正
		 * 为常驻诊断并加 1MB 单槽轮转）：引擎 stdout 无处可见（壳 GUI 吞掉），
		 * pet 生命周期问题（静默 spawn 失败/秒死）只能落盘查。超 1MB 即改名
		 * host-debug.old.log（单槽，直接覆盖上上代）——心跳退避每 30s 一行、
		 * 死亡风暴期也烧不满两代，磁盘不再无界增长。 */
		try {
			const logPath = join(homedir(), '.dsh', 'pet', 'host-debug.log');
			try {
				if (statSync(logPath).size > 1024 * 1024) {
					renameSync(logPath, join(homedir(), '.dsh', 'pet', 'host-debug.old.log'));
				}
			} catch (e3) { /* 还没有日志文件——正常 */ }
			appendFileSync(logPath, new Date().toISOString().slice(11, 23) + ' ' + line + '\n');
		} catch (e2) { }
	}

	function writePetDoc(patch) {
		return queueStoreWrite(join(homedir(), '.dsh'), () => {
			const doc = loadStore(join(homedir(), '.dsh')) || {};
			const next = normalizePetDoc(doc);
			if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
			if (patch.form && PET_FORMS.indexOf(patch.form) !== -1) next.form = patch.form;
			/* BUG-1 sync（11-16）：字段级合并——桌宠页是唯一写者、last-writer-wins；
			 * 未携带的字段保留账本现值（与页鲸 pushPetConfig 的整体替换不同，
			 * 这里的 patch 永远是部分字段）。normalizePetDoc 已做同款校验。 */
			if (typeof patch.aff === 'number' && isFinite(patch.aff) && patch.aff >= 0) {
				next.aff = Math.min(9999999, Math.floor(patch.aff));
			}
			if (typeof patch.affMs === 'string') next.affMs = patch.affMs.slice(0, 64);
			if (patch.pos && typeof patch.pos.rx === 'number' && isFinite(patch.pos.rx)
				&& typeof patch.pos.by === 'number' && isFinite(patch.pos.by)) {
				next.pos = {
					rx: patch.pos.rx,
					by: patch.pos.by,
					x: typeof patch.pos.x === 'number' && isFinite(patch.pos.x) ? patch.pos.x : 0,
					y: typeof patch.pos.y === 'number' && isFinite(patch.pos.y) ? patch.pos.y : 0
				};
			}
			/* 0.4.3 阶段 B：四类状态字段级合并——携带即覆盖。守卫重跑一遍
			 * （sane*）作纵深防御：调用方理论上传未经 normalizePetSyncPatch
			 * 的原始形状也进不了账本；读侧 normalizePetDoc 下次写时仍会复检。
			 * 空数组也是合法值（「已清空提醒」要能持久化）。 */
			const remPatch = saneReminders(patch.reminders);
			if (remPatch) next.reminders = remPatch;
			if (typeof patch.soundMuted === 'boolean') next.soundMuted = patch.soundMuted;
			if (typeof patch.petHintDate === 'string' && PET_DATE_RE.test(patch.petHintDate)) {
				next.petHintDate = patch.petHintDate;
			}
			if (typeof patch.petHintCount === 'number' && isFinite(patch.petHintCount) && patch.petHintCount >= 0) {
				next.petHintCount = saneHintCount(patch.petHintCount);
			}
			const gsPatch = saneGearStats(patch.gearStats);
			if (gsPatch) next.gearStats = gsPatch;
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

	/** 会话级全清广播（C-A6/C-A7 共用同一段逻辑，两个入口不写两份）：
	 * dismiss 反查从单码升级为会话级——turnCodeOf 每个新任务都给同一会话
	 * 铸新码（codes 正查只留最新码），旧实现 book.codes.get 只清得到最新
	 * 码=同会话旧任务的红标在桌宠永久滞留。改为沿 rev 反查索引把该会话
	 * **所有**历史码逐个广播 pet/dismiss（事件名/载荷形状不变：type+code，
	 * 枚举白名单只放行这两字段）；pushFrame 异常吞掉照抄 jump——管线异常
	 * 不得挂死 HTTP 响应。返回实际广播条数（0=该会话无码，等价旧
	 * delivered:false）。 */
	function broadcastSessionDismiss(realSid) {
		let sent = 0;
		if (typeof realSid !== 'string' || !realSid) return sent;
		if (!(book.rev instanceof Map)) return sent;
		book.rev.forEach((sid, code) => {
			if (sid !== realSid) return;
			try {
				if (typeof deps.pushFrame === 'function') deps.pushFrame({ type: 'pet/dismiss', code: code });
				sent++;
			} catch (ePush) { /* 广播失败按未送达回报 */ }
		});
		return sent;
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
				/* BUG-1 boot seeding（11-17 二轮）：petDoc 快照种进 <head>——新
				 * origin 的 localStorage 在 whale.js 求值前落好，鲸鱼淡入即在上次
				 * 落点（消除「默认角→2s 后闪到老位置」）。镜像=boot 账本快照 +
				 * sync 动作实时跟更。函数替换防 $ 字符替换语义（同 SVG）。 */
				const bootScript = petBootStateScript(petAff, petAffMs, petPos) + petExtrasBootScript(petExtras);
				plain(res, 200, html
					.replace(/__WHALE_SVG__/, () => svg)
					.replace('__DSH_PET_BOOT__', () => bootScript), 'text/html; charset=utf-8');
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
				/* 0.4.3 阶段 C（D-A1）：no-store 全量重传 → no-cache+ETag 条件
				 * GET——语义不变（文件有更新必拉新），没更新时 304 空响应，
				 * 桌宠每次重启/页面重载省掉 ~470KB 重传。指纹与 If-None-Match
				 * 判定走 petScriptEtag/etagMatches 纯函数对（与本文件头部定义，
				 * 测试可及）。304/200 都带 ETag+no-cache：下一拍条件请求照常
				 * 成立。 */
				const etag = petScriptEtag(code);
				if (etagMatches(req.headers['if-none-match'], etag)) {
					res.writeHead(304, { etag: etag, 'cache-control': 'no-cache' });
					res.end();
					return;
				}
				res.writeHead(200, {
					'content-type': 'application/javascript; charset=utf-8',
					'cache-control': 'no-cache',
					etag: etag
				});
				res.end(code);
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
				}).catch(() => { /* 外层兜底防 unhandled rejection 击穿宿主：双参 fail 只接源拒绝，ok/fail 回调内同步抛出仍会变成无人接的拒绝（Node ≥15 默认崩进程） */ });
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
					petConfig: petRelay,
					/* BUG-1（11-16）：好感度/里程碑/位置随 state 轮询下发——桌宠
					 * 页 origin 随中继端口每-boot 变化，localStorage 不可跨重启；
					 * petSyncFromHost 只在「本 boot 尚无权威值」时采用（幂等）。
					 * 全 null=账本缺货，桌宠页保持现值等首次上报。 */
					aff: petAff,
					affMs: petAffMs,
					pos: petPos,
					/* 0.4.3 阶段 B（BUG-1 后半程）：四类状态随轮询下发——页侧
					 * petSyncExtrasFromHost 采用（本地空白才吃，与上面幂等语义
					 * 同款；boot 头部种入通常已先落好，本下行只兜直开/清存）。
					 * 全 null=账本缺货。 */
					reminders: petExtras ? petExtras.reminders : null,
					soundMuted: petExtras ? petExtras.soundMuted : null,
					petHintDate: petExtras ? petExtras.petHintDate : null,
					petHintCount: petExtras ? petExtras.petHintCount : null,
					gearStats: petExtras ? petExtras.gearStats : null
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
						/* 先广播后落盘（11-14）：形态是交互动作——SSE 消费端立刻应用；
						 * 磁盘写只承担跨重启持久化，不挡在广播前面。 */
						broadcastPetState();
						writePetDoc({ form }).then(() => {
							plain(res, 200, JSON.stringify({ ok: true, pet: petState() }));
						}).catch((e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) })));
						return;
					}
					if (action === 'sync') {
						/* BUG-1（11-16 实机验收，用户实报「好感度/位置重启清零」）：
						 * 桌宠中继端口每-boot 随机 → pet 页 origin 变 → localStorage
						 * 按 origin 隔离。桌宠页把好感度/里程碑/位置经本动作上报进
						 * petDoc（与 form 同一条跨重启通道）；/pet/state 随 2s 轮询
						 * 下发回桌宠页。fence-only 与 form/dismiss 同信任级：只落
						 * 设置级标量，无会话内容，枚举化边界不破。字段级合并：
						 * 只更新携带的字段，镜像先更（轮询不等磁盘写）。 */
						const patch = normalizePetSyncPatch(body);
						/* 0.4.3 阶段 C（P-09 数据地基）：互动入账字段 interact
						 * （'pet'=摸头 | 'wake'=唤起，白名单见 normalizePetInteract）
						 * ——桌宠页摸头/唤起经既有 sync 通道顺带上行，宿主在这里
						 * ledgerAppend 进 petLedger（90 天滚动+单日钳顶在
						 * store.js 的闸门内）。事件不进 petDoc：petLedger 是宿主
						 * 主管辖顶层键，走 store.js 自己的合并管道。入账
						 * fire-and-forget（与 pendingJump 落库同款）：petDoc 写与
						 * 响应不等人，失败落 host-debug 日志。 */
						const interact = normalizePetInteract(body && body.interact);
						if (interact && typeof deps.ledgerDir === 'function') {
							ledgerAppend(deps.ledgerDir(), interact)
								.catch((e2) => log('petLedger append failed: ' + String(e2 && e2.message || e2)));
						}
						if (!patch && !interact) {
							plain(res, 400, JSON.stringify({ ok: false, error: 'aff|affMs|pos|reminders|soundMuted|petHint required' }));
							return;
						}
						if (!patch) {
							/* 仅互动、无 petDoc 字段：入账已 kicked，无镜像/落盘可做 */
							plain(res, 200, JSON.stringify({ ok: true }));
							return;
						}
						if (typeof patch.aff === 'number') petAff = patch.aff;
						if (typeof patch.affMs === 'string') petAffMs = patch.affMs;
						if (patch.pos) petPos = patch.pos;
						/* 0.4.3 阶段 B：四类状态镜像先更（轮询不等磁盘写，与
						 * aff/pos 同款）——字段级合并，未携带保留镜像现值。 */
						if (!petExtras) {
							petExtras = { reminders: null, soundMuted: null, petHintDate: null, petHintCount: null, gearStats: null };
						}
						if (patch.reminders !== undefined) petExtras.reminders = patch.reminders;
						if (typeof patch.soundMuted === 'boolean') petExtras.soundMuted = patch.soundMuted;
						if (patch.petHintDate !== undefined) petExtras.petHintDate = patch.petHintDate;
						if (patch.petHintCount !== undefined) petExtras.petHintCount = patch.petHintCount;
						if (patch.gearStats !== undefined) petExtras.gearStats = patch.gearStats;
						writePetDoc(patch).then(() => {
							plain(res, 200, JSON.stringify({ ok: true }));
						}).catch((e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) })));
						return;
					}
					if (action === 'dismiss') {
						/* 通知已读联动（11-14 用户实报「在 DSH 里直接看了对话，鲸鱼红标
						 * 不消失」）：页鲸检测到本窗口正在看某会话 → POST dismiss → 宿主
						 * 把真实会话反查成桌宠任务码 → 广播 pet/dismiss，桌宠页把该任务
						 * 的未读清掉。真实 sessionId 只进反查不落盘，边界同 jump。
						 * C-A6（0.4.3）：反查升级为会话级全清（见 broadcastSessionDismiss）
						 * ——同一会话的旧任务码一并广播，不再只清 codes 正查里的最新码。 */
						const realSid = typeof body.sessionId === 'string' ? body.sessionId : '';
						const sent = broadcastSessionDismiss(realSid);
						plain(res, 200, JSON.stringify({ ok: true, delivered: sent > 0 }));
						return;
					}
					if (action === 'dismiss-all') {
						/* 页鲸双击红标全清 relay（C-A7）：页鲸把全部未读清空后通知宿主，
						 * 宿主把码本里所有任务码逐个广播 pet/dismiss——桌宠侧红标不再
						 * 滞留假数字。调用方是 fire-and-forget（页鲸本地已清是事实，
						 * relay 失败/桌宠离线不回滚），本侧同样静默容错。会话全集从 rev
						 * 反查索引取（codes 正查键是 rev 值的子集：turn 码铸码时
						 * codes/rev 同步 set，stable 码只进 rev）——逐会话复用
						 * broadcastSessionDismiss，不写第二份广播逻辑。 */
						const seen = new Set();
						let sentAll = 0;
						if (book.rev instanceof Map) {
							book.rev.forEach((sid) => {
								if (seen.has(sid)) return;
								seen.add(sid);
								sentAll += broadcastSessionDismiss(sid);
							});
						}
						plain(res, 200, JSON.stringify({ ok: true, delivered: sentAll > 0 }));
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
					if (action === 'open-report') {
						/* 桌宠菜单「📊 周报」跳转（11-20，用户拍板改名+直达周报
						 * Tab）：广播 pet/open-report，页鲸收到即 selectPanel+
						 * openTab('report')（消费端=server-events 帧路由 +
						 * panel-page 监听，阶段 C 已就位）。v1 不做离线补投
						 * （不同于 pendingSettings）：delivered=false 时菜单文案
						 * 明说重开后再点，不假装成功；补投与 pendingSettings
						 * 同构，挂账待后续。 */
						try {
							if (typeof deps.pushFrame === 'function') {
								deps.pushFrame({ type: 'pet/open-report', time: Date.now() });
							}
							const delivered = typeof deps.hasPageClients === 'function' ? !!deps.hasPageClients() : true;
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
						).catch(() => { /* 外层兜底防 unhandled rejection 击穿宿主：双参 fail 只接源拒绝，ok 回调内同步抛出仍无人接 */ });
						return;
					}
					if (action === 'clear-pending') {
						/* 11-14（用户实报「跳转偶发弹开的是设置页」）：页鲸可见态
						 * 即时消费 jump/settings 后回执清账——pending 意图只该服务
						 * 「页鲸不在场」的补偿场景；可见页已把动作落到用户眼前，
						 * 留守只会变成下一次唤醒的过期重演（设置页盖住新跳转）。
						 * kind: jump | settings（无账本环境同 clear-history 语义）。
						 * 11-20 增：kind='report'（周报帧无落库补偿形态）=纯确认
						 * no-op——绝不误清 jump/settings 在途意图。 */
						if (body && body.kind === 'report') {
							plain(res, 200, JSON.stringify({ ok: true, cleared: 0 }));
							return;
						}
						const kind = body && body.kind === 'settings' ? 'settings' : 'jump';
						if (typeof deps.ledgerDir !== 'function') {
							plain(res, 500, JSON.stringify({ ok: false, error: 'ledger unavailable' }));
							return;
						}
						const dir = deps.ledgerDir();
						queueStoreWrite(dir, () => {
							const doc = loadStore(dir) || {};
							if (kind === 'settings') delete doc.pendingSettings;
							else delete doc.pendingJump;
							saveStoreAtomic(dir, doc);
							return doc;
						}).then(
							() => plain(res, 200, JSON.stringify({ ok: true })),
							(e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }))
						).catch(() => { /* 外层兜底防 unhandled rejection 击穿宿主：双参 fail 只接源拒绝，ok 回调内同步抛出仍无人接 */ });
						return;
					}
					if (action === 'ledger') {
						/* 0.4.3 阶段 C（C-A8 双账本收口）：页鲸（非 PET_MODE）摸头/
						 * 唤起此前只写自己 origin 的 localStorage——桌宠与页鲸两侧
						 * 互动账目对不上（同一份 petLedger 永远缺页鲸那半）。新通
						 * 道：页鲸 POST {action:'ledger', kind:'pet'|'wake'}
						 * （fence-only，与 dismiss-all 同信任级；载荷只有白名单枚
						 * 举串，零内容零 id，枚举化边界不破）。宿主 ledgerAppend
						 * 进 petLedger。fire-and-forget 语义：页鲸本地爱心爆发已
						 * 是事实，入账失败不回滚、调用方不读响应体——但本侧仍等
						 * 写链落地再回（与 clear-history 同款 ok/fail 双参回执，
						 * 测试可确定性断言）。 */
						const kind = normalizePetInteract(body && body.kind);
						if (!kind) {
							plain(res, 400, JSON.stringify({ ok: false, error: "kind must be 'pet'|'wake'" }));
							return;
						}
						if (typeof deps.ledgerDir !== 'function') {
							plain(res, 500, JSON.stringify({ ok: false, error: 'ledger unavailable' }));
							return;
						}
						const dir = deps.ledgerDir();
						ledgerAppend(dir, kind).then(
							() => plain(res, 200, JSON.stringify({ ok: true })),
							(e) => plain(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }))
						).catch(() => { /* 链尾兜底：ok/fail 回调内同步抛出时防 unhandled rejection 击穿宿主（clear-history 先例，注释指纹不同=不进既有计数断言） */ });
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
	/* BUG-1（11-16）：好感度/里程碑/位置镜像随 petDoc boot 恢复——桌宠页首个
	 * state 轮询即拿到（新 origin 的 localStorage 是空的，全靠这里下发）。 */
	petAff = boot.aff;
	petAffMs = boot.affMs;
	petPos = boot.pos;
	/* 0.4.3 阶段 B（BUG-1 后半程）：四类状态镜像随 petDoc boot 恢复——同一条
	 * 通道；字段缺席=账本缺货（null），桌宠页保持现值等首次上报。同时它们
	 * 已进 /pet/page 的头部种入信封（petBootStateScript 第 4 参）：新 origin
	 * 的 localStorage 在 whale.js 求值前落好，轮询采用只兜本地空白。 */
	petExtras = {
		reminders: Array.isArray(boot.reminders) ? boot.reminders : null,
		soundMuted: typeof boot.soundMuted === 'boolean' ? boot.soundMuted : null,
		petHintDate: typeof boot.petHintDate === 'string' ? boot.petHintDate : null,
		petHintCount: typeof boot.petHintCount === 'number' ? boot.petHintCount : null,
		gearStats: boot.gearStats || null
	};
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
			}).catch(() => { /* 外层兜底防 unhandled rejection 击穿宿主：这条链原本完全没有失败分支（源拒绝/回调抛出都无人接） */ });
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
			/* v14（11-13）：收尾必杀桌宠树（kill=true）。用户实报「重开 DSH 卡
			 * 死」挂起复现实测 40s+——根因=桌宠页的 SSE（3s 自动重连进正在
			 * 排空的服务器=新的活跃连接）+2s 轮询 keep-alive 把宿主
			 * backend.close() 的连接排空拖死=壳停在退出挂起态（单实例锁握着
			 * =重开无响应）。11-06 的 kill=false 常驻语义实际早已失效：壳的
			 * Job 对象在壳死时本来就静默带走桌宠（02:46 世代无日志消失实证）
			 * ——与其随机挂在 limbo，不如确定性放行。关窗→退出全程 ~3-5s，
			 * 期间桌宠照常可点；窗口期过后重开 DSH 即时生效（无锁无 limbo）。 */
			return stopPet('dispose', true);
		}
	};
}

export { applyPet, resolvePetCode, turnCodeOf };
