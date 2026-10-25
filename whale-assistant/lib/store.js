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
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

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
		renameSync(storePath(dir), storePath(dir) + '.corrupt-' + Date.now());
	} catch (e) { /* nothing left to preserve */ }
}

/**
 * Atomic ledger write: mkdir -> write <file>.tmp -> rename over the target.
 * rename over an existing file is atomic on POSIX; on Windows it can hit a
 * transient EPERM while another handle holds the target — fall back to the
 * direct write (and drop the stale tmp) rather than fail the save.
 */
export function saveStoreAtomic(dir, doc) {
	mkdirSync(dir, { recursive: true });
	const file = storePath(dir);
	const tmp = file + '.tmp';
	writeFileSync(tmp, JSON.stringify(doc), 'utf8');
	try {
		renameSync(tmp, file);
	} catch (e) {
		writeFileSync(file, JSON.stringify(doc), 'utf8');
		try { unlinkSync(tmp); } catch (e2) { /* a stale .tmp is harmless */ }
	}
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
 */
export function mergeHistory(existing, incoming) {
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
		else if (richness(e) === richness(prev) && (e.at || 0) > (prev.at || 0)) seen.set(key, e);
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
