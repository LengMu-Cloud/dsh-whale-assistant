/**
 * Cross-channel event dedup (inline module): ONE place that owns every
 * "this exact event already spoke" decision, with EXPLICIT keys and
 * RING-CAPPED storage (the three ad-hoc maps this replaces — bgSeen,
 * attSeen-writes and the single-slot lastEndFire — grew without bound or
 * could shadow each other; the single-slot lastEndFire even let two
 * interleaved failing sessions defeat each other's 30s suppression).
 *
 * Coverage matrix (why each class is in or out):
 *   question/approval — IN  : the one class both channels can legitimately
 *                             produce (server forwards background rows, the
 *                             DOM adapter renders active ones, and a session
 *                             can flip active↔background mid-question).
 *                             Key = the natural callId; time fallback keeps
 *                             a SHORT window because two REAL questions can
 *                             land in the same second (never fold those).
 *   fail/max-tokens   — IN  : DOM failure-row + server authoritative frame
 *                             describe the same turn; keyed PER SESSION so
 *                             sessions never shadow each other. The DOM
 *                             success chip also records an end-fire (parity
 *                             with the old lastEndFire semantics).
 *   done              — IN (09-06): the "channels are disjoint" assumption
 *                             broke once in the wild (question-answer flow,
 *                             active-detection race → the same end announced
 *                             by both the chip adapter and the polled frame).
 *                             Keyed by EVENT TIME ±8s: the same physical end
 *                             seen by both clocks matches (single machine),
 *                             while a real quick repeat completion carries
 *                             its own endTime seconds away and still
 *                             announces.
 *   turn/start        — OUT : already throttled per session (15s) in
 *                             server-events + boot-time silence.
 */

var DEDUP = {
	attention: {}, /* callId-ish -> 1 (shared with the DOM adapter via window.__dshWhale.attSeen) */
	endFire: {}    /* sessionId -> { kind: 'success'|'fail', at } */
};
var DEDUP_CAP = {
	attention: 200,
	endFire: 50
};

/** Ring-prune one bucket to its cap, evicting the oldest keys first. */
function pruneDedup(bucket) {
	var cap = DEDUP_CAP[bucket] || 100;
	var keys = Object.keys(DEDUP[bucket]);
	while (keys.length > cap) {
		delete DEDUP[bucket][keys.shift()];
		keys = Object.keys(DEDUP[bucket]);
	}
}

/** Generic ring-cap for plain OBJECT accumulators (oldest keys evicted
 * first). Used by the per-session Maps/objects that used to grow without
 * bound across days-long page lifetimes (memory audit, P2⑨). */
function capObj(obj, cap) {
	var keys = Object.keys(obj);
	var excess = keys.length - cap;
	for (var i = 0; i < excess; i++) delete obj[keys[i]];
}

/** Generic ring-cap for Map accumulators (Map preserves insertion order,
 * so first-inserted = oldest). Same memory-audit purpose. */
function capMap(map, cap) {
	if (map.size <= cap) return;
	var excess = map.size - cap;
	var it = map.keys();
	for (var i = 0; i < excess; i++) {
		var k = it.next();
		if (k.done) break;
		map.delete(k.value);
	}
}

/**
 * Record an attention event key. Returns true the FIRST time the key is
 * seen (caller may announce), false on repeats. The map lives on
 * window.__dshWhale.attSeen so the DOM adapter's switch-render guard keeps
 * reading the very same object it always has.
 */
function seeAttention(key) {
	if (!key) return false;
	try {
		window.__dshWhale = window.__dshWhale || {};
		var seen = window.__dshWhale.attSeen = window.__dshWhale.attSeen || DEDUP.attention;
		if (seen[key]) return false;
		seen[key] = 1;
		DEDUP.attention = seen;
		pruneDedup('attention');
		return true;
	} catch (e) {
		return true; /* storage hiccups must never eat a real question */
	}
}

/** Record that THIS session's turn just ended with `kind` on the DOM side.
 * `endTime` (ms epoch of the ended event; default now) powers the
 * cross-channel completion dedup: the polled frame for the SAME end carries
 * the same wall-clock second (single machine), so an ±8s match means "same
 * physical end", never "a second quick end". */
function seeEndFire(sessionId, kind, endTime) {
	if (!sessionId) return;
	DEDUP.endFire[sessionId] = {
		kind: kind || 'success',
		at: Date.now(),
		endAt: typeof endTime === 'number' ? endTime : Date.now()
	};
	pruneDedup('endFire');
}

/** True when a same-kind end with an event time within `tolMs` of `endTime`
 * was already announced by the other channel — the completion dedup key
 * (see the matrix: done is IN since 09-06, keyed by event time so legitimate
 * quick repeat completions still announce). */
function endFiredFor(sessionId, kind, endTime, tolMs) {
	var rec = DEDUP.endFire[sessionId];
	if (!rec || rec.kind !== (kind || 'success')) return false;
	if (typeof rec.endAt !== 'number' || typeof endTime !== 'number') return false;
	return Math.abs(rec.endAt - endTime) <= (tolMs || 8000);
}

/**
 * True when THIS session's DOM side already announced an end recently:
 * a failure within `failMs` suppresses the server's authoritative failure
 * frame for the same turn; any end within the window keeps parity with the
 * old single-slot lastEndFire (now per session, so two sessions failing in
 * interleaved order can no longer shadow each other's suppression).
 */
function endFiredRecently(sessionId, failMs, anyMs) {
	var rec = DEDUP.endFire[sessionId];
	if (!rec) return false;
	var now = Date.now();
	if (rec.kind === 'fail' && now - rec.at < (failMs || 30000)) return true;
	return now - rec.at < (anyMs || 30000);
}
