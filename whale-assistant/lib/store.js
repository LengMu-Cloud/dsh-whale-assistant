/**
 * Whale ledger (task history) persistence — split out of index.js so the
 * merge pipeline has regression coverage (test-host-store.js). This code
 * silently lost records once; semantics here must not change unnoticed.
 *
 * Durability rules (2026-10-25):
 * - save = temp file + rename. A SIGTERM mid-write (the desktop updater
 *   grants the engine tree only ~10s graceful) must never truncate the
 *   ledger into an unparseable file;
 * - a ledger that fails to parse is renamed aside (.corrupt-<ts>) instead
 *   of being silently treated as "first run" — recovery stays possible.
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const HISTORY_LIMIT = 500;

export function storePath(dir) {
	return join(dir, 'whale-assistant.json');
}

/**
 * Read + parse the ledger. Returns null when absent (first run). A CORRUPT
 * ledger (truncated JSON, permission errors) is quarantined to
 * `<file>.corrupt-<timestamp>` and reported as null — the caller starts
 * from an empty baseline, but the old bytes stay on disk for recovery.
 */
export function loadStore(dir) {
	let raw;
	try {
		raw = readFileSync(storePath(dir), 'utf8');
	} catch (error) {
		if (error && error.code === 'ENOENT') return null;
		quarantineCorruptStore(dir);
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		quarantineCorruptStore(dir);
		return null;
	}
}

function quarantineCorruptStore(dir) {
	try {
		const quarantined = storePath(dir) + '.corrupt-' + Date.now();
		renameSync(storePath(dir), quarantined);
		/* the ONE user-visible trace of the quarantine: without it the ledger
		 * silently restarts empty and nobody knows a recovery file exists */
		console.warn('[dsh-whale-assistant] ledger unreadable, quarantined to ' + quarantined + ' (rename off the .corrupt-<ts> suffix to recover)');
	} catch (e) { /* nothing left to preserve */ }
}

/** Generic atomic text write (same temp+rename pattern as the ledger). */
export function saveFileAtomic(file, text) {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = file + '.tmp';
	writeFileSync(tmp, text, 'utf8');
	try {
		renameSync(tmp, file);
	} catch (e) {
		writeFileSync(file, text, 'utf8');
		try { unlinkSync(tmp); } catch (e2) { /* a stale .tmp is harmless */ }
	}
}

/**
 * Atomic ledger write: mkdir -> write <file>.tmp -> rename over the target.
 * rename over an existing file is atomic on POSIX; on Windows it can hit a
 * transient EPERM while another handle holds the target — fall back to the
 * direct write (and drop the stale tmp) rather than fail the save.
 */
export function saveStoreAtomic(dir, doc) {
	backupPreviousLedger(dir);
	saveFileAtomic(storePath(dir), JSON.stringify(doc));
}

/** 日备 rotating（0.4.3 阶段 C，G-3「最便宜的保险」）：账本每次落盘**前**，
 * 把上一份完整版本滚动复制为单槽备份 `<ledger>.backup-1`（直接覆盖上一代
 * 备份）。写前复制而不是写后——备份永远等于「上一个写成功的完整版本」，
 * 新一次写损坏/误清时至少有一代可回捞；写后复制只会备份到刚写的内容，
 * 保险意义为零。单槽=磁盘占用恒为 1 份（账本 ≤512KiB 级），不随保存次数
 * 无界增长。复制失败静默（try/catch）：备份是保险不是功能——首次落盘无旧
 * 文件（ENOENT）、Windows 上目标被杀毒/索引器短暂占用（EPERM）都走这里，
 * 主写入路径绝不因备份失败而中断。跟踪面说明：备份落在 ~/.dsh/（宿主
 * 数据目录），不在本仓库工作树内，与 whale-assistant.json 同样不进 git。 */
function backupPreviousLedger(dir) {
	try {
		copyFileSync(storePath(dir), storePath(dir) + '.backup-1');
	} catch (e) { /* 无旧文件（首次落盘）或 IO 抖动：静默，主流程照旧 */ }
}

/* --- petLedger（互动账本，0.4.3 阶段 C，P-09 数据地基）-------------------- */

/* 容量纪律（显式预算）：days ≤90 条（90 天滚动剔除超龄日 + 截尾兜底）、
 * 单日 pets/wakes 各钳 9999 → 整键 JSON 最坏 ≈90×~40B≈3.6KB，挂在
 * ≤512KiB 的账本文档里无感。date 口径=本地日 'YYYY-MM-DD'（与页侧
 * src/core/gear.js todayKey 同款拼法，桌宠页日限键同一约定）。 */
const PET_LEDGER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PET_LEDGER_DAYS = 90;
const PET_LEDGER_DAY_CAP = 9999;

/** 本地日字符串（getFullYear/getMonth/getDate —— 与页侧 todayKey 同口径，
 * 不用 toISOString：UTC 日期在 UTC+8 的凌晨 0-8 点会提前翻日）。 */
function petLedgerToday(now) {
	const d = now === undefined ? new Date() : new Date(now);
	const m = d.getMonth() + 1;
	const day = d.getDate();
	return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/** 'YYYY-MM-DD' → UTC 当日 0 点毫秒；非法日历日（2026-02-31/2026-13-01/
 * 月日越界）→ null。Date.UTC 对越界分量静默进位，必须回写比对才拦得住；
 * 用 UTC 解析纯日期做「天数差」运算，跨时区稳定。 */
function petLedgerDayMs(date) {
	if (typeof date !== 'string' || !PET_LEDGER_DATE_RE.test(date)) return null;
	const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
	if (!isFinite(ms)) return null;
	return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

/** 归一化（读写两侧共用的同一条闸门）：非对象/non-days 数组整键回落
 * {days:[]}；条目逐条校验（date 必须是合法日历日、计数有限非负），坏条目
 * 单丢；单日计数地板化+钳 9999；同日重复取后者（mergeHistory「按 date 去重
 * 取新」的单键版本——调用方把存量铺在前、新值铺在后即得「取新」）；date
 * 升序；超 90 个自然日的日剔除 + 截尾兜底（日期洪水也不破 ≤90 条上限，
 * 升序截尾=保最新）。任何输入不抛错——手改账本必须无害。 */
export function normalizePetLedger(value, now) {
	const byDate = new Map();
	if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.days)) {
		for (const d of value.days) {
			if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
			if (petLedgerDayMs(d.date) === null) continue;
			const pets = typeof d.pets === 'number' && isFinite(d.pets) && d.pets >= 0
				? Math.min(PET_LEDGER_DAY_CAP, Math.floor(d.pets)) : 0;
			const wakes = typeof d.wakes === 'number' && isFinite(d.wakes) && d.wakes >= 0
				? Math.min(PET_LEDGER_DAY_CAP, Math.floor(d.wakes)) : 0;
			byDate.set(d.date, { date: d.date, pets, wakes });
		}
	}
	/* keepFrom=含今天共 90 个自然日的下界（今天-89 天）；日期串已由
	 * petLedgerDayMs 保证 canonical，'YYYY-MM-DD' 字典序=时间序，直接比串 */
	const todayMs = petLedgerDayMs(petLedgerToday(now));
	const keepFrom = new Date(todayMs - (PET_LEDGER_DAYS - 1) * 86400000).toISOString().slice(0, 10);
	const days = [...byDate.values()]
		.filter((d) => d.date >= keepFrom)
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return { days: days.length > PET_LEDGER_DAYS ? days.slice(days.length - PET_LEDGER_DAYS) : days };
}

/** 互动入账（宿主侧小助手）：'pet'=摸头、'wake'=唤起。当日条目存在则对应
 * 计数 ++、不存在则 push 今日新条目；落盘前过 normalizePetLedger（90 天
 * 滚动+单日钳顶，与读下发端同一闸门）。走串行写链（queueStoreWrite）：与
 * 页鲸 /save、桌宠 petDoc/pending 写同一条 load→mutate→rename 队列，并发
 * 丢写在此收口。返回归一化后的账本（测试断言用）；kind 白名单在队列外先
 * 拒（调用方 pet.js normalizePetInteract 已校验，这里是最后一道闸）。 */
export function ledgerAppend(dir, kind) {
	if (kind !== 'pet' && kind !== 'wake') {
		return Promise.reject(new Error("kind must be 'pet'|'wake'"));
	}
	return queueStoreWrite(dir, () => {
		const doc = loadStore(dir) || {};
		const ledger = normalizePetLedger(doc.petLedger);
		const today = petLedgerToday();
		let day = null;
		for (const d of ledger.days) { if (d.date === today) { day = d; break; } }
		if (!day) { day = { date: today, pets: 0, wakes: 0 }; ledger.days.push(day); }
		if (kind === 'pet') day.pets = Math.min(PET_LEDGER_DAY_CAP, day.pets + 1);
		else day.wakes = Math.min(PET_LEDGER_DAY_CAP, day.wakes + 1);
		/* append 后再过一遍闸门：滚动窗口随「今天」移动（上次写时的 90 天
		 * 边界到今天可能已经挤掉一条），钳顶同款双保险 */
		doc.petLedger = normalizePetLedger(ledger);
		saveStoreAtomic(dir, doc);
		return doc.petLedger;
	});
}

/* Serialized read-modify-write: page saves (history pushes) and pet-host
 * config writes both load → mutate → save the SAME file. Two interleaved
 * RMWs lose whichever wrote first (whole-file rename). Everything on this
 * Node process funnels through one promise chain, so mutations apply in
 * arrival order; cross-process races remain possible but the desktop runs
 * one engine per ledger. */
let writeChain = Promise.resolve();

/** Queue `mutator` (sync fn: load → mutate → save) on the write chain.
 * Returns a promise for the mutator's return value; a failed mutation is
 * swallowed by the chain (the NEXT writer must not inherit a rejection)
 * but propagated to the caller. */
export function queueStoreWrite(dir, mutator) {
	const run = writeChain.then(() => mutator());
	writeChain = run.then(() => undefined, () => undefined);
	return run;
}

/**
 * Merge the incoming full-document history with the stored one — every
 * window pushes a full replace, so a plain "last write wins" would let two
 * live windows (or a page reload mid-push) silently erase each other's
 * records. Mutates and returns `incoming` with the merged `clearAt` +
 * `history` applied. Ordered pipeline (do NOT reorder without updating
 * test-host-store.js — the second pass must run after exact-key insertion;
 * snapshotting it before the put() loops made it iterate an empty map):
 * 1. union by the client's dedupe key (sessionId|endTime|kind), preferring
 *    the richer entry (a real title beats the 未命名任务 placeholder, then
 *    the newer `at`);
 * 2. second pass collapses same-turn re-fires (the DOM chip can race a
 *    page reload and push one turn twice with 70ms-different endTime,
 *    which the exact key misses);
 * 3. deletion sync: every record OLDER than max(clearAt stored, clearAt
 *    incoming) is dropped — a 清空历史 bumps clearAt, and merge-only sync
 *    can never propagate a deletion on its own;
 * 4. newest-first, capped at HISTORY_LIMIT.
 * Host-owned keys survive the replace: windows never author these, so a
 * page save that omits them inherits the stored value instead of wiping
 * them. 2026-11-18（全面分析 C-1 终版 Top1）：原契约只保 `pet`——11-11
 * relay 轮之后账本新增的 petConfig（设置 relay 快照）/pendingJump/
 * pendingSettings（跳转·设置补偿）/_debug（取证）都是宿主管辖键，页鲸
 * 任意一次 /save 都会整键抹掉它们（relay 跨重启失效/跳转失约/取证丢失）。
 * 保留集必须随宿主键清单同步扩容——新宿主键落账时这里必须跟着加。
 * 0.4.3 阶段 C：追加 'petLedger'（互动账本，P-09 数据地基）——页鲸任意一次
 * /save 都不得抹掉它。
 */
const HOST_LEDGER_KEYS = ['pet', 'petConfig', 'pendingJump', 'pendingSettings', '_debug', 'petLedger'];
export function mergeHistory(existing, incoming) {
	if (!incoming || typeof incoming !== 'object') return incoming;
	if (existing && typeof existing === 'object') {
		for (const hk of HOST_LEDGER_KEYS) {
			if (incoming[hk] === undefined && existing[hk] !== undefined) incoming[hk] = existing[hk];
		}
	}
	/* 0.4.3 阶段 C（P-09）：petLedger 日级合并——整键保留只是兜底，两侧都带
	 * days 时按 date 并集、同日取 incoming（新写者胜，「按 date 去重取新」；
	 * 存量铺在前、incoming 铺在后=normalizePetLedger 的后者胜去重）。
	 * 归一化在合并出口统一过一遍：超龄日在此挤出、脏条目单丢、单日钳顶。
	 * 页鲸 /save 从不携带此键（pushCloudHistory 只发 {v,history,clearAt}），
	 * incoming 有值只会来自宿主自身写链或测试——无陈旧回声风险；incoming
	 * 携带垃圾形状（手改账本）时 normalize 整键回落空集，但存量 days 仍在前
	 * 半段参与并集=不会被垃圾抹掉。 */
	if (incoming.petLedger !== undefined) {
		incoming.petLedger = normalizePetLedger({
			days: [
				...((existing && existing.petLedger && Array.isArray(existing.petLedger.days)) ? existing.petLedger.days : []),
				...((incoming.petLedger && Array.isArray(incoming.petLedger.days)) ? incoming.petLedger.days : [])
			]
		});
	}
	if (!Array.isArray(incoming.history)) return incoming;
	const clearAt = Math.max((existing && existing.clearAt) || 0, incoming.clearAt || 0);
	incoming.clearAt = clearAt;
	const alive = (e) => !clearAt || (e && (e.at || 0) >= clearAt);
	const richness = (e) => (e && e.title && e.title !== '未命名任务' ? 2 : 0) + (e && (e.endTime || e.at) ? 1 : 0);
	const seen = new Map();
	const put = (e) => {
		if (!e || typeof e !== 'object' || Array.isArray(e)) return;
		const key = [e.sessionId || '', e.endTime || e.at || 0, e.kind || ''].join('|');
		const prev = seen.get(key);
		if (prev === undefined) { seen.set(key, e); return; }
		if (richness(e) > richness(prev)) seen.set(key, e);
		/* BUG-C（2026-11-24 真机）：同键同富度同 `at` 时以**后写入者**为准。
		 * 页鲸在动态改名后会推送标题刷新的同一条记录；旧策略保留 existing=账本
		 * 旧标题，导致改名永远落不了库（页内历史已新、宿主账本/桌宠抽屉仍旧）。
		 * 同键=同一条记录，标题差异只可能是「后写的是新名」，安全。 */
		else if (richness(e) === richness(prev) && (e.at || 0) >= (prev.at || 0)) seen.set(key, e);
	};
	for (const e of (existing && Array.isArray(existing.history) ? existing.history : []).filter(alive)) put(e);
	for (const e of incoming.history.filter(alive)) put(e);
	const all = [...seen.values()].sort((x, y) => (x.at || 0) - (y.at || 0));
	seen.clear();
	/* (clear BEFORE the rebuild: rebuilding into the same map without
	 * clearing left the original exact keys in place and the whole pass
	 * was a no-op) */
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
	incoming.history = [...seen.values()]
		.sort((x, y) => (y.at || 0) - (x.at || 0))
		.slice(0, HISTORY_LIMIT);
	return incoming;
}
