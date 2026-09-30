/** Session jump (inline module): open a conversation in the DSH UI and,
 * when a target moment (atMs) is given, page the conversation log backwards
 * until the rendered message stamps cover that moment (or the whole log is
 * in memory), then scroll the closest older stamp into view.
 *
 * 0.4.0 provenance: this logic used to be INJECTED into the official
 * conversation client by apply-plugin-hook.ps1 (globalThis.__dshOpenSession).
 * It now runs in the plugin: the client-module bridge (whale-assistant/
 * client.js apply → ctx.inject(['sessions'])) hands us the very same
 * sessions service through official channels, so no DSH file is ever
 * modified and DSH upgrades can never wipe it. Fallback when the bridge is
 * missing (old host / exotic builds): sidebar row click — opens the
 * conversation without moment positioning (openViaSidebarByTitle). */

var jumpSessions = null; /* 0.1.x sessions service via the bridge (has .open) */
var jumpUiWorkspace = null; /* 0.2.0 uiWorkspace service face via the bridge (has .openSession) */
var jumpRunSeq = 0; /* supersede counter: a newer jump cancels the paging loop */

/** Wire the services in (called by the client-module bridges, or at boot when
 * a bridge stashed its face before whale eval). Idempotent and ADDITIVE: each
 * bridge callback delivers only ITS services, so an argument that is absent
 * must never clear a binding another callback already made. */
function bindJumpSessions(sessions, conversation, uiWorkspace) {
	if (sessions && typeof sessions.open === 'function') jumpSessions = sessions;
	if (uiWorkspace && typeof uiWorkspace.openSession === 'function') jumpUiWorkspace = uiWorkspace;
}

/** True once any jump path is bridged (health jump item + callers). */
function jumpReady() {
	return !!(jumpSessions || jumpUiWorkspace);
}

/** Parse a rendered message stamp into ms epoch; null when not a stamp.
 * Layouts: M月D日 HH:MM · M/D HH:MM · YYYY-M-D HH:MM · HH:MM · Mon D, HH:MM.
 * Pure — exported for tests. */
function parseStamp(text) {
	var m = text.match(/(\d{1,2})\u6708(\d{1,2})\u65e5\s*(\d{1,2}):(\d{2})/);
	if (!m) m = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
	if (m) {
		var now = new Date();
		var d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
		if (d.getTime() > Date.now() + 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2], +m[3], +m[4]);
		return d.getTime();
	}
	m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
	if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
	m = text.match(/^(\d{1,2}):(\d{2})$/);
	if (m) { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), +m[1], +m[2]).getTime(); }
	m = text.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{1,2}):(\d{2})/);
	if (m) {
		var names = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
		var mo = names[m[1].slice(0, 3).toLowerCase()];
		if (mo !== void 0) {
			var n2 = new Date();
			var d2 = new Date(n2.getFullYear(), mo, +m[2], +m[3], +m[4]);
			if (d2.getTime() > Date.now() + 864e5) d2 = new Date(n2.getFullYear() - 1, mo, +m[2], +m[3], +m[4]);
			return d2.getTime();
		}
	}
	return null;
}

/** Open the session and (with atMs) page back to it. Returns true when the
 * jump was initiated via the bridge; false lets callers fall back to the
 * sidebar. A newer call supersedes a still-running paging loop.
 *
 * Two bridge shapes (第35章九):
 * - 0.1.x: sessions.open(sessionId, atMs) — service-level open.
 * - 0.2.0: uiWorkspace.openSession(sessionId) — the SAME call the sidebar's
 *   row click makes (onOpen → openSession → replaceMain(id, signal, "reveal"):
 *   switches the main view AND reveals the row in the sidebar). The moment
 *   paging below is DOM-based and engine-agnostic, so it rides on either. */
function openSessionAt(sessionId, atMs) {
	if (!sessionId) return false;
	if (jumpSessions && typeof jumpSessions.open === 'function') {
		try {
			/* atMs forwarded on the call surface (same 2-arg shape as the old
			 * hook) for observability; the REAL anchor consumer is the paging
			 * loop below — the official open() ignores the extra arg */
			jumpSessions.open(sessionId, atMs);
		} catch (e) {
			return false; /* open failed: callers fall back to the sidebar */
		}
	} else if (jumpUiWorkspace && typeof jumpUiWorkspace.openSession === 'function') {
		try {
			jumpUiWorkspace.openSession(sessionId);
		} catch (e) {
			return false; /* open failed: callers fall back to the sidebar */
		}
	} else {
		return false; /* no bridge bound */
	}
	if (!atMs) return true;
	var run = (jumpRunSeq = jumpRunSeq + 1);
	var pages = 0, paged = false, done = false, stampMode = "";
	var inFlight = 0;
	var t0 = Date.now();
	function stampEls() {
		var root = document.querySelector("[data-chat-flow]");
		if (!root) return [];
		if (stampMode === "") {
			var quick = root.querySelectorAll('[class*="timeStart"]');
			if (quick.length) { stampMode = "class"; return quick; }
			stampMode = "walk";
		}
		if (stampMode === "class") return root.querySelectorAll('[class*="timeStart"]');
		/* fallback: leaf elements whose whole text parses as a stamp */
		var all = root.querySelectorAll("*"), out = [];
		for (var i = 0; i < all.length; i++) {
			if (all[i].children.length) continue;
			var t = (all[i].textContent || "").trim();
			if (!t || t.length > 16) continue;
			if (parseStamp(t) !== null) out.push(all[i]);
		}
		return out;
	}
	function stampMs(el) { return parseStamp((el.textContent || "").trim()); }
	/* the pager node EXISTS while older history remains — its label flips to
	 * a loading text mid-flight, so match the node, not the text */
	function hasMoreNode() {
		var root = document.querySelector("[data-chat-flow]");
		if (root && root.querySelector('[class*="older"] button')) return true;
		var btns = document.querySelectorAll("button");
		for (var i = 0; i < btns.length; i++) {
			var t = (btns[i].textContent || "").trim();
			if (t.indexOf("\u52a0\u8f7d") === 0 || /^load/i.test(t)) return true;
		}
		return false;
	}
	function finish() {
		if (done) return;
		done = true;
		/* Re-entrant placement: a CROSS-SESSION jump re-renders the whole
		 * flow after open() settles — React mounts the list and resets
		 * scroll to the tail, wiping a single early placement. Re-find the
		 * target (re-query keeps it connected) and re-assert while the view
		 * settles. */
		function place() {
			var best = null, top = null;
			var list = stampEls();
			for (var i = 0; i < list.length; i++) {
				var ms = stampMs(list[i]);
				if (ms === null) continue;
				if (top === null || ms < top.ms) top = { el: list[i], ms: ms };
				if (ms <= atMs && (best === null || ms > best.ms)) best = { el: list[i], ms: ms };
			}
			var target = best || top;
			if (!target) return;
			/* the chat column's own scroll element has overflow:visible — the
			 * REAL scroller is the nearest ancestor with a scrollable
			 * overflowY, so scroll that one directly (rect-delta math) */
			var n = document.querySelector("[data-chat-flow]");
			var sc = null;
			while (n && n !== document.body) {
				var oy = window.getComputedStyle(n).overflowY;
				if (oy === "auto" || oy === "scroll") { sc = n; break; }
				n = n.parentElement;
			}
			if (!sc) sc = document.scrollingElement || document.documentElement;
			var delta = target.el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
			sc.scrollTop = sc.scrollTop + delta - 24;
		}
		place();
		setTimeout(place, 350);
		setTimeout(place, 900);
	}
	var timer = setInterval(function () {
		if (jumpRunSeq !== run) { clearInterval(timer); return; }
		if (pages >= 400 || Date.now() - t0 > 45000) { clearInterval(timer); finish(); return; }
		if (done) { clearInterval(timer); return; }
		var conv = null;
		try {
			var scoped = jumpSessions.scope(sessionId);
			conv = scoped && scoped.get("conversation");
		} catch (e) { conv = null; }
		if (!conv || typeof conv.loadOlder !== "function") return; /* open still settling */
		if (paged) {
			var oldest = Infinity, seen = false;
			var list = stampEls();
			for (var i = 0; i < list.length; i++) {
				var ms = stampMs(list[i]);
				if (ms === null) continue;
				seen = true;
				if (ms < oldest) oldest = ms;
			}
			if (seen && oldest <= atMs) { clearInterval(timer); finish(); return; }
			if (!hasMoreNode()) { clearInterval(timer); finish(); return; }
		}
		if (inFlight && Date.now() - inFlight < 6000) return; /* page watchdog */
		inFlight = Date.now();
		pages++;
		Promise.resolve(conv.loadOlder()).then(function () {
			paged = true;
			inFlight = 0;
		}, function () {
			paged = true;
			inFlight = 0;
		});
	}, 200);
	return true;
}

/** 0.2.0 desktop fallback (B-2, precise): the app sidebar is a virtualized
 * rc-tree whose rows carry data-row-key="session:<sessionId>" — click the row
 * by ID, immune to same-titled conversations and to the cordis inject gate
 * that blocks the sessions bridge. Rows exist only while rendered (expanded
 * project + viewport) — absent row = false, title fallback runs next. */
function openViaSidebarById(sessionId) {
	if (!sessionId) return false;
	var items = document.querySelectorAll('[role="treeitem"]');
	for (var i = 0; i < items.length; i++) {
		var el = items[i];
		var rk = el.getAttribute('data-row-key');
		if (rk !== 'session:' + sessionId) {
			/* react may keep it only in props (getAttribute misses on some trees) */
			rk = null;
			var own = Object.keys(el);
			for (var k = 0; k < own.length; k++) {
				if (own[k].indexOf('__reactProps$') === 0 && el[own[k]] && el[own[k]]['data-row-key']) {
					rk = el[own[k]]['data-row-key'];
					break;
				}
			}
		}
		if (rk === 'session:' + sessionId) {
			el.click();
			return true;
		}
	}
	return false;
}

/** Fallback (no bridge): click the app sidebar's row whose text starts with
 * this title — opens the conversation without moment positioning. Ported
 * from the history drawer's openViaSidebar so BOTH jump entry points share
 * one fallback chain. */
function openViaSidebarByTitle(title) {
	if (!title) return false;
	var divs = document.getElementsByTagName('div');
	for (var i = 0; i < divs.length; i++) {
		var cls = divs[i].className;
		var clsStr = typeof cls === 'string' ? cls : (cls && cls.baseVal) || '';
		if (clsStr.indexOf('sessionRow') < 0) continue;
		var t = (divs[i].textContent || '').trim();
		if (t && t.indexOf(title) === 0) {
			divs[i].click();
			return true;
		}
	}
	return false;
}

/* boot pickup: a bridge may run before whale eval and stash its service
 * faces. GUARDED: a stashed value from a mismatched engine must never kill
 * the whale boot — the bridges keep working; worst case jump stays unbound
 * (sidebar fallbacks cover it). */
if (typeof window !== 'undefined' && (window.__dshWhaleSessions || window.__dshWhaleUiWorkspace)) {
	try {
		bindJumpSessions(window.__dshWhaleSessions, window.__dshWhaleConversation, window.__dshWhaleUiWorkspace);
	} catch (e) { /* service shape mismatch — jump unbound until the bridges rebind */ }
}
