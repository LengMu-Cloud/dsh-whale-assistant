/**
 * Host-half ledger tests: whale-assistant/lib/store.js — load / atomic save /
 * merge pipeline. Pure local fs against a temp dir; no DSH, no network,
 * finishes in well under a second. Run: node test-host-store.js
 */
import assert from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, mergeHistory, saveStoreAtomic, storePath } from './whale-assistant/lib/store.js';
import { isTrustedRequest } from './whale-assistant/lib/index.js';
import { applyPet, checkPetToken, enumerateFrames, enumerateHistory, normalizePetDoc, normalizePetSyncPatch, petBootStateScript, resolvePetCode, PET_FORMS, heartbeatGate } from './whale-assistant/lib/pet.js';

let passed = 0;
function ok(cond, msg) { passed++; assert.ok(cond, msg); }

/* fake request factory: socket carries localPort, headers carry the
 * browser-forgery vectors the fence exists to stop */
function fakeReq(headers) {
	return { headers: headers || {}, socket: { localPort: 3099, remoteAddress: '127.0.0.1' } };
}

const dir = mkdtempSync(join(tmpdir(), 'whale-store-test-'));

/* 1. first run: absent ledger reads as null */
ok(loadStore(dir) === null, 'absent ledger -> null');

/* 2. atomic save roundtrip, no .tmp leftover */
saveStoreAtomic(dir, { clearAt: 0, history: [{ sessionId: 's1', at: 10, kind: 'done', title: 't1' }] });
const loaded = loadStore(dir);
ok(loaded && loaded.history.length === 1 && loaded.history[0].title === 't1', 'roundtrip keeps the doc');
ok(readdirSync(dir).length === 1, 'no .tmp leftover after rename');

/* 3. second save overwrites atomically (last complete write wins) */
saveStoreAtomic(dir, { clearAt: 0, history: [] });
ok(loadStore(dir).history.length === 0, 'overwrite wins');
/* 【0.4.3 阶段 C 例外修改·与 HOST_LEDGER_KEYS 断言同款豁免】日备 rotating
 * （G-3，任务2）让账本落盘前把上一份版本滚动复制为单槽备份
 * <ledger>.backup-1（设计产物，与 .tmp 残留性质不同）——本断言的本意是
 * 「rename 后无 .tmp 残留」，改为排除 .backup- 计数，原语义不变。 */
ok(readdirSync(dir).filter((f) => f.indexOf('.backup-') === -1).length === 1, 'still exactly one file');

/* 4. corruption quarantine: garbage ledger is renamed aside, not swallowed */
const garbage = '{"history":[{"sessionId":"s1","at":99';
writeFileSync(storePath(dir), garbage, 'utf8');
ok(loadStore(dir) === null, 'corrupt ledger -> null (fresh baseline)');
const leftovers = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
ok(leftovers.length === 1, 'corrupt file renamed aside');
ok(readFileSync(join(dir, leftovers[0]), 'utf8') === garbage, 'quarantined bytes intact');

/* 5. after quarantine the ledger works fresh */
saveStoreAtomic(dir, { clearAt: 0, history: [{ sessionId: 's2', at: 20, kind: 'done', title: 't2' }] });
ok(loadStore(dir).history[0].title === 't2', 'fresh ledger after quarantine');

/* 6. exact-key union: at equal richness the newer `at` wins (endTime pins
 *    the dedupe key, so `at` may differ inside one key) */
const m1 = mergeHistory(
	{ clearAt: 0, history: [{ sessionId: 'a', endTime: 'T1', at: 100, kind: 'done', title: '旧' }] },
	{ clearAt: 0, history: [{ sessionId: 'a', endTime: 'T1', at: 200, kind: 'done', title: '新' }] }
);
ok(m1.history.length === 1 && m1.history[0].title === '新', 'exact-key union: newer entry wins at equal richness');

/* 6b. BUG-C（2026-11-24）：同键同富度同 `at` 的标题刷新必须落库——动态改名后
 * 页鲸推送的新标题不得被账本里的旧标题挡住（equal-time tie → later writer wins） */
const m1b = mergeHistory(
	{ clearAt: 0, history: [{ sessionId: 'a', endTime: 'T1', at: 100, kind: 'done', title: '旧名' }] },
	{ clearAt: 0, history: [{ sessionId: 'a', endTime: 'T1', at: 100, kind: 'done', title: '新名' }] }
);
ok(m1b.history.length === 1 && m1b.history[0].title === '新名', 'exact-key equal-time: the pushing (later) title wins — dynamic rename refresh lands');

/* 7. real title beats the 未命名任务 placeholder at the same dedupe key */
const m2 = mergeHistory(
	{ clearAt: 0, history: [{ sessionId: 'b', endTime: 'T1', at: 200, kind: 'done', title: '真实标题' }] },
	{ clearAt: 0, history: [{ sessionId: 'b', endTime: 'T1', at: 300, kind: 'done', title: '未命名任务' }] }
);
ok(m2.history.length === 1 && m2.history[0].title === '真实标题', 'richness beats the newer placeholder');

/* 8. clearAt deletion sync drops records older than the marker */
const m3 = mergeHistory(
	{ clearAt: 0, history: [{ sessionId: 'c', at: 50, kind: 'done', title: '旧' }] },
	{ clearAt: 100, history: [{ sessionId: 'c', at: 150, kind: 'done', title: '新' }] }
);
ok(m3.clearAt === 100, 'clearAt takes the max');
ok(m3.history.length === 1 && m3.history[0].at === 150, 'records older than clearAt dropped');

/* 9. second pass collapses same-turn re-fires (regression: this pass once
 *    iterated an EMPTY map — its snapshot was taken before the put() loops) */
const m4 = mergeHistory(
	{ clearAt: 0, history: [] },
	{ clearAt: 0, history: [
		{ sessionId: 'd', kind: 'done', turnTokens: 100, at: 1000 },
		{ sessionId: 'd', kind: 'done', turnTokens: 100, at: 60000, title: '真标题' }
	] }
);
ok(m4.history.length === 1, 'near-duplicate re-fire collapsed');
ok(m4.history[0].title === '真标题', 'collapsed entry keeps the richer one');

/* 10. second pass does NOT collapse genuinely different turns */
const m5 = mergeHistory(
	{ clearAt: 0, history: [] },
	{ clearAt: 0, history: [
		{ sessionId: 'e', kind: 'done', turnTokens: 100, at: 1000, title: '甲' },
		{ sessionId: 'e', kind: 'done', turnTokens: 220, at: 60000, title: '乙' }
	] }
);
ok(m5.history.length === 2, 'different turnTokens stay separate');

/* 11. 500 cap, newest first */
const many = [];
for (let i = 1; i <= 600; i++) many.push({ sessionId: 'f' + i, at: i, kind: 'done', title: 't' + i });
const m6 = mergeHistory({ clearAt: 0, history: [] }, { clearAt: 0, history: many });
ok(m6.history.length === 500, 'history capped at 500');
ok(m6.history[0].at === 600, 'newest first after cap');

/* 12. incoming without a history array passes through unmerged */
const m7 = mergeHistory({ clearAt: 7, history: [] }, { settings: true });
ok(m7.history === undefined && m7.settings === true, 'non-history doc passes through unmerged');

/* 13. junk rows are ignored instead of crashing the merge */
const m8 = mergeHistory(
	{ clearAt: 0, history: [null, 42, { sessionId: 'g', at: 5, kind: 'done', title: '好' }] },
	{ clearAt: 0, history: [{ sessionId: 'g', at: 5, kind: 'done', title: '好' }] }
);
ok(m8.history.length === 1, 'junk rows filtered, good row kept');

/* 13b. host-key retention（2026-11-18 全面分析 C-1 终版 Top1）：页鲸 /save
 *    不携带宿主管辖键时必须继承存量而不是抹掉——11-11 relay 轮之后账本
 *    新增的 petConfig/pendingJump/pendingSettings/_debug 曾被页鲸任意一次
 *    历史推送整键抹掉（设置 relay 跨重启失效/跳转补偿失约/取证丢失），
 *    原保留集只有 `pet`。
 *    【0.4.3 阶段 C 契约豁免修改（任务1·HOST_LEDGER_KEYS 6 键）】追加
 *    petLedger（互动账本，P-09 数据地基）进夹具与断言——保留集 5→6 键。
 *    日期取「昨天」动态值：petLedger 有 90 天滚动闸门，硬编码日期会让本块
 *    在机器日推进 89 天后翻车（阶段 B 的硬编码日期都在无滚动字段上）。 */
const plYesterday = (function () {
	const d = new Date(Date.now() - 86400000);
	const m = d.getMonth() + 1, dd = d.getDate();
	return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
})();
const mH1 = mergeHistory(
	{ clearAt: 0, history: [], pet: { form: 'full' }, petConfig: { volume: 80 }, pendingJump: { code: 's3' }, pendingSettings: { volume: 80 }, _debug: { at: 1 }, petLedger: { days: [{ date: plYesterday, pets: 3, wakes: 5 }] } },
	{ clearAt: 0, history: [{ sessionId: 'h', at: 5, kind: 'done', title: '页鲸推送' }] }
);
ok(mH1.pet && mH1.pet.form === 'full', 'host key pet survives a page save');
ok(mH1.petConfig && mH1.petConfig.volume === 80, 'host key petConfig survives a page save');
ok(mH1.pendingJump && mH1.pendingJump.code === 's3', 'host key pendingJump survives a page save');
ok(mH1.pendingSettings && mH1.pendingSettings.volume === 80, 'host key pendingSettings survives a page save');
ok(mH1._debug && mH1._debug.at === 1, 'host key _debug survives a page save');
/* 【0.4.3 阶段 C】第 6 键：petLedger 保留 + 日级合并出口归一化（升序/钳顶
 * 形状逐字对照契约 {"days":[{"date","pets","wakes"}]}） */
ok(Array.isArray(mH1.petLedger && mH1.petLedger.days) && mH1.petLedger.days[0].date === plYesterday && mH1.petLedger.days[0].pets === 3 && mH1.petLedger.days[0].wakes === 5, 'host key petLedger survives a page save (days shape verbatim)');
/* 13c. incoming DOES carry a host key → incoming wins（宿主自己写自己的键，
 *    写路径不变） */
const mH2 = mergeHistory(
	{ clearAt: 0, history: [], pet: { form: 'full' }, petConfig: { volume: 80 } },
	{ clearAt: 0, history: [], pet: { form: 'bubble' }, petConfig: { volume: 30 } }
);
ok(mH2.pet && mH2.pet.form === 'bubble' && mH2.petConfig && mH2.petConfig.volume === 30, 'incoming host keys win (host write path unchanged)');

/* 14. browser fence (isTrustedRequest): the page half's own calls pass,
 *    every forgery vector is refused */
ok(isTrustedRequest(fakeReq({ host: '127.0.0.1:3099', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3099' })), 'fence: same-origin browser POST passes');
ok(isTrustedRequest(fakeReq({ host: '127.0.0.1:3099' })), 'fence: curl/local tool (Host only) passes');
ok(isTrustedRequest(fakeReq({ host: 'localhost:3099', 'sec-fetch-site': 'same-origin' })), 'fence: localhost browsing passes');
ok(!isTrustedRequest(fakeReq({ host: '127.0.0.1:3099', 'sec-fetch-site': 'cross-site' })), 'fence: cross-site fetch refused');
ok(!isTrustedRequest(fakeReq({ host: 'evil.com:3099', 'sec-fetch-site': 'same-origin', origin: 'http://evil.com:3099' })), 'fence: DNS-rebound Host refused');
ok(!isTrustedRequest(fakeReq({ host: '127.0.0.1:3099', origin: 'http://localhost:5173' })), 'fence: cross-port localhost Origin refused');
ok(!isTrustedRequest(fakeReq({})), 'fence: missing Host refused');
ok(!isTrustedRequest(fakeReq({ host: '127.0.0.1:9999' })), 'fence: wrong port refused');

/* 15. pet switch survives page full-replace saves (host-owned `pet` key) */
const m9 = mergeHistory(
	{ clearAt: 0, pet: { enabled: true, form: 'bubble' }, history: [{ sessionId: 'h', at: 1, kind: 'done' }] },
	{ clearAt: 0, history: [{ sessionId: 'h2', at: 2, kind: 'done' }] }
);
ok(m9.pet && m9.pet.enabled === true && m9.pet.form === 'bubble', 'page save without pet inherits the stored switch');
const m10 = mergeHistory({ clearAt: 0, pet: { enabled: false }, history: [] }, { clearAt: 0, pet: { enabled: true }, history: [] });
ok(m10.pet.enabled === true, 'incoming doc MAY carry its own pet key (not overwritten)');

/* 16. pet token check: header absent / wrong / length-mismatch all refuse,
 *     right token passes; no token configured refuses everything */
const TOKEN = 'a'.repeat(64);
ok(!checkPetToken(fakeReq({}), TOKEN), 'pet token: missing header refused');
ok(!checkPetToken(fakeReq({ 'x-dsh-pet-token': 'b'.repeat(64) }), TOKEN), 'pet token: wrong value refused');
ok(!checkPetToken(fakeReq({ 'x-dsh-pet-token': 'a'.repeat(63) }), TOKEN), 'pet token: length mismatch refused (no throw)');
ok(checkPetToken(fakeReq({ 'x-dsh-pet-token': TOKEN }), TOKEN), 'pet token: correct value passes');
ok(!checkPetToken(fakeReq({ 'x-dsh-pet-token': TOKEN }), null), 'pet token: no configured token refuses');

/* 17. pet doc normalization: unknown shapes fall back to defaults */
ok(JSON.stringify(normalizePetDoc(null)) === '{"enabled":false,"form":"full","aff":null,"affMs":null,"pos":null}', 'normalize: null doc -> defaults (BUG-1: petDoc carries aff/affMs/pos)');
ok(normalizePetDoc({ pet: { enabled: 1, form: 'weird' } }).enabled === false && normalizePetDoc({ pet: { enabled: 1, form: 'weird' } }).form === 'full', 'normalize: junk form falls back, non-boolean enabled is NOT enabled');
ok(normalizePetDoc({ pet: { enabled: true } }).enabled === true, 'normalize: exact-boolean enabled sticks');

/* ---- BUG-1（11-16 实机验收）：桌宠中继端口每-boot 随机 → pet 页 origin 变
 * → localStorage 失忆。好感度/里程碑/位置随 petDoc 跨重启（与 form 同一条
 * 通道）。normalizePetDoc 容错读 + normalizePetSyncPatch 载荷校验（纯函数，
 * 处理器在 applyPet 闭包内、直接驱动会写真实 ~/.dsh 账本，故测纯函数）。 ---- */
{
	/* roundtrip: 写入形状（writePetDoc 的合并产物）经 normalizePetDoc 原样读回 */
	const doc = normalizePetDoc({ pet: { enabled: true, form: 'bubble', aff: 7.9, affMs: '10,50', pos: { rx: 18, by: 24, x: 100, y: 200 } } });
	assert.deepStrictEqual(doc, { enabled: true, form: 'bubble', aff: 7, affMs: '10,50', pos: { rx: 18, by: 24, x: 100, y: 200 } }, 'BUG-1: petDoc aff(整数化)/affMs/pos roundtrip');
	/* 脏数据回落 null，手改账本不得杀死 boot */
	const junk = normalizePetDoc({ pet: { form: 'bubble', aff: -3, affMs: 42, pos: { rx: 'x', by: null } } });
	assert.deepStrictEqual(junk, { enabled: false, form: 'bubble', aff: null, affMs: null, pos: null }, 'BUG-1: junk aff/affMs/pos fall back to null (hand-edited ledger must not kill boot)');
	/* pos 缺 x/y 补 0（savePos 恒带 x/y，账本缺字段不致命） */
	const partial = normalizePetDoc({ pet: { pos: { rx: 5, by: 6 } } });
	assert.deepStrictEqual(partial.pos, { rx: 5, by: 6, x: 0, y: 0 }, 'BUG-1: pos without x/y defaults them to 0');
	/* 非有限数一律拒 */
	ok(normalizePetDoc({ pet: { aff: Number.NaN } }).aff === null && normalizePetDoc({ pet: { pos: { rx: Number.POSITIVE_INFINITY, by: 1 } } }).pos === null, 'BUG-1: non-finite aff/rx rejected');
	/* sync 载荷校验：有效三字段 */
	assert.deepStrictEqual(
		normalizePetSyncPatch({ aff: 12.7, affMs: '10', pos: { rx: 3, by: 4 } }),
		{ aff: 12, affMs: '10', pos: { rx: 3, by: 4, x: 0, y: 0 } },
		'BUG-1: sync patch accepts aff+affMs+pos (aff floored, pos x/y defaulted)'
	);
	/* 字段级合并语义：只带 aff 的 patch 不带出 affMs/pos 键 */
	assert.deepStrictEqual(normalizePetSyncPatch({ aff: 3 }), { aff: 3 }, 'BUG-1: sync patch carries ONLY the fields present (partial merge)');
	/* 无有效字段 -> null（处理器回 400） */
	ok(normalizePetSyncPatch({}) === null && normalizePetSyncPatch(null) === null && normalizePetSyncPatch({ aff: -1, affMs: 9, pos: 'x' }) === null, 'BUG-1: sync patch with no valid field -> null (400)');
	/* affMs 截 64、aff 钳顶 */
	ok(normalizePetSyncPatch({ affMs: 'x'.repeat(100) }).affMs.length === 64, 'BUG-1: affMs clamped to 64 chars');
	ok(normalizePetSyncPatch({ aff: 99999999 }).aff === 9999999, 'BUG-1: aff clamped to 9999999');
}

/* ---- BUG-1 boot seeding（11-17 二轮，用户实报「先开在右下角然后闪到上次
 * 位置」）：宿主把 petDoc 快照注入 /pet/page <head>——新 origin 的
 * localStorage 在 whale.js 求值前落好，loadPos 走本地存量路径=鲸鱼淡入即在
 * 上次落点（轮询下发那条路保留作兜底，从此对新 boot 不再承担落位）。 ---- */
{
	/* 有效快照 → 自包含种入脚本：信封形状与 savePos/saveAffection 写出同构
	 * （boot 快照 JSON 携带值，种入模板决定信封形状——运行时产物与
	 * savePos/saveAffection 的 localStorage 逐字节同形） */
	const s = petBootStateScript(3, '10', { rx: 278, by: 158, x: 1186, y: 681 });
	ok(s.includes('"dsh-whale:pos"') && s.includes('"dsh-whale:affection"') && s.includes('"dsh-whale:affMs"'), 'BUG-1: boot script seeds all three keys');
	ok(s.includes('"pos":{"rx":278,"by":158,"x":1186,"y":681}') && s.includes('data:{v:2,rx:b.pos.rx,by:b.pos.by,x:b.pos.x,y:b.pos.y}'), 'BUG-1: pos snapshot verbatim + envelope matches savePos shape');
	ok(s.includes('"aff":3') && s.includes('data:{value:b.aff}'), 'BUG-1: affection snapshot + envelope matches saveAffection shape');
	ok(s.includes('try{') && s.includes('}catch(e){}})();'), 'BUG-1: script is self-contained and failure-silent');
	/* 幂等：只在 localStorage 缺键时种（origin 幸存时本地是最新的） */
	ok((s.match(/!localStorage.getItem/g) || []).length === 3, 'BUG-1: every seed is gated on the key being absent');
	/* `</script>` 逃逸防护：affMs 里的 < 必须转义 */
	const evil = petBootStateScript(0, '</script><script>alert(1)</script>', null);
	ok(!evil.includes('</script>') && evil.includes('\\u003c'), 'BUG-1: < in affMs escaped (script-breakout impossible)');
	/* pos 缺 x/y 补 0、脏 aff 过滤 */
	const partial = petBootStateScript(-2, '', { rx: 5, by: 6 });
	ok(partial.includes('"x":0,"y":0') && !partial.includes('"aff"') && !partial.includes('"affMs"'), 'BUG-1: junk aff dropped, pos without x/y defaults them');
	/* 全空 → 空注释占位（首次启用/账本缺货：鲸鱼在默认角，照旧） */
	ok(petBootStateScript(null, null, null).includes('pet boot state: none'), 'BUG-1: empty ledger -> inert placeholder');
	/* 双侧契约：page.html 占位在 <head> 内（先于 whale.js 求值）+ 宿主真替换 */
	const page = readFileSync(new URL('./whale-assistant/pet/page.html', import.meta.url), 'utf8');
	const headEnd = page.indexOf('</head>');
	const whaleTag = page.indexOf('<script src="whale.js">');
	ok(page.indexOf('__DSH_PET_BOOT__') !== -1 && page.indexOf('__DSH_PET_BOOT__') < headEnd, 'BUG-1: page.html carries the boot marker inside <head>');
	ok(headEnd !== -1 && whaleTag !== -1 && headEnd < whaleTag, 'BUG-1: head (seeding point) precedes the whale.js script tag');
	const petSrc = readFileSync(new URL('./whale-assistant/lib/pet.js', import.meta.url), 'utf8');
	ok(petSrc.includes("replace('__DSH_PET_BOOT__'") && petSrc.includes('petBootStateScript(petAff, petAffMs, petPos)'), 'BUG-1: /pet/page handler substitutes the marker with the ledger snapshot');
}
ok(PET_FORMS.join('|') === 'full|bubble|hidden', 'form enum is the three-state contract');

/* 18. enumerated feed: content stripped, whitelist only, stable synthetic ids,
 *     frame-level seq preserved for the whale's last-seen bookkeeping.
 *     11-03 边界放宽（用户拍板）：真实标题 + 聚合 token 数放行（通知契约
 *     附录C 语义：[真实会话名]完成了 + 三行用量）；正文/参数仍剥离。 */
const book = { codes: new Map(), next: 0 };
const frames = [
	{ seq: 10, type: 'session/event', sessionId: 'session-real', event: { type: 'turn/start', time: 1, data: { prompt: '机密提示词' } } },
	{ seq: 11, type: 'session/projection', sessionId: 'session-real', key: 'title', value: '真实标题' },
	{ seq: 12, type: 'session/event', sessionId: 'session-real', event: { type: 'turn/end', time: 2, data: { reason: { kind: 'completed' }, usage: { total: 12345 } } } },
	{ seq: 13, type: 'session/event', sessionId: 'session-real', event: { type: 'assistant/message', time: 3, data: { tokens: 999 } } },
	{ seq: 14, type: 'session/event', sessionId: 'session-real', event: { type: 'tool/call', time: 4, data: { name: 'ask_user_question', callId: 'real-call', text: '问题全文' } } },
	{ seq: 15, type: 'session/event', sessionId: 'session-other', event: { type: 'tool/call', time: 5, data: { name: 'browser_click' } } },
	{ seq: 16, type: 'session/event', sessionId: 'session-other', event: { type: 'turn/end', time: 6, data: { reason: { kind: 'aborted' } } } }
];
const enumed = enumerateFrames(frames, book);
ok(enumed.length === 5, 'enum: whitelist survives (start/title-projection/end-completed/ask/aborted)');
ok(JSON.stringify(enumed.map((e) => e.seq)) === '[10,11,12,14,16]', 'enum: frame seq preserved verbatim');
ok(enumed.every((e) => !/session-[^p]/.test(JSON.stringify(e).replace(/session-pet-s/g, ''))), 'enum: no real session id leaks');
ok(enumed.every((e) => !/机密|tokens":999|callId":"real-call|问题全文|total":12345/.test(JSON.stringify(e))), 'enum: zero prompts/arguments/callIds/text/non-whitelisted usage');
/* synthetic ids MUST carry the 'session-' main-task prefix: the whale's
 * sub-agent silence gate drops bare ids (smoke-proven 10-31 — a pet-sN id
 * mutes ALL task notifications) */
ok(enumed[0].sessionId === 'session-pet-s1' && enumed[4].sessionId === 'session-pet-s2', 'enum: stable per-boot codes with the main-task prefix');
ok(enumed[2].event.data && enumed[2].event.data.reason && enumed[2].event.data.reason.kind === 'completed' && Object.keys(enumed[2].event.data).length === 1, 'enum: turn/end keeps only reason.kind');
ok(enumed[0].event.data && Object.keys(enumed[0].event.data).length === 0, 'enum: turn/start payload emptied');
/* 11-03 title projection passes through on the CURRENT task code — the pet
 * page's naming chain (sessionTitles → 晚到真名改写) takes it from here */
ok(enumed[1].type === 'session/projection' && enumed[1].sessionId === 'session-pet-s1' && enumed[1].key === 'title' && enumed[1].value === '真实标题', 'enum: title projection rides the current task code (real name)');
const enumed2 = enumerateFrames([{ seq: 20, type: 'session/event', sessionId: 'session-real', event: { type: 'turn/start', time: 9 } }], book);
ok(enumed2[0].sessionId === 'session-pet-s1', 'enum: code book stays stable across calls');

/* 11-06 审核通知（用户实报「提问能通知，审核通知不了」）：approval/asked
 * （DSH 0.2.1 asar 类型表 {id, toolName, callId?, reason?}）进入枚举白名单
 * ——只带 toolName，id/callId/reason（可能携带审批上下文文本）全剥。 */
const abook = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
const a1 = enumerateFrames([
	{ seq: 40, type: 'session/event', sessionId: 'session-A', event: { type: 'approval/asked', time: 1, data: { id: 'ar-1', toolName: 'pwsh', callId: 'call-x', reason: '审批原因全文机密' } } },
	{ seq: 41, type: 'session/event', sessionId: 'session-A', event: { type: 'approval/asked', time: 2, data: { id: 'ar-2' } } }
], abook);
ok(a1.length === 1 && a1[0].event.type === 'approval/asked' && a1[0].event.data.name === 'pwsh', 'enum: approval/asked passes toolName only');
ok(a1.length === 1 && !/审批原因|ar-1|call-x/.test(JSON.stringify(a1)), 'enum: approval reason/id/callId stay stripped');
ok(a1.length === 1 && a1[0].sessionId === 'session-pet-s1', 'enum: approval frame rides the synthetic session code');
const a2 = enumerateFrames([{ seq: 42, type: 'session/event', sessionId: 'session-A', event: { type: 'approval/asked', time: 3, data: {} } }], abook);
ok(a2.length === 0, 'enum: approval without toolName is dropped entirely');

/* 18c. 11-03 enumerated boundary widening: the notification contract's real
 *      name + three-line usage report need title/usage aggregates through
 *      the feed; body text / non-aggregate fields stay stripped */
const wbook = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
const wframes = [
	{ seq: 30, type: 'session/event', sessionId: 'session-W', event: { type: 'turn/start', time: 1, data: {} } },
	{ seq: 31, type: 'session/event', sessionId: 'session-W', event: { type: 'assistant/message', time: 2, data: { usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 33 }, message: { id: 'msg-1', text: '正文机密' } } } },
	{ seq: 32, type: 'session/event', sessionId: 'session-W', event: { type: 'session/title', time: 3, data: { title: '真实会话名' } } },
	{ seq: 33, type: 'session/projection', sessionId: 'session-W', key: 'tokenUsage', value: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, secretField: 5 } },
	{ seq: 34, type: 'session/projection', sessionId: 'session-W', key: 'contextPressure', value: { pressureTokens: 10, projectedTokens: 12, contextWindow: 262144, note: 'x' } },
	{ seq: 35, type: 'session/projection', sessionId: 'session-W', key: 'inbox', value: { anything: 1 } },
	{ seq: 36, type: 'session/projection', sessionId: 'session-stranger', key: 'title', value: '无码会话标题' }
];
const w1 = enumerateFrames(wframes, wbook);
const wMsg = w1.find((e) => e.seq === 31);
ok(wMsg && wMsg.event.data.usage && wMsg.event.data.usage.inputTokens === 11 && wMsg.event.data.usage.outputTokens === 22 && wMsg.event.data.usage.cacheReadTokens === 33, 'enum: assistant/message usage aggregates pass (three-line report source)');
ok(wMsg && !/正文机密|msg-1/.test(JSON.stringify(wMsg)), 'enum: message text/ids stay stripped');
const wTitle = w1.find((e) => e.seq === 32);
ok(wTitle && wTitle.event.data.title === '真实会话名' && wTitle.sessionId === 'session-pet-s1', 'enum: session/title event passes the real name on the current code');
const wTok = w1.find((e) => e.seq === 33);
ok(wTok && wTok.value.uncachedInputTokens === 1 && wTok.value.outputTokens === 2 && wTok.value.cacheReadTokens === 3 && wTok.value.cacheWriteTokens === 4, 'enum: tokenUsage projection passes the four aggregate counts');
ok(wTok && !/secretField/.test(JSON.stringify(wTok)), 'enum: non-contract fields of a whitelisted projection are stripped');
const wPress = w1.find((e) => e.seq === 34);
ok(wPress && wPress.value.pressureTokens === 10 && wPress.value.projectedTokens === 12 && wPress.value.contextWindow === 262144 && !/note/.test(JSON.stringify(wPress)), 'enum: contextPressure projection passes the three counts only');
ok(!w1.some((e) => e.seq === 35), 'enum: other projection keys stay dropped (inbox)');
ok(!w1.some((e) => e.seq === 36), 'enum: projections for codeless sessions are dropped (no stray codes)');

/* 18b. pet jump (11-03): per-TURN codes so 同会话多任务 reads 任务 1/任务 2,
 *      seq-keyed idempotency against ring-buffer replay, and the reverse
 *      index every code ever issued (old notifications keep their target) */
const jbook = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
const jframes = [
	{ seq: 100, type: 'session/event', sessionId: 'session-A', event: { type: 'turn/start', time: 1, data: {} } },
	{ seq: 101, type: 'session/event', sessionId: 'session-A', event: { type: 'turn/end', time: 2, data: { reason: { kind: 'completed' } } } },
	{ seq: 102, type: 'session/event', sessionId: 'session-A', event: { type: 'turn/start', time: 3, data: {} } },
	{ seq: 103, type: 'session/event', sessionId: 'session-A', event: { type: 'turn/end', time: 4, data: { reason: { kind: 'completed' } } } }
];
const j1 = enumerateFrames(jframes, jbook);
ok(j1[0].sessionId === 'session-pet-s1' && j1[1].sessionId === 'session-pet-s1', 'jump: task 1 codes s1 (start+end pair)');
ok(j1[2].sessionId === 'session-pet-s2' && j1[3].sessionId === 'session-pet-s2', 'jump: task 2 in the SAME conversation gets its own number');
/* replay does NOT burn new numbers: every start seq is remembered, so a
 * second pass over the same frames leaves the book's next code untouched —
 * a genuinely new turn still gets the NEXT number in sequence */
enumerateFrames(jframes, jbook);
ok(jbook.next === 2, 'jump: replay does not churn the code book (next stays 2)');
const j2 = enumerateFrames([{ seq: 104, type: 'session/event', sessionId: 'session-A', event: { type: 'turn/start', time: 5, data: {} } }], jbook);
ok(j2[0].sessionId === 'session-pet-s3', 'jump: a new turn after replay takes the next number (s3)');
ok(resolvePetCode(jbook, 1) === 'session-A' && resolvePetCode(jbook, 2) === 'session-A', 'jump: reverse index resolves BOTH task codes to the real conversation');
	ok(resolvePetCode(jbook, 4) === null && resolvePetCode(jbook, 0) === null && resolvePetCode(jbook, -1) === null, 'jump: unknown/expired codes resolve to null');

/* ---- 18d. pet/state / pet/dismiss 枚举直通（11-14，用户实报「设置切形态
 *      比桌宠右键菜单慢一拍」）：枚举流此前把非 session/* 全剥，桌宠页感知
 *      form/dismiss 只剩 2s fetchState 兜底轮询。两类帧全是布尔/枚举串/
 *      整数编号，零会话内容，白名单字段放行=枚举化边界不破。 ---- */
{
	const pbook = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
	const ps1 = enumerateFrames([{ seq: 7, type: 'pet/state', enabled: true, form: 'bubble', up: true, spawning: false, junk: 'x' }], pbook);
	ok(ps1.length === 1, 'pet/state: frame passes the enumerated stream (form switch reaches the pet page over SSE)');
	assert.deepStrictEqual(ps1[0], { seq: 7, type: 'pet/state', enabled: true, form: 'bubble', up: true, spawning: false }, 'pet/state: whitelist fields only (junk stripped, exact shape)');
	const ps2 = enumerateFrames([{ seq: 9, type: 'pet/state', enabled: 1, form: 42, up: 'yes', spawning: null }], pbook);
	assert.deepStrictEqual(ps2[0], { seq: 9, type: 'pet/state', enabled: false, form: 'full', up: false, spawning: false }, 'pet/state: missing form falls back to full, booleans forced ===true');
	const pd1 = enumerateFrames([{ seq: 8, type: 'pet/dismiss', code: 3, junk: 'y' }], pbook);
	ok(pd1.length === 1, 'pet/dismiss: frame passes the enumerated stream');
	assert.deepStrictEqual(pd1[0], { seq: 8, type: 'pet/dismiss', code: 3 }, 'pet/dismiss: only seq+code survive (junk stripped)');
	const pd2 = enumerateFrames([{ seq: 10, type: 'pet/dismiss' }], pbook);
	assert.deepStrictEqual(pd2[0], { seq: 10, type: 'pet/dismiss', code: 0 }, 'pet/dismiss: missing code coerces to 0 (Number(undefined)|0)');
	/* 原行为不破：无 sessionId 的非 pet 帧仍被丢弃（18 节的 session/event
	 * 白名单断言继续覆盖正常路径，这里补「pet 帧不得绕过 sid 闸门」回归） */
	ok(enumerateFrames([{ seq: 1, type: 'session/projection', key: 'title', value: 'x' }], pbook).length === 0, 'enum: sessionId-less non-pet frames stay dropped');
}

/* ---- heartbeat gate（审计 D-C1/GAP-11，2026-11-04）：自愈判定的五个门 ---- */
ok(heartbeatGate({ supported: true, enabled: true, spawning: false, childAlive: false, lastSpawnAt: Date.now() - 61000 }, Date.now()) === true, 'heartbeat: dead process + enabled + cooldown passed -> respawn');
ok(heartbeatGate({ supported: true, enabled: true, spawning: false, childAlive: true, lastSpawnAt: Date.now() - 61000 }, Date.now()) === false, 'heartbeat: process alive -> no respawn');
ok(heartbeatGate({ supported: true, enabled: true, spawning: false, childAlive: false, lastSpawnAt: Date.now() - 30000 }, Date.now()) === false, 'heartbeat: within 60s cooldown -> no respawn (crash-loop guard)');
ok(heartbeatGate({ supported: true, enabled: false, spawning: false, childAlive: false, lastSpawnAt: Date.now() - 61000 }, Date.now()) === false, 'heartbeat: disposed (enabled=false) -> never respawn (real-exit guard)');
ok(heartbeatGate({ supported: false, enabled: true, spawning: false, childAlive: false, lastSpawnAt: Date.now() - 61000 }, Date.now()) === false, 'heartbeat: non-win32 -> never');
ok(heartbeatGate(null, Date.now()) === false && heartbeatGate({ supported: true, enabled: true, spawning: false, childAlive: false, lastSpawnAt: Date.now() - 61000 }, 'not-a-number') === false, 'heartbeat: malformed args -> false');

/* ---- 评估 P1-1（2026-11-08）：环境性 spawn 早退（WebView2 缺失/资产缺失/
 * 端口缺失）必须落 spawning=false 并广播 up:false——spawning 卡 true 双死锁
 * （心跳门永不重试+页鲸判休眠=无 WebView2 的干净机器首装一屏无鱼）。
 * fake ctx 无 webServer → 本机（win32）走端口缺失路径；win32 门控=CI
 * (ubuntu) supported=false 不 spawn 不广播。三条路径共用 abortSpawn 助手，
 * 此处断言的是它们的共同契约帧。 ---- */
if (process.platform === 'win32') {
	const petFrames = [];
	applyPet(
		{ webServer: { register: () => () => {} } },
		{ pushFrame: (f) => petFrames.push(f) }
	);
	const st = petFrames.find((f) => f && f.type === 'pet/state');
	ok(st && st.up === false && st.spawning === false, 'pet/spawn: env-failure early return broadcasts up:false + spawning:false (P1-1: page whale wakes, heartbeat gate unblocked)');
}

/* ---- 桌宠历史抽屉枚举（11-05，用户实报「历史任务读取不到」）：共享账本
 * 经白名单下发给桌宠页——真实 id 不出宿主、字段剥离、clearAt 过滤、上限
 * 与最新优先排序。纯函数（see lib/pet.js enumerateHistory）。 ---- */
{
	const hbook = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
	const hdoc = {
		clearAt: 1000,
		history: [
			{ sessionId: 'aaa', title: 'T-newest', kind: 'done', at: 3000, endTime: 3500, turnTokens: 7 },
			{ sessionId: 'bbb', title: 'T-cleared', kind: 'fail', at: 900, turnTokens: 5 }, /* at < clearAt -> dropped */
			{ sessionId: 'aaa', title: 'T-older', kind: 'done', at: 2000 },
			{ sessionId: 'ccc', title: 'x'.repeat(300), kind: 'DROP<script>', at: 4000, content: 'must-not-leak', realSessionId: 'ccc' }
		]
	};
	const r1 = enumerateHistory(hdoc, hbook, 200);
	ok(r1.clearAt === 1000, 'pet/history: clearAt passthrough');
	ok(r1.history.length === 3, 'pet/history: clearAt-filtered entries dropped (4 -> 3)');
	ok(r1.history.every((e) => /^session-pet-s\d+$/.test(e.sessionId)), 'pet/history: synthetic ids only (real id never leaves the host)');
	const idNew = r1.history.find((e) => e.title === 'T-newest').sessionId;
	const idOld = r1.history.find((e) => e.title === 'T-older').sessionId;
	ok(idNew === idOld, 'pet/history: same session -> same code across entries (jump-stable)');
	const ccc = r1.history.find((e) => e.title && e.title.indexOf('x') === 0);
	ok(ccc && r1.history[0].sessionId === ccc.sessionId, 'pet/history: sorted newest-first (4000-at entry leads)');
	ok(ccc && ccc.title.length === 120, 'pet/history: title clamped to 120 chars');
	ok(ccc && ccc.kind === undefined, 'pet/history: non-enum kind stripped');
	ok(ccc && ccc.content === undefined && ccc.realSessionId === undefined, 'pet/history: unknown fields stripped (whitelist only)');
	ok(ccc && ccc.at === 4000, 'pet/history: whitelisted timing field kept');
	/* reverse index: a history row's minted code can jump back to the real session */
	const cccCode = Number(ccc.sessionId.slice('session-pet-s'.length));
	ok(resolvePetCode(hbook, cccCode) === 'ccc', 'pet/history: minted codes resolve back (drawer row jump works)');
	/* stable codes (11-05): the history code must NOT drift when a turn
	 * re-opens the session's notification code — otherwise the drawer's
	 * dedupe key breaks and records duplicate across pulls */
	const hbook3 = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
	const r3a = enumerateHistory({ history: [{ sessionId: 'aaa', title: 'T1', kind: 'done', at: 10 }] }, hbook3, 200);
	const idBefore = r3a.history[0].sessionId;
	/* a turn re-opens the code (the notification path's behaviour) */
	enumerateFrames([{ seq: 1, type: 'session/event', sessionId: 'aaa', event: { type: 'turn/start', time: 1, data: {} } }], hbook3);
	const r3b = enumerateHistory({ history: [{ sessionId: 'aaa', title: 'T1', kind: 'done', at: 10 }] }, hbook3, 200);
	ok(r3b.history[0].sessionId === idBefore, `pet/history: synthetic id STABLE across a turn re-open (${idBefore} vs ${r3b.history[0].sessionId})`);
	ok(r3b.history[0].sessionId !== 'session-pet-s' + hbook3.codes.get('aaa'), 'pet/history: stable code is distinct from the turn code');
	/* 11-06 跳转锚点兜底：endTime 缺失的记录用 at 顶上——每条历史行都带
	 * 有效时间锚（atMs），翻页定位不会退化成「只跳对话」 */
	const hbook4 = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
	const r4 = enumerateHistory({ history: [{ sessionId: 'ddd', title: 'T-noEnd', kind: 'question', at: 5000 }] }, hbook4, 200);
	ok(r4.history[0].endTime === 5000 && r4.history[0].at === 5000, 'pet/history: missing endTime falls back to at (jump anchor guaranteed)');
	/* cap + sort: input order irrelevant, newest wins, cap honored */
	const hbook2 = { codes: new Map(), rev: new Map(), turns: new Map(), next: 0 };
	const many = { history: Array.from({ length: 300 }, (_, i) => ({ sessionId: 's' + i, title: 't' + i, at: i })) };
	const r2 = enumerateHistory(many, hbook2, 200);
	ok(r2.history.length === 200, 'pet/history: cap 200 honored');
	ok(r2.history[0].title === 't299', 'pet/history: cap keeps the NEWEST records');
	ok(enumerateHistory(null, hbook2, 200).history.length === 0 && enumerateHistory(null, hbook2, 200).clearAt === null, 'pet/history: null doc -> empty safe shape');
}

rmSync(dir, { recursive: true, force: true });
console.log('ALL HOST-STORE TESTS PASSED (' + passed + ' checks)');

/* ---- 0.4.3 阶段A dismiss 收口归并（C-A6/C-A7 + 宿主半区 unhandled rejection 兜底）----
 * /pet/ctrl 的 dismiss 系处理器在 applyPet 闭包内，此前所有断言只覆盖纯函数
 * ——本块沿上方 P1-1 先例驱动 applyPet：假 webServer.register 捕获路由表 +
 * 假 deps.readJsonBody 直接投喂载荷 → dismiss 系动作为**行为断言可达**（无需
 * 降级为源码断言）。假 webServer 无 port → spawnPet 走「端口缺失」abortSpawn
 * 早退（无真实进程/窗口；dismiss 系动作零账本写入，loadStore 只读真实
 * ~/.dsh，与 P1-1 先例同风险面）。铸码走返回句柄的 enumerateForPet（与 SSE
 * 推帧前枚举完全同源），不碰 getFrames 环形缓冲。
 * 任务3 的「链尾 .catch 兜底」对象是源码形态、行为不可达 → 用源码字符串
 * 断言（在此声明）。 ---- */
{
	const passedBeforeBlock = passed;
	function countSub(hay, needle) { return hay.split(needle).length - 1; }
	function petReq(payload) {
		return { method: 'POST', headers: { host: '127.0.0.1:3099', 'content-type': 'application/json' }, socket: { localPort: 3099, remoteAddress: '127.0.0.1' }, __petBody: payload };
	}
	function petRes() {
		const res = { status: 0, body: '' };
		res.writeHead = function (code) { res.status = code; return res; };
		res.end = function (text) { res.body = String(text == null ? '' : text); return res; };
		return res;
	}

	const ctrlFrames = [];
	const capturedRoutes = Object.create(null);
	const petApi = applyPet(
		{ webServer: { register: (route) => { capturedRoutes[route.path] = route; return () => {}; } } },
		{
			pushFrame: (f) => ctrlFrames.push(f),
			isAllowed: () => true,
			/* 镜像 index.js readJsonBody 的 onBody(parsed) 契约（同步回调）；
			 * content-type/415 围栏不在此重现（16 节已测围栏，这里只驱动动作语义） */
			readJsonBody: (req, res, limit, cb) => cb(req.__petBody)
		}
	);
	const ctrlRoute = capturedRoutes['/api/whale-assistant/pet/ctrl'];
	ok(ctrlRoute && typeof ctrlRoute.handler === 'function', 'dismiss-closure: /pet/ctrl route captured from applyPet (route-driven harness live)');

	/* 铸码：同一真实会话两次开工（每任务一码，11-03 语义）+ 另一会话一次开工
	 * ——rev 反查索引拿到 1/2→session-dsh-real、3→session-dsh-other。旧 dismiss
	 * 只广播 codes 正查的最新码（2），同会话旧任务码（1）在桌宠永久滞留。 */
	[
		{ seq: 1, type: 'session/event', sessionId: 'session-dsh-real', event: { type: 'turn/start', time: 1, data: {} } },
		{ seq: 2, type: 'session/event', sessionId: 'session-dsh-real', event: { type: 'turn/end', time: 2, data: { reason: { kind: 'completed' } } } },
		{ seq: 3, type: 'session/event', sessionId: 'session-dsh-real', event: { type: 'turn/start', time: 3, data: {} } },
		{ seq: 4, type: 'session/event', sessionId: 'session-dsh-other', event: { type: 'turn/start', time: 4, data: {} } }
	].forEach((f) => petApi.enumerateForPet(f));

	/* C-A6：dismiss 一次 → 同会话全部任务码（旧 1 + 新 2）都广播，载荷形状不变 */
	ctrlFrames.length = 0;
	const rDismiss = petRes();
	ctrlRoute.handler(petReq({ action: 'dismiss', sessionId: 'session-dsh-real' }), rDismiss);
	const dFrames = ctrlFrames.filter((f) => f && f.type === 'pet/dismiss');
	ok(dFrames.length === 2 && dFrames.some((f) => f.code === 1) && dFrames.some((f) => f.code === 2), 'C-A6: dismiss once broadcasts pet/dismiss for BOTH codes of the session (old 1 + current 2)');
	ok(dFrames.every((f) => Object.keys(f).sort().join(',') === 'code,type'), 'C-A6: pet/dismiss payload shape unchanged (type+code only)');
	ok(rDismiss.status === 200 && rDismiss.body === '{"ok":true,"delivered":true}', 'C-A6: dismiss responds 200 {ok:true,delivered:true} (response shape unchanged)');

	/* 旧语义回归：未知会话零广播、delivered:false */
	ctrlFrames.length = 0;
	const rUnknown = petRes();
	ctrlRoute.handler(petReq({ action: 'dismiss', sessionId: 'session-never-coded' }), rUnknown);
	ok(ctrlFrames.length === 0 && rUnknown.status === 200 && rUnknown.body === '{"ok":true,"delivered":false}', 'C-A6: unknown session broadcasts nothing, delivered:false (old contract intact)');

	/* C-A7：dismiss-all → 码本全集（1/2/3，跨会话）逐个广播 pet/dismiss */
	ctrlFrames.length = 0;
	const rAll = petRes();
	ctrlRoute.handler(petReq({ action: 'dismiss-all' }), rAll);
	const allCodes = ctrlFrames.filter((f) => f && f.type === 'pet/dismiss').map((f) => f.code).sort((a, b) => a - b);
	ok(JSON.stringify(allCodes) === '[1,2,3]', 'C-A7: dismiss-all broadcasts pet/dismiss for EVERY outstanding code ([1,2,3])');
	ok(rAll.status === 200 && rAll.body === '{"ok":true,"delivered":true}', 'C-A7: dismiss-all responds 200 {ok:true,delivered:true}');

	/* 任务3（源码断言）：四条链尾都有外层 .catch——/pet/feed、clear-history、
	 * clear-pending、announceTitle；另两条既有链（writePetDoc form/sync）本就
	 * 带 .catch，不重复计。注释文案即链尾指纹：`).catch(() => { /* 外层兜底…`
	 * 只可能出现在链尾调用点。 */
	const petSrc = readFileSync(new URL('./whale-assistant/lib/pet.js', import.meta.url), 'utf8');
	ok(countSub(petSrc, ').catch(() => { /* 外层兜底防 unhandled rejection') === 4, 'catch-guard: all FOUR chain tails end with the outer .catch (feed/clear-history/clear-pending/announceTitle)');
	ok(countSub(petSrc, '外层兜底防 unhandled rejection 击穿宿主：双参 fail 只接源拒绝，ok/fail 回调内同步抛出仍会变成无人接的拒绝') === 1, 'catch-guard: /pet/feed chain tail guarded after its dual-arg fail branch (semantics preserved)');
	ok(countSub(petSrc, '击穿宿主：双参 fail 只接源拒绝，ok 回调内同步抛出仍无人接') === 2, 'catch-guard: clear-history + clear-pending chain tails guarded');
	ok(countSub(petSrc, '这条链原本完全没有失败分支') === 1, 'catch-guard: announceTitle chain (the only branch-less one) guarded');

	/* C-A7 页鲸半区（源码断言）：clearAllUnread 成功路径 relay POST dismiss-all，
	 * fire-and-forget 带 .catch 静默、门与 session-viewed relay 同款（!PET_MODE） */
	const bootSrc = readFileSync(new URL('./src/ui/bootstrap.js', import.meta.url), 'utf8');
	ok(countSub(bootSrc, "action: 'dismiss-all'") === 1, 'C-A7 relay: clearAllUnread posts {action:dismiss-all} to /pet/ctrl');
	const relayAt = bootSrc.indexOf("JSON.stringify({ action: 'dismiss-all' })");
	ok(relayAt !== -1 && bootSrc.slice(relayAt, relayAt + 220).includes('.catch(function'), 'C-A7 relay: dismiss-all POST is fire-and-forget with a silent .catch (local clear never rolls back)');
	ok(countSub(bootSrc, "!PET_MODE && typeof fetch === 'function'") === 2, 'C-A7 relay: same PET_MODE gate as the session-viewed relay (pet page never loops)');

	console.log('DISMISS-CLOSURE BLOCK PASSED (+' + (passed - passedBeforeBlock) + ' checks)');
}

/* =========================================================================
 * 0.4.3 阶段 B 追加块（任务1：桌宠页四类状态进 petDoc / 任务2：M5 可信度
 * 计数 / 任务3：queueStoreWrite 并发行为）——append-only 纪律：本块只允许
 * 出现在文件末尾，既有断言一律不改。
 * ========================================================================= */
{
	/* petExtrasBootScript 不在既有顶部 import 行里（append-only 纪律不可改它）
	 * ——顶层 await 动态 import 补齐（ESM 模块缓存：与静态 import 同一实例） */
	const { petExtrasBootScript } = await import('./whale-assistant/lib/pet.js');
	const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
	const cnt = (hay, needle) => hay.split(needle).length - 1;
	const petSrc = src('./whale-assistant/lib/pet.js');
	const passedBeforeB = passed;

	/* ---- 任务1·normalize 往返（四字段写入→petDoc→boot 快照回放一致）---- */
	{
		const rt = normalizePetDoc({ pet: { enabled: true, reminders: [{ id: 'rm-1', at: 123, text: '开会' }], soundMuted: true, petHintDate: '2026-11-20', petHintCount: 2, gearStats: { date: '2026-11-20', count: 7 } } });
		assert.deepStrictEqual(rt.reminders, [{ id: 'rm-1', at: 123, text: '开会' }], '阶段B: reminders roundtrip (id/at/text shape preserved)');
		ok(rt.soundMuted === true && rt.petHintDate === '2026-11-20' && rt.petHintCount === 2, '阶段B: soundMuted/petHintDate/petHintCount roundtrip');
		assert.deepStrictEqual(rt.gearStats, { date: '2026-11-20', count: 7 }, '阶段B: gearStats {date,count} roundtrip');
		/* sync 写侧出口同形状（normalizePetSyncPatch → writePetDoc 的载荷） */
		const patch = normalizePetSyncPatch({ reminders: [{ id: 'rm-2', at: 9, text: '站会' }], soundMuted: false, petHintDate: '2026-11-21', petHintCount: 1, gearStats: { date: '2026-11-21', count: 3 } });
		assert.deepStrictEqual(
			patch,
			{ reminders: [{ id: 'rm-2', at: 9, text: '站会' }], soundMuted: false, petHintDate: '2026-11-21', petHintCount: 1, gearStats: { date: '2026-11-21', count: 3 } },
			'阶段B: sync patch carries all five new fields verbatim'
		);
		/* 字段级合并语义不变：纯新字段的 patch 不带出老字段键 */
		assert.deepStrictEqual(normalizePetSyncPatch({ soundMuted: true }), { soundMuted: true }, '阶段B: patch carries ONLY the fields present (merge contract intact)');
		/* 账本没有新字段 → 返回形状与阶段 A 完全一致（不造键） */
		ok(!('reminders' in normalizePetDoc({ pet: { enabled: true } })) && !('soundMuted' in normalizePetDoc({ pet: { enabled: true } })) && !('gearStats' in normalizePetDoc({ pet: { enabled: true } })), '阶段B: absent ledger fields add NO keys (phase-A return shape unchanged)');
	}

	/* ---- 任务1·容量截断（reminders 第 21 条丢弃/超长 text 截断）---- */
	{
		const big = [];
		for (let i = 1; i <= 21; i++) big.push({ id: 'r' + i, at: i, text: 't' + i });
		const capPatch = normalizePetSyncPatch({ reminders: big });
		ok(capPatch && capPatch.reminders.length === 20 && capPatch.reminders[19].text === 't20', '阶段B: reminders capped at 20 (21st entry dropped)');
		ok(normalizePetSyncPatch({ reminders: [{ id: 'r', at: 1, text: 'x'.repeat(80) }] }).reminders[0].text.length === 50, '阶段B: reminder text clamped to 50 chars');
		const capDoc = normalizePetDoc({ pet: { reminders: big } });
		ok(capDoc.reminders.length === 20 && capDoc.reminders[19].text === 't20', '阶段B: read side enforces the same 20 cap');
		ok(normalizePetDoc({ pet: { reminders: [{ id: 'i'.repeat(100), at: 1, text: 'ok' }] } }).reminders[0].id.length === 64, '阶段B: reminder id clamped to 64 chars');
	}

	/* ---- 任务1·坏形状丢弃（坏值一律不炸、不造键）---- */
	{
		const junk = normalizePetDoc({ pet: { reminders: 'nope', soundMuted: 'yes', petHintDate: '2026-1-1', petHintCount: -2, gearStats: { date: 'bad', count: 'x' } } });
		ok(!('reminders' in junk) && !('soundMuted' in junk) && !('petHintDate' in junk) && !('petHintCount' in junk) && !('gearStats' in junk), '阶段B: bad-shape fields dropped entirely (no keys, boot never throws)');
		ok(normalizePetDoc({ pet: { reminders: [{ at: 1, text: 'ok' }, 'junk', { at: 'x', text: 'y' }, { at: 2, text: '' }] } }).reminders.length === 1, '阶段B: junk reminder items dropped individually (good item survives)');
		ok(normalizePetDoc({ pet: { reminders: [] } }).reminders.length === 0, '阶段B: empty array is a legit snapshot (cleared list persists)');
		ok(normalizePetDoc({ pet: { petHintCount: 1e9 } }).petHintCount === 999, '阶段B: petHintCount clamped to 999');
		ok(normalizePetDoc({ pet: { gearStats: { date: '2026-11-20', count: 1e12 } } }).gearStats.count === 9999999, '阶段B: gearStats count clamped to 9999999 (aff-style cap)');
		ok(normalizePetSyncPatch({ reminders: 'junk', soundMuted: 'junk', petHintDate: 'x', gearStats: 'junk' }) === null, '阶段B: patch with only-invalid new fields -> null (400)');
	}

	/* ---- 任务1·boot 快照回放（petExtrasBootScript：四键种入，幂等+信封同形）---- */
	{
		const bs = petExtrasBootScript({ reminders: [{ id: 'rm-9', at: 555, text: '</script>喝水' }], soundMuted: true, petHintDate: '2026-11-20', petHintCount: 2, gearStats: { date: '2026-11-20', count: 7 } });
		ok(bs.includes('"dsh-whale:reminders"') && bs.includes('"dsh-whale:sound"') && bs.includes('"dsh-whale:petHint"') && bs.includes('"dsh-whale:stats"'), '阶段B: boot extras script seeds all four new keys');
		ok(bs.includes('localStorage.getItem(e[i][0])===null'), '阶段B: every seed is gated on the key being absent (idempotent, origin-survival safe)');
		ok(!bs.includes('</script>') && bs.includes('\\u003c'), '阶段B: < in reminder text escaped (script-breakout impossible)');
		/* 回放一致：信封里的值 JSON 解析后与写入形状逐字节同构（reminders/
		 * petHint 裸 JSON=页侧直读写；sound/stats 走 {v:1,data} 信封=safeGet 读侧） */
		const seedMatch = bs.match(/var e=(\[.*?\]);for\(var i=0/);
		ok(!!seedMatch, '阶段B: seed envelope extractable');
		const seeds = JSON.parse(seedMatch[1]);
		ok(seeds.length === 4, '阶段B: four seed pairs');
		assert.deepStrictEqual(JSON.parse(seeds[0][1]), [{ id: 'rm-9', at: 555, text: '</script>喝水' }], '阶段B: reminders seed replays the exact drawer shape (raw JSON)');
		assert.deepStrictEqual(JSON.parse(seeds[1][1]), { v: 1, data: 'off' }, '阶段B: sound seed uses the safeSet v1 envelope (dings read side)');
		assert.deepStrictEqual(JSON.parse(seeds[2][1]), { day: '2026-11-20', n: 2 }, '阶段B: petHint seed uses the savePetHint raw shape {day,n}');
		assert.deepStrictEqual(JSON.parse(seeds[3][1]), { v: 1, data: { tasksDone: 7, date: '2026-11-20' } }, '阶段B: stats seed uses the safeSet envelope with {tasksDone,date}');
		/* 容量：种入侧同款 cap */
		const capSeeds = JSON.parse(petExtrasBootScript({ reminders: (function () { const a = []; for (let i = 1; i <= 21; i++) a.push({ at: i, text: 't' + i }); return a; })() }).match(/var e=(\[.*?\]);for\(var i=0/)[1]);
		ok(JSON.parse(capSeeds[0][1]).length === 20, '阶段B: boot seed enforces the 20-item cap');
		/* 全空/坏形状 → 注释占位（脚本不发、零行为） */
		ok(petExtrasBootScript(null).includes('pet boot extras: none') && petExtrasBootScript({}).includes('pet boot extras: none') && petExtrasBootScript('junk').includes('pet boot extras: none'), '阶段B: empty/junk extras -> inert placeholder');
		const bad = petExtrasBootScript({ reminders: 'nope', soundMuted: 'yes', petHintDate: 'x', gearStats: { date: 'x' } });
		ok(bad.includes('pet boot extras: none'), '阶段B: bad-shape extras -> inert placeholder');
		/* 局部有效：只有 soundMuted → 只种一键 */
		const only = petExtrasBootScript({ soundMuted: false });
		ok(only.includes('"dsh-whale:sound"') && !only.includes('"dsh-whale:reminders"'), '阶段B: partial extras seed only the valid keys');
		/* 双侧契约：/pet/page 把新老两段种入脚本拼进同一标记 */
		ok(petSrc.includes("replace('__DSH_PET_BOOT__'") && petSrc.includes('petBootStateScript(petAff, petAffMs, petPos) + petExtrasBootScript(petExtras)'), '阶段B: /pet/page substitutes the marker with old+extras boot scripts (3-arg call text intact)');
	}

	/* ---- 任务1·宿主路由接线（sync 处理器在 applyPet 闭包内、驱动会写真账本
	 * ——沿既有先例做源码断言）---- */
	{
		ok(petSrc.includes("error: 'aff|affMs|pos|reminders|soundMuted|petHint required'"), '阶段B: sync 400 message covers the new fields');
		ok(petSrc.includes('if (patch.reminders !== undefined) petExtras.reminders = patch.reminders;') && petSrc.includes("if (typeof patch.soundMuted === 'boolean') petExtras.soundMuted = patch.soundMuted;"), '阶段B: sync action updates the extras mirror before the disk write');
		ok(petSrc.includes('const remPatch = saneReminders(patch.reminders);') && petSrc.includes('const gsPatch = saneGearStats(patch.gearStats);'), '阶段B: writePetDoc re-runs the sane* guards (defense in depth)');
		ok(petSrc.includes('reminders: petExtras ? petExtras.reminders : null,') && petSrc.includes('gearStats: petExtras ? petExtras.gearStats : null'), '阶段B: /pet/state serves the five extras fields (poll down-link)');
		ok(petSrc.includes('reminders: Array.isArray(boot.reminders) ? boot.reminders : null,'), '阶段B: boot restores the extras mirror from petDoc');
	}

	/* ---- 任务1·页鲸半区接线（源码断言：写侧+采用侧+转发）---- */
	{
		const drawersSrc = src('./src/ui/drawers.js');
		const dingsSrc = src('./src/core/dings.js');
		const moodSrc = src('./src/core/mood.js');
		const gearSrc = src('./src/core/gear.js');
		const pageSrc = src('./whale-assistant/pet/page.html');
		ok(drawersSrc.includes('if (PET_MODE) pushPetSync({ reminders: list.slice(0, 20) });'), '阶段B: saveReminders pushes the list to petDoc in PET_MODE (write side)');
		ok(drawersSrc.includes('function petSyncExtrasFromHost(extras)') && drawersSrc.includes('window.__dshWhale.petSyncExtrasFromHost = petSyncExtrasFromHost'), '阶段B: adopt seam defined + attached in drawers.js (drag.js _petSyncPos precedent)');
		ok(drawersSrc.includes("localStorage.getItem('dsh-whale:reminders') === null) saveReminders(extras.reminders)") && drawersSrc.includes("localStorage.getItem(SOUND_KEY) === null) setSoundMuted(extras.soundMuted, true)"), '阶段B: adopt is gated on the local key being absent (idempotent, no echo revival)');
		ok(dingsSrc.includes('function setSoundMuted(muted, fromRelay)') && dingsSrc.includes('else if (!fromRelay) pushPetSync({ soundMuted: soundMuted });'), '阶段B: setSoundMuted writes back to petDoc in PET_MODE, relay-driven applies skip (fromRelay flag)');
		ok(dingsSrc.includes('if (!PET_MODE) pushPetConfig();') && cnt(dingsSrc, 'pushPetConfig()') === 1, '阶段B: page-side relay push unchanged (!PET_MODE leg intact, exactly one call site)');
		ok(moodSrc.includes('pushPetSync({ petHintDate: petHintDay, petHintCount: petHintCount })') && moodSrc.includes('function adoptPetHintFromHost(day, n)'), '阶段B: petHint persists date+count pair, adopt fn exists (date alone would lose the cap count)');
		ok(moodSrc.includes('day !== todayKey()) return;'), '阶段B: petHint adopt only takes TODAY snapshot (stale dates worthless for a daily cap)');
		ok(gearSrc.includes('pushPetSync({ gearStats: { date: todayKey(), count: gearStats.tasksDone } })') && gearSrc.includes('function adoptGearStatsFromHost(date, count)'), '阶段B: gearStats persists {date,count}, adopt fn exists');
		ok(gearSrc.includes("date === todayKey() && typeof count === 'number'"), '阶段B: gearStats adopt zeroes stale-day snapshots (loadGearStats expiry rule mirrored)');
		ok(pageSrc.includes('window.__dshWhale.petSyncExtrasFromHost({') && cnt(pageSrc, "setSoundMuted(doc.petConfig.sound === 'off', true)") === 1 && cnt(pageSrc, "setSoundMuted(pc0.sound === 'off', true)") === 1, '阶段B: page.html forwards extras to the adopt seam + both relay applies pass fromRelay=true');
		ok(cnt(pageSrc, 'setSoundMuted(') === 2, '阶段B: page.html has exactly two soundMuted apply sites (poll + tail fallback), both flagged');
	}

	/* ---- 任务2·M5 通知链路可信度计数（源码断言：键名/封顶/自增助手）---- */
	{
		const healthSrc = src('./src/core/health.js');
		const seSrc = src('./src/core/server-events.js');
		const m5All = healthSrc + seSrc;
		ok(healthSrc.includes("var M5_KEY = 'dsh-whale:m5';"), 'M5: localStorage key dsh-whale:m5 declared once (page side, not the host ledger)');
		ok(cnt(m5All, "'dsh-whale:m5'") === 1, 'M5: the key literal appears exactly once (single helper, no per-site localStorage logic)');
		ok(healthSrc.includes('var M5_KINDS = { healthFail: 1, sseCircuit: 1, sseProbeOk: 1 };'), 'M5: the three counters are whitelisted (unknown kinds never create keys)');
		ok(healthSrc.includes('Math.min(9999, Math.floor(raw[k]))') && healthSrc.includes('Math.min(9999, cur[kind] + 1)'), 'M5: counters clamp read+write at 9999 (overflow-proof, JSON size bounded)');
		ok(cnt(m5All, 'function m5Count(kind)') === 1, 'M5: exactly ONE increment helper (three call sites share it)');
		ok(cnt(m5All, "m5Count('") === 3 && cnt(healthSrc, "m5Count('healthFail')") === 1 && cnt(seSrc, "m5Count('sseCircuit')") === 1 && cnt(seSrc, "m5Count('sseProbeOk')") === 1, 'M5: three call sites — healthFail in health.js, sseCircuit+sseProbeOk in server-events.js');
		/* 熔断计数挂阶段 A 的熔断分支同处，探活机逻辑零改动 */
		ok(seSrc.includes("console.debug('[dsh-whale] sse breaker open after 3 fails: probing every 60s');") && seSrc.indexOf("m5Count('sseCircuit')") > seSrc.indexOf('sse breaker open after 3 fails'), 'M5: sseCircuit rides the phase-A breaker branch (same spot, no probe-machine logic touched)');
		ok(cnt(healthSrc, 'localStorage.setItem(M5_KEY') === 1 && cnt(healthSrc, 'localStorage.getItem(M5_KEY') === 1, 'M5: the helper owns the single read+write pair');
	}

	console.log('PHASE-B PETDOC+M5 BLOCK PASSED (+' + (passed - passedBeforeB) + ' checks)');
}

/* ---- 任务3：queueStoreWrite 并发行为（撞债条款，零生产行为变化）----
 * whale-assistant/lib/store.js 的串行化语义此前零测试裸奔：
 * ① mutator 先 throw → 调用方收到 rejection、后续 mutator 仍按序执行、
 *   写链不复位（下一个写者不继承拒绝）；
 * ② 顺序保证：并发两个写，落盘顺序=入队顺序（整文件 rename=最后者胜）；
 * ③ readJsonBody 分支（415/413/400）——实测 lib/index.js 只导出
 *   apply/inject/isTrustedRequest，readJsonBody 不可 import 直驱（「若可达
 *   也补」判定=不可达；index.js 禁改不可加导出）→ 源码断言逐行核对分支。
 * 既有 import 行不可改（append-only），故走顶层 await 动态 import。 */
{
	const passedBeforeQ = passed;
	const { queueStoreWrite } = await import('./whale-assistant/lib/store.js');
	const qdir = mkdtempSync(join(tmpdir(), 'whale-queue-test-'));

	/* ① rejection 传播 + 链不复位 */
	const boom = queueStoreWrite(qdir, () => { throw new Error('boom'); });
	await assert.rejects(boom, /boom/, 'queue: mutator rejection reaches the CALLER');
	let ranAfter = false;
	const afterThrow = await queueStoreWrite(qdir, () => { ranAfter = true; saveStoreAtomic(qdir, { clearAt: 0, history: [{ sessionId: 'after-throw', at: 1, kind: 'done', title: 't' }] }); return 'survived'; });
	ok(ranAfter && afterThrow === 'survived', 'queue: the NEXT mutator still runs after a throw (chain does not inherit the rejection)');
	ok(loadStore(qdir).history[0].sessionId === 'after-throw', 'queue: post-throw write landed on disk');

	/* ② 顺序保证：两个并发写，落盘顺序=入队顺序 */
	const order = [];
	const w1 = queueStoreWrite(qdir, () => { order.push('first'); saveStoreAtomic(qdir, { clearAt: 0, history: [{ sessionId: 'w1', at: 1, kind: 'done' }] }); });
	const w2 = queueStoreWrite(qdir, () => { order.push('second'); saveStoreAtomic(qdir, { clearAt: 0, history: [{ sessionId: 'w2', at: 2, kind: 'done' }] }); });
	await w1; await w2;
	ok(order.join(',') === 'first,second', 'queue: concurrent writes serialize in ENQUEUE order (whole-file RMW never interleaves)');
	ok(loadStore(qdir).history[0].sessionId === 'w2', 'queue: last enqueued write wins on disk (atomic rename semantics)');
	/* 抛错后的链仍保序：throw → next → next（三连拍） */
	const seq = [];
	await assert.rejects(queueStoreWrite(qdir, () => { seq.push('a'); throw new Error('x'); }), /x/, 'queue: throw mid-sequence rejects its own caller');
	await queueStoreWrite(qdir, () => { seq.push('b'); return 1; });
	await queueStoreWrite(qdir, () => { seq.push('c'); return 2; });
	ok(seq.join(',') === 'a,b,c', 'queue: enqueue order survives a mid-sequence throw');

	/* ③ readJsonBody 分支（源码断言）：实测发现 lib/index.js 只导出
	 * apply/inject/isTrustedRequest——readJsonBody 不可经 import 直驱
	 * （「若可达也补」的可达性判定=不可达），且 index.js 禁改不可加导出。
	 * 故对 index.js 的分支文本做源码断言（415/413/400 三分支+读错分支+
	 * done 闸），函数体逐行核对。 */
	{
		const srcL = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
		const cntL = (hay, needle) => hay.split(needle).length - 1;
		const libSrc = srcL('./whale-assistant/lib/index.js');
		ok(libSrc.includes("if (!/application\\/json/i.test(ct)) {") && libSrc.includes('res.writeHead(415, { \'cache-control\': \'no-store\' });') && libSrc.includes('\'{"ok":false,"error":"content-type"}\''), 'readJsonBody: 415 branch — content-type fence kills the text/plain CSRF simple-request path');
		ok(libSrc.includes('res.writeHead(413, { \'cache-control\': \'no-store\' });') && libSrc.includes('\'{"ok":false,"error":"body-too-large"}\'') && libSrc.includes('req.destroy();'), 'readJsonBody: 413 branch — over-limit answers then destroys the socket');
		ok(libSrc.includes('if (done) return;') && cntL(libSrc, 'done = true;') >= 2, 'readJsonBody: done gate — 413/parse/read-error paths never double-answer (end after 413 is silent)');
		ok(libSrc.includes('res.writeHead(400, { \'cache-control\': \'no-store\' });') && libSrc.includes("'{"+'"ok":false,"error":\' + JSON.stringify(String(err && err.message || err))'), 'readJsonBody: 400 default onError — parse failures answered with the message');
		ok(libSrc.includes('\'{"ok":false,"error":"read-error"}\''), 'readJsonBody: transport error branch — 400 read-error instead of hanging the client');
		ok(libSrc.includes('onBody(JSON.parse(raw), raw);'), 'readJsonBody: success path hands parsed JSON + raw text to onBody');
	}

	ok(typeof queueStoreWrite === 'function', 'task3: queueStoreWrite live (dynamic import resolved)');

	console.log('QUEUE+READBODY BLOCK PASSED (+' + (passed - passedBeforeQ) + ' checks)');
}
console.log('ALL HOST-STORE TESTS PASSED (' + passed + ' checks, phase-B blocks included)');

/* =========================================================================
 * 0.4.3 阶段 C 追加块（账本/性能半区：petLedger 互动账本 / 日备 rotating /
 * whale.js 路由 ETag 条件 GET）——append-only 纪律：本块只允许出现在文件
 * 末尾。既有断言的两处豁免修改（mH1 六键夹具 + 「still exactly one file」
 * 备份排除）已在原位显著标注，本块不再改任何既有行。
 * 路由驱动沿阶段 A 先例：applyPet + 假 webServer.register 捕获路由表 +
 * 假 deps（ledgerDir 指向临时目录——写路径永不碰真实 ~/.dsh 账本；假
 * webServer 无 port → spawnPet 走端口缺失 abortSpawn 早退，无真实进程）。
 * lib/index.js 的 /state 与 /whale.js 处理器落在 apply() 闭包内不可直驱
 * （阶段 B 既有判定）→ 源码断言；/pet/whale.js 走行为断言（同一 ETag 代码
 * 形状的可达实证）。串行写链等待用 queueStoreWrite 排空技巧：同链 no-op
 * mutator 跑到时，此前入队的账本写必然已落盘（阶段 B 已证链保序）。
 * ========================================================================= */
{
	const passedBeforeC = passed;
	const { existsSync } = await import('node:fs');
	const { normalizePetLedger, ledgerAppend, queueStoreWrite } = await import('./whale-assistant/lib/store.js');
	const { petScriptEtag, etagMatches } = await import('./whale-assistant/lib/pet.js');
	const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
	const cnt = (hay, needle) => hay.split(needle).length - 1;
	const storeSrc = src('./whale-assistant/lib/store.js');
	const petSrc = src('./whale-assistant/lib/pet.js');
	const libSrc = src('./whale-assistant/lib/index.js');
	const expSrc = src('./src/core/exports.js');
	const pageSrc = src('./whale-assistant/pet/page.html');

	/* 日期助手：账本 date 口径=本地日 'YYYY-MM-DD'（store.js petLedgerToday
	 * 同款拼法）；天数差运算走 UTC 日界（petLedgerDayMs 同款），两侧一致
	 * 免 DST 抖动。n=相对今天的天数偏移（负=过去）。 */
	function fmtLocal(d) {
		const m = d.getMonth() + 1, dd = d.getDate();
		return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
	}
	const nowD = new Date();
	const todayStr = fmtLocal(nowD);
	const todayUtcMs = Date.UTC(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
	const dayStr = (n) => new Date(todayUtcMs + n * 86400000).toISOString().slice(0, 10);

	/* ---- C1. normalizePetLedger：契约形状逐字对照（升序/钳顶/坏形状丢弃/
	 * 同日去重取后=取新）---- */
	{
		ok(normalizePetLedger(undefined).days.length === 0 && normalizePetLedger(null).days.length === 0 && normalizePetLedger('junk').days.length === 0 && normalizePetLedger({ days: 'nope' }).days.length === 0, 'petLedger: absent/junk key falls back to {days:[]} (never throws)');
		/* 形状逐字对照契约：{"days":[{"date":"YYYY-MM-DD","pets":12,"wakes":22}]}
		 * ——date 升序、单日 pets/wakes 各钳 9999、坏条目（非法日历日/垃圾/
		 * 计数脏值）单丢、缺计数补 0 */
		const n1 = normalizePetLedger({ days: [
			{ date: dayStr(-2), pets: 5.9, wakes: -3 },
			'junk', null, 42,
			{ date: '2026-02-31', pets: 1, wakes: 1 }, /* 2 月无 31 日 */
			{ date: '2026-13-01', pets: 1, wakes: 1 }, /* 月越界 */
			{ date: '2026-1-1', pets: 1, wakes: 1 },   /* 形状不合规 */
			{ date: dayStr(-3), pets: 10001, wakes: 2 },
			{ date: dayStr(-1), wakes: 4 }             /* pets 缺失 → 0 */
		] });
		assert.deepStrictEqual(
			n1.days,
			[
				{ date: dayStr(-3), pets: 9999, wakes: 2 },
				{ date: dayStr(-2), pets: 5, wakes: 0 },
				{ date: dayStr(-1), pets: 0, wakes: 4 }
			],
			'petLedger: days sorted ascending, counters clamped/floored, junk entries dropped individually (contract shape verbatim)'
		);
		/* 同日重复取后者（mergeHistory「按 date 去重取新」的单键版本） */
		const n2 = normalizePetLedger({ days: [{ date: dayStr(-1), pets: 1, wakes: 0 }, { date: dayStr(-1), pets: 5, wakes: 6 }] });
		assert.deepStrictEqual(n2.days, [{ date: dayStr(-1), pets: 5, wakes: 6 }], 'petLedger: duplicate dates keep the LAST entry (incoming-wins single-key form)');
		/* 90 天滚动：今天-100 的日剔除、今天保留（显式 now 注入=确定性） */
		const n3 = normalizePetLedger({ days: [{ date: dayStr(-100), pets: 1, wakes: 1 }, { date: dayStr(-90), pets: 2, wakes: 2 }, { date: todayStr, pets: 3, wakes: 3 }] }, Date.now());
		assert.deepStrictEqual(n3.days, [{ date: todayStr, pets: 3, wakes: 3 }], 'petLedger: 90-day rolling — days older than today-89 are dropped');
		/* 截尾兜底：120 个未来日（年龄过滤拦不住）也不破 ≤90 条上限 */
		const futureDays = [];
		for (let i = 1; i <= 120; i++) futureDays.push({ date: dayStr(i), pets: 1, wakes: 0 });
		ok(normalizePetLedger({ days: futureDays }).days.length === 90, 'petLedger: count cap — even a flood of future dates stays at 90 entries (tail kept = newest)');
	}

	/* ---- C2. mergeHistory petLedger 日级合并（新 days 并集、同日取新、垃圾
	 * incoming 不抹存量、双侧缺席不造键）---- */
	{
		const mu = mergeHistory(
			{ clearAt: 0, history: [], petLedger: { days: [{ date: dayStr(-3), pets: 1, wakes: 0 }, { date: dayStr(-2), pets: 2, wakes: 2 }] } },
			{ clearAt: 0, history: [], petLedger: { days: [{ date: dayStr(-2), pets: 9, wakes: 9 }, { date: dayStr(-1), pets: 0, wakes: 1 }] } }
		);
		assert.deepStrictEqual(
			mu.petLedger.days,
			[
				{ date: dayStr(-3), pets: 1, wakes: 0 },
				{ date: dayStr(-2), pets: 9, wakes: 9 },
				{ date: dayStr(-1), pets: 0, wakes: 1 }
			],
			'petLedger merge: day union by date, SAME-DAY entries take the INCOMING one (取新), result ascending'
		);
		const mj = mergeHistory(
			{ clearAt: 0, history: [], petLedger: { days: [{ date: dayStr(-1), pets: 7, wakes: 7 }] } },
			{ clearAt: 0, history: [], petLedger: 'hand-edited junk' }
		);
		assert.deepStrictEqual(mj.petLedger.days, [{ date: dayStr(-1), pets: 7, wakes: 7 }], 'petLedger merge: junk incoming CANNOT wipe the stored days (retention philosophy)');
		const mn = mergeHistory({ clearAt: 0, history: [] }, { clearAt: 0, history: [] });
		ok(!('petLedger' in mn), 'petLedger merge: no key fabricated when NEITHER side has it (old merge output shapes unchanged)');
		ok(storeSrc.includes("const HOST_LEDGER_KEYS = ['pet', 'petConfig', 'pendingJump', 'pendingSettings', '_debug', 'petLedger'];"), 'petLedger: HOST_LEDGER_KEYS pins the 6-key contract (retention set verbatim)');
	}

	/* ---- C3. ledgerAppend 往返 + 单日钳顶 + 90 天滚动（临时目录，不碰真实
	 * ~/.dsh）---- */
	{
		const ldir = mkdtempSync(join(tmpdir(), 'whale-ledger-test-'));
		await ledgerAppend(ldir, 'pet');
		await ledgerAppend(ldir, 'pet');
		await ledgerAppend(ldir, 'wake');
		const led = loadStore(ldir).petLedger;
		ok(led.days.length === 1 && led.days[0].date === todayStr && led.days[0].pets === 2 && led.days[0].wakes === 1, 'ledgerAppend: same-day entries increment in place, new kinds extend the SAME day entry');
		await assert.rejects(ledgerAppend(ldir, 'hug'), /kind must be/, 'ledgerAppend: non-whitelisted kind rejected before it reaches the write chain');
		/* 单日钳顶：今天 pets 已 9999 → 再摸也不涨 */
		saveStoreAtomic(ldir, { clearAt: 0, history: [], petLedger: { days: [{ date: todayStr, pets: 9999, wakes: 0 }] } });
		await ledgerAppend(ldir, 'pet');
		const capped = loadStore(ldir).petLedger;
		ok(capped.days[0].pets === 9999 && capped.days[0].wakes === 0, 'ledgerAppend: single-day cap holds at 9999 (write-time gate)');
		/* 90 天滚动：95 个历史日 + 今日入账 → 恰好 90 条、最老日被挤掉 */
		const rdir = mkdtempSync(join(tmpdir(), 'whale-ledger-roll-'));
		const oldDays = [];
		for (let i = 95; i >= 1; i--) oldDays.push({ date: dayStr(-i), pets: 1, wakes: 1 });
		saveStoreAtomic(rdir, { clearAt: 0, history: [], petLedger: { days: oldDays } });
		await ledgerAppend(rdir, 'pet');
		const rolled = loadStore(rdir).petLedger;
		ok(rolled.days.length === 90, 'ledgerAppend: 90-day rolling — day count capped at 90 after append');
		ok(rolled.days[0].date === dayStr(-89) && rolled.days[89].date === todayStr, 'ledgerAppend: window slides — oldest day (today-95..-90) dropped, today appended last');
	}

	/* ---- C4. 互动入账通道 A：/pet/ctrl sync 的 interact 字段（宿主识别 →
	 * ledgerAppend）。桌宠页摸头/唤起经既有 pushPetSync 通道顺带上行。 ---- */
	{
		const sdir = mkdtempSync(join(tmpdir(), 'whale-interact-test-'));
		const routes2 = Object.create(null);
		applyPet(
			{ webServer: { register: (route) => { routes2[route.path] = route; return () => {}; } } },
			{
				pushFrame: () => {},
				isAllowed: () => true,
				readJsonBody: (req, res, limit, cb) => cb(req.__petBody),
				ledgerDir: () => sdir
			}
		);
		const ctrl2 = routes2['/api/whale-assistant/pet/ctrl'];
		ok(ctrl2 && typeof ctrl2.handler === 'function', 'interact: /pet/ctrl route captured (second applyPet harness live)');
		const petReq2 = (payload) => ({ method: 'POST', headers: { host: '127.0.0.1:3099', 'content-type': 'application/json' }, socket: { localPort: 3099, remoteAddress: '127.0.0.1' }, __petBody: payload });
		const petRes2 = () => {
			const res = { status: 0, body: '', headers: {} };
			res.writeHead = function (code, hdrs) { res.status = code; res.headers = hdrs || {}; return res; };
			res.end = function (text) { res.body = String(text == null ? '' : text); return res; };
			return res;
		};
		const rSync = petRes2();
		ctrl2.handler(petReq2({ action: 'sync', interact: 'pet' }), rSync);
		await queueStoreWrite(sdir, () => {});
		ok(rSync.status === 200 && rSync.body === '{"ok":true}', 'interact channel A: sync carrying ONLY {interact:pet} answers 200 (no petDoc fields needed)');
		const sDoc = loadStore(sdir);
		ok(sDoc.petLedger && sDoc.petLedger.days.length === 1 && sDoc.petLedger.days[0].pets === 1 && sDoc.petLedger.days[0].wakes === 0, 'interact channel A: interact=pet lands in petLedger (pets+1)');
		ok(!('pet' in sDoc), 'interact channel A: interact is an EVENT — petDoc itself untouched (writePetDoc skipped for interaction-only sync)');
		const rSyncW = petRes2();
		ctrl2.handler(petReq2({ action: 'sync', interact: 'wake' }), rSyncW);
		await queueStoreWrite(sdir, () => {});
		const sDoc2 = loadStore(sdir);
		ok(sDoc2.petLedger.days[0].wakes === 1, 'interact channel A: interact=wake ledgered (wakes+1, same day entry)');
		const rSyncBad = petRes2();
		ctrl2.handler(petReq2({ action: 'sync', interact: 'hug' }), rSyncBad);
		ok(rSyncBad.status === 400, 'interact channel A: non-whitelisted interact -> 400 (payload gate, ledger untouched)');
		const rSyncNone = petRes2();
		ctrl2.handler(petReq2({ action: 'sync' }), rSyncNone);
		ok(rSyncNone.status === 400 && rSyncNone.body.includes('aff|affMs|pos|reminders|soundMuted|petHint required'), 'interact channel A: sync with neither patch nor interact -> 400 with the UNCHANGED message (phase-B pin intact)');
	}

	/* ---- C5. 互动入账通道 B：/pet/ctrl {action:ledger, kind}（页鲸专用新通
	 * 道，C-A8 双账本收口）+ 两通道同账（同一份 petLedger 当日条目）---- */
	{
		const sdir = mkdtempSync(join(tmpdir(), 'whale-ledger-act-'));
		const routes3 = Object.create(null);
		applyPet(
			{ webServer: { register: (route) => { routes3[route.path] = route; return () => {}; } } },
			{
				pushFrame: () => {},
				isAllowed: () => true,
				readJsonBody: (req, res, limit, cb) => cb(req.__petBody),
				ledgerDir: () => sdir
			}
		);
		const ctrl3 = routes3['/api/whale-assistant/pet/ctrl'];
		const petReq3 = (payload) => ({ method: 'POST', headers: { host: '127.0.0.1:3099', 'content-type': 'application/json' }, socket: { localPort: 3099, remoteAddress: '127.0.0.1' }, __petBody: payload });
		const petRes3 = () => {
			const res = { status: 0, body: '' };
			res.writeHead = function (code) { res.status = code; return res; };
			res.end = function (text) { res.body = String(text == null ? '' : text); return res; };
			return res;
		};
		/* 通道 A 先摸一头（同一天），通道 B 再唤起一次——两通道汇入同一份
		 * 账本的同一条目=双账本收口的实证 */
		const rA = petRes3();
		ctrl3.handler(petReq3({ action: 'sync', interact: 'pet' }), rA);
		await queueStoreWrite(sdir, () => {});
		const rB = petRes3();
		ctrl3.handler(petReq3({ action: 'ledger', kind: 'wake' }), rB);
		await queueStoreWrite(sdir, () => {});
		ok(rB.status === 200 && rB.body === '{"ok":true}', 'ledger action: {action:ledger,kind:wake} answers 200 after the write chain lands (deterministic ok/fail)');
		const aDoc = loadStore(sdir);
		ok(aDoc.petLedger.days[0].pets === 1 && aDoc.petLedger.days[0].wakes === 1, 'ledger action: channel A (sync interact) + channel B (ledger kind) converge on the SAME day entry (C-A8 dual-ledger closure)');
		const rBad = petRes3();
		ctrl3.handler(petReq3({ action: 'ledger', kind: 'hug' }), rBad);
		ok(rBad.status === 400 && rBad.body.includes("kind must be"), 'ledger action: non-whitelisted kind -> 400');
		const rNoKind = petRes3();
		ctrl3.handler(petReq3({ action: 'ledger' }), rNoKind);
		ok(rNoKind.status === 400, 'ledger action: missing kind -> 400');
		/* 无 ledgerDir 环境（deps 未提供）→ 500 ledger unavailable，绝不写
		 * 真实 ~/.dsh（与 clear-history 的守卫同款） */
		const routes4 = Object.create(null);
		applyPet(
			{ webServer: { register: (route) => { routes4[route.path] = route; return () => {}; } } },
			{ pushFrame: () => {}, isAllowed: () => true, readJsonBody: (req, res, limit, cb) => cb(req.__petBody) }
		);
		const rNoDir = petRes3();
		routes4['/api/whale-assistant/pet/ctrl'].handler(petReq3({ action: 'ledger', kind: 'pet' }), rNoDir);
		ok(rNoDir.status === 500 && rNoDir.body.includes('ledger unavailable'), 'ledger action: absent ledgerDir -> 500, real ~/.dsh never written');
	}

	/* ---- C6. 日备 rotating（G-3）：写前复制上一份完整版本 → 单槽覆盖 ---- */
	{
		const bdir = mkdtempSync(join(tmpdir(), 'whale-backup-test-'));
		const backupAt = join(bdir, 'whale-assistant.json.backup-1');
		saveStoreAtomic(bdir, { clearAt: 0, history: [{ sessionId: 'v1', at: 1 }] });
		ok(!existsSync(backupAt), 'backup: FIRST save creates no backup (no previous version to preserve)');
		saveStoreAtomic(bdir, { clearAt: 0, history: [{ sessionId: 'v2', at: 2 }] });
		ok(existsSync(backupAt), 'backup: second save rotates the previous version into .backup-1');
		ok(JSON.parse(readFileSync(backupAt, 'utf8')).history[0].sessionId === 'v1', 'backup: holds the PREVIOUS complete version (v1, copied BEFORE the new write)');
		saveStoreAtomic(bdir, { clearAt: 0, history: [{ sessionId: 'v3', at: 3 }] });
		ok(JSON.parse(readFileSync(backupAt, 'utf8')).history[0].sessionId === 'v2', 'backup: single slot OVERWRITES (v2 replaced v1, exactly one generation kept)');
		ok(readdirSync(bdir).length === 2, 'backup: disk footprint stays at ledger + one backup (unbounded-growth proof)');
	}

	/* ---- C7. whale.js 路由 ETag 条件 GET（D-A1）：304/200 双分支。两条
	 * whale.js 路由的处理器都不可直驱（index.js 闭包=阶段 B 既有判定；
	 * pet 路由额外有 token 闸——tokenHex 只在 spawn 时铸、harness 永远
	 * 403），故指纹/匹配判定抽成 petScriptEtag/etagMatches 纯函数做行为
	 * 断言，路由接线由源码断言钉住（writeHead(304) 分支 + no-cache 双带 +
	 * 纯函数调用点）。 ---- */
	{
		const whaleCode = readFileSync(new URL('./whale-assistant/lib/whale.js', import.meta.url), 'utf8');
		const etag1 = petScriptEtag(whaleCode);
		ok(/^W\/"[0-9a-f]{16}-\d+"$/.test(etag1), 'ETag: weak validator W/"sha1-16hex-bytelength" shape');
		ok(etag1 === 'W/"' + (await import('node:crypto')).createHash('sha1').update(whaleCode).digest('hex').slice(0, 16) + '-' + Buffer.byteLength(whaleCode) + '"', 'ETag: value is the content fingerprint of the served bytes (length + sha1 head)');
		const other = petScriptEtag(whaleCode + '\n/* build bumped */');
		ok(other !== etag1, 'ETag: any content change produces a different validator (revalidation never serves a stale build)');
		/* 304/200 双分支判定：匹配（精确/通配/多值列表）→ 304；不匹配/缺席 → 200 全量 */
		ok(etagMatches(etag1, etag1), 'ETag 304 branch: exact If-None-Match match');
		ok(etagMatches('*', etag1) && etagMatches('  *  ', etag1), 'ETag 304 branch: * wildcard matches (raw and padded forms)');
		ok(etagMatches('W/"aaa-1", ' + etag1 + ', W/"bbb-2"', etag1), 'ETag 304 branch: multi-value If-None-Match list hits');
		ok(!etagMatches('W/"deadbeefdeadbeef-1"', etag1), 'ETag 200 branch: non-matching validator answers full body again (updated file always pulled)');
		ok(!etagMatches(undefined, etag1) && !etagMatches('', etag1), 'ETag 200 branch: absent/empty If-None-Match -> full 200');
		/* 路由接线（源码断言，两侧同款形状） */
		ok(cnt(petSrc, 'const etag = petScriptEtag(code);') === 1 && cnt(libSrc, 'const etag = petScriptEtag(code);') === 1, 'ETag: BOTH whale.js routes compute the validator from the served bytes');
		ok(cnt(petSrc, "res.writeHead(304, { etag: etag, 'cache-control': 'no-cache' });") === 1 && cnt(libSrc, "res.writeHead(304, { etag: etag, 'cache-control': 'no-cache' });") === 1, 'ETag: both routes answer 304 empty with the same validator on a match');
		ok(cnt(petSrc, "'cache-control': 'no-cache',") === 1 && cnt(libSrc, "'cache-control': 'no-cache',") === 1, 'ETag: both 200 branches carry cache-control no-cache (revalidate-always, semantics preserved)');
		ok(petSrc.includes('etagMatches(req.headers[\'if-none-match\'], etag)') && libSrc.includes('etagMatches(req.headers[\'if-none-match\'], etag)'), 'ETag: both routes gate the 304 on the shared If-None-Match predicate');
		/* token 闸先行不破：pet 路由 304 判定在 403 之后（坏 token 永远到不了
		 * 条件分支——源码顺序断言） */
		ok(petSrc.indexOf('checkPetToken(req, tokenHex)') < petSrc.indexOf('etagMatches(req.headers'), 'ETag: the pet route keeps the token gate AHEAD of the conditional branch (order preserved)');
		ok(libSrc.includes('base.petLedger = normalizePetLedger(base.petLedger);') && libSrc.includes('queueStoreWrite, normalizePetLedger } from'), '/state: top-level petLedger dispatched through the normalize gate (key always present)');
	}

	/* ---- C8. 双端接线源码契约（宿主识别 + 页侧携带 + 保留集）---- */
	{
		ok(petSrc.includes('const interact = normalizePetInteract(body && body.interact);'), 'pet.js: sync handler recognizes the interact field through the whitelist helper');
		ok(petSrc.includes("if (action === 'ledger') {") && petSrc.includes('normalizePetInteract(body && body.kind)'), 'pet.js: /pet/ctrl ledger action exists and validates kind through the same whitelist');
		ok(petSrc.includes('if (!patch && !interact) {') && petSrc.includes("error: 'aff|affMs|pos|reminders|soundMuted|petHint required'"), 'pet.js: 400 gate accepts interact-only sync; legacy message byte-identical (phase-B pin)');
		ok(expSrc.includes("if (payload.interact !== 'pet' && payload.interact !== 'wake') delete payload.interact;"), 'exports.js: pushPetSync passes interact through and strips non-whitelisted values (dirty field would sink the whole payload into a 400)');
		ok(cnt(pageSrc, "JSON.stringify({ action: 'sync', interact: 'wake' })") === 1, 'page.html: peek-bubble burst (wake) carries interact:wake over the sync channel, exactly one call site');
		ok(petSrc.includes('export function petScriptEtag(code)') && petSrc.includes('export function etagMatches(ifNoneMatch, etag)'), 'pet.js: ETag pure-function pair exported (single implementation shared by both whale.js routes, behaviorally proven in C7)');
	}

	console.log('LEDGER-PERF BLOCK PASSED (+' + (passed - passedBeforeC) + ' checks)');
}
console.log('ALL HOST-STORE TESTS PASSED (' + passed + ' checks, phase-B + phase-C blocks included)');
