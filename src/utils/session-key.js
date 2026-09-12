/* Session-key resolution (inline module): ONE copy of the active-conversation
 * id extraction, shared by BOTH event channels — core/alpha-adapter.js (DOM
 * side) and core/server-events.js (poll side) previously carried byte-identical
 * copies that could drift silently. Resolution order:
 *   1. localStorage 'dsh.sessions.current' (JSON {sessionId}) — authoritative
 *      across switches;
 *   2. insertion-ordered 'dsh.conversation[.chat].session-*' localStorage keys
 *      (a cache that goes STALE after a jump back to an older conversation —
 *      fallback only);
 *   3. FALLBACK_ID placeholder ('session-alpha-active') — the alpha adapter's
 *      synthetic active session when nothing resolvable is present.
 */
var FALLBACK_ID = 'session-alpha-active';
var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;

function resolveCurrentSessionId() {
	try {
		var raw = localStorage.getItem('dsh.sessions.current');
		if (raw) {
			var v = JSON.parse(raw);
			if (v && typeof v.sessionId === 'string' && v.sessionId.indexOf('session-') === 0) return v.sessionId;
		}
	} catch (e) {}
	try {
		var keys = Object.keys(localStorage);
		for (var i = keys.length - 1; i >= 0; i--) {
			var m = keys[i].match(SESSION_KEY_RE);
			if (m) return m[1];
		}
	} catch (e) {}
	return FALLBACK_ID;
}
