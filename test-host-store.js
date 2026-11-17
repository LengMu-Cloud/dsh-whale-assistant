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
ok(readdirSync(dir).length === 1, 'still exactly one file');

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
 *    原保留集只有 `pet`。 */
const mH1 = mergeHistory(
	{ clearAt: 0, history: [], pet: { form: 'full' }, petConfig: { volume: 80 }, pendingJump: { code: 's3' }, pendingSettings: { volume: 80 }, _debug: { at: 1 } },
	{ clearAt: 0, history: [{ sessionId: 'h', at: 5, kind: 'done', title: '页鲸推送' }] }
);
ok(mH1.pet && mH1.pet.form === 'full', 'host key pet survives a page save');
ok(mH1.petConfig && mH1.petConfig.volume === 80, 'host key petConfig survives a page save');
ok(mH1.pendingJump && mH1.pendingJump.code === 's3', 'host key pendingJump survives a page save');
ok(mH1.pendingSettings && mH1.pendingSettings.volume === 80, 'host key pendingSettings survives a page save');
ok(mH1._debug && mH1._debug.at === 1, 'host key _debug survives a page save');
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
