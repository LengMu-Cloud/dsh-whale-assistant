/* Session-key resolution (inline module): ONE copy of the active-conversation
 * id extraction, shared by BOTH event channels — core/alpha-adapter.js (DOM
 * side) and core/server-events.js (poll side) previously carried byte-identical
 * copies that could drift silently. Resolution order:
 *   0. per-window pin (sessionStorage 'dsh-whale:window-session', P1
 *      2026-10-28) — see 多窗口归属 note below; absent for every fresh
 *      window, so single-window behavior is byte-identical to pre-pin;
 *   1. localStorage 'dsh.sessions.current' (JSON {sessionId}) — authoritative
 *      across switches;
 *   2. insertion-ordered 'dsh.conversation[.chat].session-*' localStorage keys
 *      (a cache that goes STALE after a jump back to an older conversation —
 *      fallback only);
 *   3. FALLBACK_ID placeholder ('session-alpha-active') — the alpha adapter's
 *      synthetic active session when nothing resolvable is present.
 *
 * 多窗口归属（P1 2026-10-28）：'dsh.sessions.current' 是全部分区共享的单值键，
 * 两个 DSH 窗口看不同会话时，后切换的窗口改写全局键，先窗口的芯片用量/完成
 * 通知/历史记录就会记到别人的会话头上。修法 = 每窗口 sessionStorage pin：
 * 本窗口出现「非鲸鱼自身的」DOM 活动（alpha-adapter 的 MutationObserver）或
 * 本窗口主动打开会话（session-jump）时，把此刻的全局链结果快照进 pin；之后
 * 别的窗口改写全局键不再影响本窗口。pin 只在首个活动信号后出现——单窗口
 * 用户全程走原链路，行为零变化。
 */
var FALLBACK_ID = 'session-alpha-active';
var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;
var WINDOW_PIN_KEY = 'dsh-whale:window-session';

function isRealSessionId(sid) {
	return typeof sid === 'string' && sid.indexOf('session-') === 0 && sid !== FALLBACK_ID;
}

/** The pre-pin chain (global key → conversation cache → fallback), kept
 * separate so adoption can snapshot it WITHOUT the pin shadowing itself. */
function resolveGlobalSessionId() {
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

function resolveCurrentSessionId() {
	try {
		if (typeof sessionStorage !== 'undefined') {
			var pin = sessionStorage.getItem(WINDOW_PIN_KEY);
			if (isRealSessionId(pin)) return pin;
		}
	} catch (e) {}
	return resolveGlobalSessionId();
}

/** Pin THIS window to `sid` (sessionStorage survives per BrowserWindow;
 * localStorage is shared across the whole partition). Non-real ids are
 * rejected so the placeholder never gets pinned over a later real one. */
function pinWindowSession(sid) {
	try {
		if (typeof sessionStorage === 'undefined' || !isRealSessionId(sid)) return;
		sessionStorage.setItem(WINDOW_PIN_KEY, sid);
	} catch (e) {}
}

/** Local-activity adoption: snapshot the GLOBAL chain result into the pin.
 * Called by alpha-adapter when THIS window shows non-whale chat activity
 * (the single-active-window flow: the last switch wrote the global key,
 * and it was this window's). No-ops on the placeholder so a bare window
 * never pins it over a later real session. */
function adoptCurrentSessionPin() {
	var sid = resolveGlobalSessionId();
	if (isRealSessionId(sid)) pinWindowSession(sid);
}
