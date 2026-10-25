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

let passed = 0;
function ok(cond, msg) { passed++; assert.ok(cond, msg); }

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

rmSync(dir, { recursive: true, force: true });
console.log('ALL HOST-STORE TESTS PASSED (' + passed + ' checks)');
