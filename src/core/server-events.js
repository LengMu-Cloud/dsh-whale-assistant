/**
 * Server-events consumer (inline module): polls the whale-assistant host's
 * /api/whale-assistant/events route (the host lives in the dsh server's cordis
 * container and buffers session events for EVERY session) and feeds the
 * frames the DOM adapter cannot see:
 *
 *   - turn/start of EVERY session (2026-09-02 revision: start announces
 *     moved here ENTIRELY — DOM composer heuristics faked 开工 whenever
 *     DSH's own flow mutations landed in the confirmation window)
 *   - turn/end + turn/start of BACKGROUND sessions (the whole point: the
 *     DOM only renders the conversation you are looking at)
 *   - turn/end with reason error/max-tokens for ANY session (authoritative
 *     failure reasons — the DOM has no failure signal for finished turns)
 *   - turn/end with reason aborted for the ACTIVE session too (a manual stop
 *     renders no chip at all — 09-06: the ⏳ timer otherwise never stops)
 *   - title projections of background sessions (real names in notifications)
 *
 * The ACTIVE session's instant signals stay with the DOM adapter (chip
 * finish, question rows); this consumer skips those end frames so nothing
 * double-fires.
 */
	(function initServerEvents() {
	if (typeof fetch !== 'function' || typeof setInterval !== 'function') return;

	var FALLBACK_ID = 'session-alpha-active';
	var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;

	function activeSessionId() {
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
				var m = SESSION_KEY_RE.exec(keys[i]);
				if (m) return m[1];
			}
		} catch (e) {}
		return FALLBACK_ID;
	}

	/* 3s poll (was 8s): the route is a cheap in-memory slice, and the user
	 * reported the background latency as too high. NOTE this only helps
	 * while the window renders — the desktop shell now sets
	 * backgroundThrottling:false so a minimized DSH keeps real timers. */
	var POLL_MS = 3000;
	var lastSeq = 0;
	/* the host resets its seq counter on every restart: the persisted
	 * last-seq is only valid WITHIN one boot generation (keyed by bootId).
	 * Without this, a page that survived a server restart drops every new
	 * frame until the counter crawls past the stale value — background
	 * notifications then arrive in one late burst (live-verified bug). */
		var state = { bootId: null, seq: 0 };
		try {
			/* localStorage, not sessionStorage: closing and reopening the shell
			 * within one service boot must NOT replay frames the previous
			 * window already consumed (09-06 real-machine: replay re-announced
			 * completions and re-recorded history with inflated token sums).
			 * bootId keying still resets on a host restart; frames emitted
			 * while no window was open carry higher seqs and still arrive. */
			state = JSON.parse(localStorage.getItem('dsh-whale:evseq') || 'null') || state;
		} catch (e) {}
	lastSeq = state.seq || 0;
	var knownBootId = state.bootId;
	var bootAt = Date.now();
	var lastStartAt = {}; /* per-session turn/start announce throttle */
	/* batch fold: how many completed turn/ends of the SAME session ride in
	 * one poll batch (a hidden/throttled tab lets minutes of events pile up
	 * in a single fetch). FOLD_MIN or more collapse into ONE 📦 summary
	 * announcement — history still records every turn. */
	var FOLD_MIN = 3;

	function rememberSeq(n) {
		lastSeq = n;
		try { localStorage.setItem('dsh-whale:evseq', JSON.stringify({ bootId: knownBootId, seq: n })); } catch (e) {}
	}

	function feedEventFrame(frame) {
		var sid = frame.sessionId;
		var event = frame.event || {};
		var active = activeSessionId();
		var isActive = sid === active;
		var type = event.type;
		if (type === 'turn/end') {
			var reason = event.data && event.data.reason && event.data.reason.kind;
			/* the timer stop must NOT hang on the announcement paths: the
			 * dedup return below (chip fired first) and the fail-window
			 * return both run BEFORE the processed branch's stopRunTimer —
			 * a 2s dev-say turn leaked a 1h ⏳ row exactly that way (09-06
			 * 真机 B6: chip announced, polled end dedup-dropped, slot lived
			 * on). Stop is idempotent; announcement gating is untouched. */
			try { stopRunTimer(sid); } catch (e) {}
			if (isActive) {
				/* the DOM adapter already fired success for a visible chip;
				 * only authoritative FAILURES may speak here, and only when
				 * the DOM did not just announce this same turn (per-session
				 * keyed — the old single-slot lastEndFire let two sessions
				 * failing in interleaved order defeat each other's 30s
				 * suppression) */
				/* 'completed' joins the pass list (09-06 真机 B3): when the
				 * adapter never armed for this turn (turn started before the
				 * page loaded, or an ask-card resumed without a composer) the
				 * chip NEVER fires and the visible completion was silently
				 * lost — no record, no bell. The ±8s endFiredFor below (and
				 * the chip-side mirror guard) absorb the normal double. */
				if (reason !== 'error' && reason !== 'max-tokens' && reason !== 'aborted' && reason !== 'completed') return;
				/* a manual stop (reason aborted, 09-06 用户报告: 手动停止后
				 * ⏳ 计时仍在走) has NO DOM signal at all — a killed turn
				 * never renders a usage chip — so this polled frame is the
				 * ONLY stop signal the whale gets: the run timer, the ⏹
				 * history row and the 被中止了 announcement all hang on it.
				 * It must also skip endFiredRecently: that 30s fail window
				 * would swallow a legitimate stop → restart → stop. */
				if (reason !== 'aborted' && endFiredRecently(sid)) return;
			}
			/* cross-channel completion dedup (09-06): the active-session
			 * check above can race (chip gate / session tracking) and the
			 * DOM chip adapter may have JUST announced this same end —
			 * same physical end = same wall clock within seconds; a real
			 * new completion carries its own endTime and still announces */
			if (reason === 'completed' && endFiredFor(sid, 'success', frame.time || Date.now(), 8000)) return;
			try { registerBackground(sid); } catch (e) {}
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: {
					type: 'turn/end', time: frame.time || Date.now(), seq: frame.seq, data: event.data || {},
					/* batch-fold markers (set by consume's pre-scan): all but
					 * the newest completed turn of a flood session announce
					 * NOTHING; the newest announces for the whole batch */
					foldSuppress: event.foldSuppress || undefined,
					foldCount: event.foldCount || undefined
				}
			});
			return;
		}
		if (type === 'session/title') {
			/* rc.1 broadcasts titles as session/title EVENTS (data.title,
			 * source kind fallback/llm) while ctx.sessionProjections.onChanged
			 * has never fired on this build (09-06 real-machine test: 0
			 * projection frames all boot) — so a question raised before the
			 * name was known kept [未命名任务] in the bubble, the unread row
			 * AND history forever. Translate the event into the projection
			 * payload the page already consumes; needed for ACTIVE and
			 * background sessions alike, and idempotent on re-writes. */
			var t = event.data && event.data.title;
			if (t && typeof t === 'string') {
				handleMuxPayload({ type: 'session/projection', sessionId: sid, key: 'title', value: t });
			}
			return;
		}
		if (type === 'tool/call' && !isActive) {
			/* a question raised in a BACKGROUND session must still ring:
			 * convert its tool/call into the attention frame the whale
			 * speaks (the DOM adapter does this for the visible one). The
			 * callId goes into the SHARED dedup map (seeAttention, ring-
			 * capped) so the DOM adapter's switch re-render of the same row
			 * never rings a second 🤔. */
			if (event.data && event.data.name === 'ask_user_question') {
				var qKey = event.data.callId || ('q:' + (frame.time || ''));
				if (seeAttention(qKey)) {
					try { registerBackground(sid); } catch (e) {}
					handleMuxPayload({ type: 'question/requested', sessionId: sid, time: frame.time || Date.now() });
				}
			}
			return;
		}
		if (type === 'turn/start') {
			/* AUTHORITATIVE start for EVERY session (active included): the
			 * server event means a turn really began — no heuristics. A
			 * start that predates the page load means the turn was already
			 * mid-flight when we loaded: stay silent (its turn/end will
			 * still speak), otherwise a reload during a long turn would
			 * announce a bogus 开工. A 15s per-session throttle absorbs any
			 * duplicate emissions.
			 * (2026-09-03 hotfix: this guard read `f.time` — `f` is the
			 * POLL LOOP's local, not a name in this function. Every
			 * turn/start threw ReferenceError, silently swallowed by the
			 * poll catch, and 开工了 never announced. The variable is
			 * `frame`; the event time lives at frame.event.time.) */
			var startAt = event.time || frame.time;
			if (startAt && startAt < bootAt - 5000) return;
			var nowMs = Date.now();
			if (lastStartAt[sid] && nowMs - lastStartAt[sid] < 15000) return;
			lastStartAt[sid] = nowMs;
			capObj(lastStartAt, 100); /* memory audit */
			try { registerBackground(sid); } catch (e) {}
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: 'turn/start', time: startAt || Date.now(), seq: frame.seq, data: event.data || {} }
			});
			return;
		}
		if (type === 'assistant/message' && !isActive) {
			/* per-model-reply usage: the ONLY source of THIS-turn token burn
			 * for a background session (the DOM chip path cannot see it).
			 * Without this the completion panel re-showed the previous
			 * foreground turn's stale count (live-verified 2026-09-03). */
			touchActivity();
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: 'assistant/message', time: frame.time || Date.now(), seq: frame.seq, data: event.data || {} }
			});
			return;
		}
		/* tool/call, tool/result, step/start: the active session's DOM covers
		 * status instantly; background tool noise would only flicker the
		 * panel — intentionally not forwarded */
	}

	/** A background session needs registration before reportTurn speaks,
	 * and a title before the notification reads well. The server-side
	 * 'title' projection names it; until one arrives the registered
	 * placeholder keeps the notification generic instead of wrong. */
	function registerBackground(sid) {
		try {
			if (window.__dshWhale && window.__dshWhale.subagentSessions && !window.__dshWhale.subagentSessions.get(sid)) {
				handleMuxPayload({
					type: 'session/projection',
					sessionId: sid,
					key: 'subagentTiming',
					value: {}
				});
			}
		} catch (e) {}
		lookupTitlesFromHistory();
	}

	/* Title projections are PUSH-ON-CHANGE: right after a page reload no
	 * title frame flows, so the first background notification announced
	 * itself as [未命名任务]. The whale's OWN synced history knows every
	 * conversation's latest name — one fetch prefills them all. Runs once
	 * at startup AND on the first background registration. */
	var titlesLookedUp = false;
	function lookupTitlesFromHistory(force) {
		if (titlesLookedUp && !force) return;
		titlesLookedUp = true;
		if (typeof fetch !== 'function') return;
		fetch('/api/whale-assistant/state').then(function (r) {
			return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status));
		}).then(function (doc) {
			var hist = doc && Array.isArray(doc.history) ? doc.history : [];
			var set = 0;
			for (var i = 0; i < hist.length; i++) {
				var h = hist[i];
				if (!h || !h.sessionId || !h.title || h.title === '未命名任务') continue;
				try {
					if (!sessionTitles.get(h.sessionId)) { sessionTitles.set(h.sessionId, h.title); set++; }
					var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
					var info = subs && subs.get(h.sessionId);
					if (info && !info.title) info.title = h.title;
				} catch (e) {}
			}
			try {
				fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'title-prefill', at: Date.now(), records: hist.length, set: set }) });
			} catch (e) {}
		}).catch(function (e) {
			try {
				fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'title-prefill-error', at: Date.now(), error: String(e && e.message || e) }) });
			} catch (e2) {}
		});
	}
	lookupTitlesFromHistory(true);

	function consume(events, bootId) {
		if (bootId && bootId !== knownBootId) {
			/* new host generation: its seq starts over — reset and only take
			 * frames newer than the swap */
			knownBootId = bootId;
			lastSeq = 0;
			rememberSeq(0);
		}
		/* --- batch-fold pre-scan ---: count each session's completed
		 * turn/ends that will actually feed this batch (same freshness and
		 * seq filters as the loop below). FOLD_MIN+ collapses into one 📦
		 * summary: all but the newest turn are marked foldSuppress (record
		 * silently), the newest carries foldCount and speaks for the batch. */
		var foldN = {};
		var foldLastSeq = {};
		var nowPre = Date.now();
		for (var pi = 0; pi < events.length; pi++) {
			var pf = events[pi];
			if (!pf || typeof pf.seq !== 'number' || pf.seq <= lastSeq) continue;
			/* freshness: host frames carry NO top-level time (only
			 * event.time) — the bare pf.time check was dead code and a seq
			 * reset re-announced/re-recorded the whole buffer (09-06 真机) */
			var pfTime = pf.time || (pf.event && pf.event.time);
			if (pfTime && nowPre - pfTime > 60000 && bootAt - pfTime > 60000) continue;
			if (pf.type !== 'session/event' || !pf.event || pf.event.type !== 'turn/end') continue;
			var pr = pf.event.data && pf.event.data.reason && pf.event.data.reason.kind;
			if (pr !== 'completed') continue; /* never fold failures/aborts */
			foldN[pf.sessionId] = (foldN[pf.sessionId] || 0) + 1;
			foldLastSeq[pf.sessionId] = pf.seq;
		}
		for (var i = 0; i < events.length; i++) {
			var f = events[i];
			if (!f || typeof f.seq !== 'number' || f.seq <= lastSeq) continue;
			rememberSeq(f.seq);
			/* a fresh page must not replay the buffer's history — same
			 * event.time fallback as the fold pre-scan (host frames have no
			 * top-level time; bare f.time made this guard dead code) */
			var fTime = f.time || (f.event && f.event.time);
			if (fTime && Date.now() - fTime > 60000 && bootAt - fTime > 60000) continue;
			if (f.type === 'session/projection') {
				if (f.key === 'title') {
					if (f.sessionId !== activeSessionId()) {
						var v = f.value;
						var title = typeof v === 'string' ? v : (v && typeof v.title === 'string' ? v.title : null);
						if (title) {
							try { sessionTitles.set(f.sessionId, title); rememberTitle(f.sessionId, title); } catch (e) {}
							try {
								var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
								var info = subs && subs.get(f.sessionId);
								if (info && !info.title) info.title = title;
							} catch (e) {}
						}
					}
					continue;
				}
				/* usage + pressure projections: the host sees EVERY session, so
				 * feeding them here keeps 全对话累计/上下文压力 real for
				 * sessions this window never opened (after a reload the DOM
				 * reader only sees the one visible conversation). The ACTIVE
				 * session is skipped — its DOM feed already covers it and must
				 * not race the server values for lastMainSession. */
				if ((f.key === 'tokenUsage' || f.key === 'contextPressure') && f.sessionId !== activeSessionId()) {
					try {
						handleMuxPayload({ type: 'session/projection', sessionId: f.sessionId, key: f.key, value: f.value });
					} catch (e) {}
				}
				continue;
			}
			if (f.type === 'session/event') {
				/* tag the fold markers onto the frame's event for the
				 * forwarder to carry (only for sessions above FOLD_MIN) */
				if (f.event && f.event.type === 'turn/end' && (foldN[f.sessionId] || 0) >= FOLD_MIN) {
					var fr2 = f.event.data && f.event.data.reason && f.event.data.reason.kind;
					if (fr2 === 'completed') {
						if (f.seq !== foldLastSeq[f.sessionId]) f.event.foldSuppress = true;
						else f.event.foldCount = foldN[f.sessionId];
					}
				}
				feedEventFrame(f);
			}
			/* session/jobs frames are intentionally ignored (empty payloads) */
		}
	}

	function poll() {
		fetch('/api/whale-assistant/events').then(function (r) {
			return r.ok ? r.json() : null;
		}).then(function (data) {
			if (data && Array.isArray(data.events)) {
				markServerPoll(true);
				consume(data.events, data.bootId);
			} else {
				/* a non-OK route (plugin gone / auth changed) is exactly the
				 * silent failure the health check exists to surface */
				markServerPoll(false, data ? 'bad-payload' : 'http-not-ok');
			}
		}).catch(function (e) {
			markServerPoll(false, String(e && e.message || e));
		});
	}

	/* start as soon as the boot render settles (1.5s); the first polls still
	 * skip frames that predate the page via the bootAt guards above */
	setTimeout(function () {
		setInterval(poll, POLL_MS);
		poll();
	}, 1500);

	/* test seam: drive the polled-frame gate directly (active-session skip +
	 * cross-channel completion dedup) without waiting for the 3s poll */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._feedEventFrame = feedEventFrame;
	} catch (e) {}
	})();
