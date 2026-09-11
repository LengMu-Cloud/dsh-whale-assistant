/**
 * Alpha adapter (inline module, M5 alpha-compat): synthesizes mux-equivalent
 * event frames from DOM observations. dsh 0.1.2-alpha removed the WebSocket
 * event mux; the web UI is per-request streaming + DOM rendering.
 *
 * The gate POLICY lives in core/chip-gate.js as a pure function (unit
 * tested); this file gathers the facts from the DOM and acts on decisions.
 *
 * Live-verified DOM signals (2026-09-01/02 captures):
 *   - usage chip: "用量 X tok" per finished turn row (+ row timestamp)
 *   - question: [data-tool="ask_user_question"][data-state="running"] in a
 *     [data-chat-call-id] row → question/requested 🤔
 *   - other running tools → tool/call 🔧 (+ a sweep retires them)
 *   - failure: a "本轮运行失败" row while the turn is live → turn/end error
 *   - compaction: the "已压缩 N 条历史记录" banner → one-off bubble notice
 *   - usage bar "输入 X tok · 输出 Y tok" → tokenUsage projection
 *   - context meter "上下文已用 N%" → contextPressure projection
 *
 * NOT detected here any more: turn/start. Every composer-clear heuristic
 * faked an 开工 on DSH's own flow mutations; the server event bus carries
 * the authoritative turn/start for EVERY session (core/server-events.js).
 *
 * Wrapped in an inner IIFE so the early-return (test env) exits the adapter
 * only, not the whale's outer IIFE.
 */
	(function initAlphaAdapter() {
	if (typeof MutationObserver === 'undefined' || typeof window === 'undefined') return;

	/* The real conversation id lives in the app's localStorage keys
	 * (dsh.conversation.chat.session-<uuid> / dsh.conversation.session-<uuid>).
	 * Using it (instead of a placeholder) makes the jump-to-conversation
	 * feature and history records point at the actual session. */
	var FALLBACK_ID = 'session-alpha-active';
	var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;

	function getCurrentSessionId() {
		try {
			/* the app keeps the ACTIVE conversation id here (JSON
			 * {"sessionId":"session-…"}) — authoritative across switches;
			 * the dsh.conversation.* keys below are insertion-ordered caches
			 * and go stale after a jump back to an older conversation */
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

	/* reportTurn() only speaks for sessions registered in subagentSessions —
	 * that map is filled by the subagentTiming PROJECTION frame, so register
	 * once per session before any turn/event is fed. Registering also makes
	 * frames.js fetch the conversation title (real name in notifications). */
	var registeredId = null;
	function ensureRegistered() {
		var sid = getCurrentSessionId();
		if (sid === registeredId) return sid;
		try {
			handleMuxPayload({
				type: 'session/projection',
				sessionId: sid,
				key: 'subagentTiming',
				value: {}
			});
			registeredId = sid;
		} catch (e) {}
		return sid;
	}

	function parseTokNum(text) {
		var m = text.match(/([\d.]+)\s*([KM万]?)/);
		if (!m) return 0;
		var n = parseFloat(m[1]);
		if (m[2] === 'K') n *= 1000;
		else if (m[2] === 'M') n *= 1000000;
		else if (m[2] === '万') n *= 10000;
		return Math.round(n);
	}

	/* read the newest "用量 X tok" chip in the chat flow. Primary selector is
	 * the chip's label class; a text-node sweep is the fallback for when the
	 * app renames its classes (the token panel must not silently vanish
	 * just because a selector went stale — user-reported bug). */
	function readTurnUsage() {
		var flow = document.querySelector('[data-chat-flow]');
		if (!flow) return 0;
		var last = 0;
		var chips = flow.querySelectorAll('[class*="label"]');
		for (var i = 0; i < chips.length; i++) {
			var t = (chips[i].textContent || '').trim();
			if (t.indexOf('用量') === 0) last = parseTokNum(t);
		}
		if (last > 0) return last;
		try {
			var walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, null, false);
			var node;
			while ((node = walker.nextNode())) {
				var s = node.textContent || '';
				var m = /用量\s*([\d.]+\s*[KM万]?)\s*tok/.exec(s);
				if (m) last = parseTokNum(m[1]);
			}
		} catch (e) {}
		return last;
	}

	/* Session-title fallback: the old /api/session.history RPC is gone on
	 * alpha, but the app renders the current conversation title in
	 * document.title ("<title> — DeepSeek Harness"). The title is
	 * LLM-generated AFTER the turn ends, so the first attempt usually
	 * misses — retry until the app sets it, then backfill history records
	 * pushed as 未命名任务. */
	function applyPageTitleFallback(sid, attempt) {
		try {
			var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
			var info = subs && subs.get(sid);
			if (!info || info.title || info.label) return;
			var m = /^([\s\S]+?)\s+—\s+DeepSeek Harness$/.exec(document.title || '');
			if (!(m && m[1] && m[1] !== 'DeepSeek Harness')) {
				if ((attempt || 0) < 4) {
					setTimeout(function () { applyPageTitleFallback(sid, (attempt || 0) + 1); }, 1500);
				}
				return;
			}
			info.title = m[1];
			sessionTitles.set(sid, m[1]);
			rememberTitle(sid, m[1]);
			/* backfill: turn/end already pushed history with the placeholder */
			var changed = false;
			for (var i = 0; i < history.length; i++) {
				var h = history[i];
				if (h.sessionId === sid && h.title === '未命名任务') {
					h.title = m[1];
					changed = true;
				}
			}
			if (changed) safeSet(HISTORY_KEY, history);
		} catch (e) {}
	}

	/* boot: the conversation you reloaded INTO already has its real name in
	 * document.title — feed it eagerly instead of waiting for the first
	 * chip event. A post-清空 reload has no other title source: the prefill
	 * reads the cleared records and title projections only push on change
	 * (09-06 用户报告：清空后首次发送“未命名任务”、再清一次又正常，交替).
	 * Scheduled, not inline: frames-side state is not initialized yet at
	 * IIFE-eval time. */
	function seedActiveTitle(attempt) {
		try {
			var sid = getCurrentSessionId();
			var m = /^([\s\S]+?)\s+—\s+DeepSeek Harness$/.exec(document.title || '');
			var have = sid && m && m[1] && m[1] !== 'DeepSeek Harness';
			if (!have && (attempt || 0) < 6) {
				setTimeout(function () { seedActiveTitle((attempt || 0) + 1); }, 1000);
				return;
			}
			if (have) {
				sessionTitles.set(sid, m[1]);
				rememberTitle(sid, m[1]);
				var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
				var info = subs && subs.get(sid);
				if (info && !info.title) info.title = m[1];
			}
		} catch (e) {}
	}
	setTimeout(function () { seedActiveTitle(0); }, 800);

	function synthOn(sid, eventType, data) {
		try {
			applyPageTitleFallback(sid); /* before the hold timer: reportTurn reads it */
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: eventType, time: Date.now(), data: data || {} }
			});
		} catch (e) {}
	}

	function synth(eventType, data) {
		synthOn(ensureRegistered(), eventType, data);
	}

	/* Session-wide usage + context pressure.
	 * 0.1.2-rc.1: "输入 X tok · 输出 Y tok" + "上下文已用 N%".
	 * 0.1.5-rc.2 (live 2026-09-11): cumulative bar became
	 * "10.8M tok·缓存命中 6%" and the 上下文已用 meter is gone from the
	 * composer strip (per-turn chip "用量 X tok" still works). Keep the
	 * old regexes and add the new total-token form so 全对话累计 does not
	 * silently die after the 0.1.5 stats redesign. */
	function feedSessionUsage(sid) {
		try {
			var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
			var node;
			var usageDone = false;
			var pressureDone = false;
			while ((node = walker.nextNode())) {
				var t = node.textContent || '';
				if (!usageDone) {
					var m = /输入\s*([\d.]+\s*[KM万]?)\s*tok[\s\S]{0,60}?输出\s*([\d.]+\s*[KM万]?)\s*tok/.exec(t);
					if (m) {
						usageDone = true;
						handleMuxPayload({
							type: 'session/projection',
							sessionId: sid,
							key: 'tokenUsage',
							value: { uncachedInputTokens: parseTokNum(m[1]), outputTokens: parseTokNum(m[2]) }
						});
					} else {
						/* 0.1.5: "10.8M tok·缓存命中 6%" — one combined total */
						var m2 = /([\d.]+\s*[KM万]?)\s*tok\s*[·•]?\s*缓存命中/.exec(t);
						if (m2) {
							usageDone = true;
							var total = parseTokNum(m2[1]);
							/* display path only sums uncachedInput+output; put the
							 * whole total on output so the panel shows a real number */
							handleMuxPayload({
								type: 'session/projection',
								sessionId: sid,
								key: 'tokenUsage',
								value: { uncachedInputTokens: 0, outputTokens: total }
							});
						}
					}
				}
				if (!pressureDone) {
					var p = /上下文已用\s*([\d.]+)\s*%/.exec(t);
					if (p) {
						pressureDone = true;
						handleMuxPayload({
							type: 'session/projection',
							sessionId: sid,
							key: 'contextPressure',
							value: { contextWindow: 100, pressureTokens: parseFloat(p[1]) }
						});
					}
				}
				if (usageDone && pressureDone) break;
			}
		} catch (e) {}
	}

	/* How many minutes ago the chip's own row stamp ("…02:17" /
	 * "9月1日 02:17") is. A conversation switch re-renders the WHOLE
	 * log and historical chips flow through this observer — they carry
	 * old stamps; a LIVE turn just ended, so its stamp is fresh. */
	function chipAgeMinutes(text) {
		var now = new Date();
		var m = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/.exec(text);
		if (m) {
			var d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
			if (d.getTime() > Date.now() + 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2], +m[3], +m[4]);
			return (Date.now() - d.getTime()) / 60000;
		}
		m = /(\d{1,2}):(\d{2})\s*$/.exec(text);
		if (m) {
			var d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
			return (Date.now() - d2.getTime()) / 60000;
		}
		return 0; /* no stamp parsed: treat as fresh */
	}

	/* does this batch touch the chat flow at all? (arming is flow-scoped:
	 * typing in the composer or sidebar activity must NOT arm the adapter) */
	function batchInFlow(mutations) {
		for (var i = 0; i < mutations.length; i++) {
			var t = mutations[i].target;
			if (t && t.closest && t.closest('[data-chat-flow]')) return true;
			var added = mutations[i].addedNodes;
			for (var j = 0; j < added.length; j++) {
				var n = added[j];
				var el = n.nodeType === 1 ? n : n.parentElement;
				if (el && el.closest && el.closest('[data-chat-flow]')) return true;
			}
		}
		return false;
	}

	/* --- runtime diagnostic switch: set localStorage 'dsh-whale:debug' to
	 * 'on' (the settings panel toggles it) — captures mutation fingerprints
	 * into the whale-assistant state doc `_debug` key for remote forensics. --- */
	function debugOn() {
		try { return localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) { return false; }
	}
	var attRe = /(允许|拒绝|批准|审核|等待|提问|需要你|approve|deny|reject|ask_user)/i;
	var ringBatches = [];
	var lastAttDumpAt = 0;
	function debugInject(payload) {
		if (!debugOn() || typeof fetch !== 'function') return;
		var attempt = function () {
			fetch('/api/whale-assistant/state').then(function (r) {
				return r.ok ? r.json() : {};
			}).catch(function () { return {}; }).then(function (doc) {
				if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = { v: 1, history: [] };
				doc._debug = payload;
				return fetch('/api/whale-assistant/save', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(doc)
				});
			}).catch(function () {});
		};
		setTimeout(attempt, 2500);
		setTimeout(attempt, 7000);
	}
	function dumpComposer() {
		var out = [];
		try {
			var cands = document.querySelectorAll('textarea, [contenteditable="true"], [class*="input" i], [class*="composer" i], [class*="editor" i]');
			for (var i = 0; i < cands.length && i < 8; i++) {
				var n = cands[i];
				out.push({
					tag: n.tagName,
					cls: String(n.className || '').slice(0, 150),
					ce: n.getAttribute ? n.getAttribute('contenteditable') : null,
					html: (n.outerHTML || '').slice(0, 500)
				});
			}
		} catch (e) {}
		return out;
	}
	function describeEl(n) {
		try {
			return { tag: n.tagName, cls: String(n.className || '').slice(0, 150), html: (n.outerHTML || '').slice(0, 2500) };
		} catch (e) { return { tag: '?', cls: '', html: '' }; }
	}

	/* gate state — consumed/mutated by decideChipAction (core/chip-gate.js) */
	var gate = {
		lastKnownTitle: document.title || '',
		streamingArmed: false,
		armStreak: 0,
		lastArmAt: 0,
		renderUntil: 0,
		turnEndUntil: 0
	};
	var lastChipElement = null; /* dedupe by ELEMENT reference, not text */
	var lastFailureAt = 0; /* failure-row throttle */
	var lastCompactAt = 0; /* compaction-banner throttle */
	var compactSeen = {}; /* sessionId -> last announced 已压缩 N 条历史 count */

	/* alpha tool rows never emit tool/result: a lazy sweep watches each
	 * tracked call's data-state and clears it when the row leaves the
	 * running state (or vanishes in a re-render), so the status hint and
	 * the stuck watchdog settle instead of flagging forever. */
	var seenCallIds = {};
	var pendingTools = {};
	var sweepTimer = null;
	function ensureToolSweep() {
		if (sweepTimer || typeof setInterval !== 'function') return;
		sweepTimer = setInterval(function () {
			for (var id in pendingTools) {
				var state = 'gone';
				try {
					var row = document.querySelector('[data-chat-call-id="' + String(id).replace(/"/g, '') + '"] [data-state]');
					if (row) state = row.getAttribute('data-state') || 'gone';
				} catch (e) {}
				if (state !== 'running') {
					var t = pendingTools[id];
					delete pendingTools[id];
					synthOn(t.sid, 'tool/result', { callId: id });
				}
			}
		}, 2500);
	}

	var observer = new MutationObserver(function (mutations) {
		/* pass 1 — count elements FIRST (cheap refs only): text measurement
		 * is skipped for huge batches (they are renders by definition and
		 * their chips are ignored) — the whole subtree textContent read was
		 * the single most expensive thing on conversation switches */
		var addedElsList = [];
		for (var i = 0; i < mutations.length; i++) {
			var added = mutations[i].addedNodes;
			for (var j = 0; j < added.length; j++) {
				if (added[j].nodeType === 1 && addedElsList.length < 400) addedElsList.push(added[j]);
			}
		}
		var bigCount = addedElsList.length > 60;
		var chips = [];
		var addedChars = 0;
		var removedChars = 0;
		var attNodes = [];
		var runningToolNodes = [];
		if (!bigCount) {
			for (var a = 0; a < addedElsList.length; a++) {
				var node = addedElsList[a];
				var text = node.textContent || '';
				addedChars += text.length;
				if (text.indexOf('用量') >= 0 && text.indexOf('tok') >= 0) {
					var chipEl = node.querySelector ? node.querySelector('[class*="label"]') : null;
					if (!chipEl) chipEl = node;
					chips.push(chipEl);
				}
				/* '运行中' is the hidden label of a tool row in its running
				 * state — a cheap pre-filter before the querySelector below */
				if (runningToolNodes.length < 6 && text.indexOf('运行中') >= 0) runningToolNodes.push(node);
				if (debugOn() && attNodes.length < 4 && attRe.test(text)) attNodes.push(node);
			}
		} else {
			/* big render: still check a bounded slice for RUNNING tool rows
			 * (switching to a conversation whose turn is live) */
			for (var b = 0; b < addedElsList.length && b < 12; b++) {
				var n2 = addedElsList[b];
				if (n2.querySelector && n2.querySelector('[data-tool][data-state="running"]')) runningToolNodes.push(n2);
			}
			addedChars = 99999; /* forces the bulk-render path */
		}
		if (debugOn()) {
			for (var k = 0; k < mutations.length; k++) {
				var removed = mutations[k].removedNodes;
				for (var r = 0; r < removed.length; r++) removedChars += (removed[r].textContent || '').length;
			}
		}
		var inFlow = batchInFlow(mutations);

		if (debugOn()) {
			ringBatches.push({ t: Date.now(), els: addedElsList.length, ch: addedChars, rm: removedChars, fl: inFlow ? 1 : 0, chips: chips.length });
			if (ringBatches.length > 200) ringBatches.shift();
			if (attNodes.length > 0 && Date.now() - lastAttDumpAt > 2000) {
				lastAttDumpAt = Date.now();
				debugInject({ kind: 'attention', at: lastAttDumpAt, title: document.title, matches: attNodes.map(describeEl), composer: dumpComposer(), batches: ringBatches.slice(-80) });
			}
		}

		var now = Date.now();

		/* attention + tool status (live-verified): ask_user_question running
		 * = the turn is BLOCKED waiting for the user → question/requested 🤔.
		 * Any OTHER running tool = live tool status 🔧. Historical rows
		 * re-render with a non-running state, so re-renders never re-fire;
		 * the call id dedupes the spinner's own childList churn.
		 * SWITCH GUARD (2026-09-02): a conversation switch re-renders the
		 * pending question row and used to ring a SECOND 🤔 right after the
		 * background channel's own — now a batch that belongs to a switch
		 * (title just changed, or inside a render tail) never rings, and a
		 * callId the background channel already announced (shared
		 * __dshWhale.attSeen) is skipped too. */
		var switchRender = (document.title || '') !== gate.lastKnownTitle || now < gate.renderUntil;
		for (var q = 0; q < runningToolNodes.length; q++) {
			var trow = runningToolNodes[q].querySelector('[data-tool][data-state="running"]');
			if (!trow && runningToolNodes[q].matches && runningToolNodes[q].matches('[data-tool][data-state="running"]')) {
				trow = runningToolNodes[q];
			}
			if (!trow) continue;
			var tool = trow.getAttribute('data-tool') || '';
			var callRow = trow.closest ? trow.closest('[data-chat-call-id]') : null;
			var callId = (callRow && callRow.getAttribute('data-chat-call-id')) || (tool + ':' + (trow.textContent || '').slice(0, 60));
			var sharedAttSeen = null;
			try { sharedAttSeen = window.__dshWhale && window.__dshWhale.attSeen; } catch (e) {}
			if (seenCallIds[callId] || switchRender || (sharedAttSeen && sharedAttSeen[callId])) continue;
			seenCallIds[callId] = 1;
			capObj(seenCallIds, 200); /* memory audit: one entry per question row ever rendered */
			var idKeys = Object.keys(seenCallIds);
			if (idKeys.length > 80) delete seenCallIds[idKeys[0]];
			var attSid = ensureRegistered();
			if (tool === 'ask_user_question') {
				handleMuxPayload({ type: 'question/requested', sessionId: attSid, time: now });
			} else {
				pendingTools[callId] = { sid: attSid, name: tool, at: now };
				ensureToolSweep();
				synthOn(attSid, 'tool/call', { name: tool, callId: callId });
			}
		}

		/* failure + compaction rows (small live batches only, armed):
		 * run AFTER the pure gate so renders/cooldowns can't echo them.
		 * NOTE: turn/start is NOT synthesized here any more — the composer
		 * heuristic faked 开工 whenever DSH's own flow mutations (timestamp
		 * refreshes, lazy rows) landed inside the confirmation window; the
		 * server event bus now owns start announcements for every session. */
		var decision = decideChipAction(gate, {
			now: now,
			title: document.title || '',
			addedEls: addedElsList.length,
			addedChars: addedChars,
			chipCount: chips.length,
			inFlow: inFlow
		});

		/* failure rows: "本轮运行失败 5xx …" — only while the turn is LIVE
		 * (streamingArmed); retries can emit several rows, so throttle */
		if (!bigCount && decision.action !== 'skip-render' && streamingFailureCheck(mutations)) {
			/* handled inside the check */
		}

		function streamingFailureCheck(muts) {
			if (now - lastFailureAt < 15000 || !gate.streamingArmed) return false;
			for (var fi = 0; fi < muts.length; fi++) {
				var fadded = muts[fi].addedNodes;
				for (var fj = 0; fj < fadded.length; fj++) {
					var fnode = fadded[fj];
					if (fnode.nodeType !== 1) continue;
					var ftext = fnode.textContent || '';
					if (ftext.indexOf('本轮运行失败') >= 0 || ftext.indexOf('已达到每') >= 0) {
						lastFailureAt = now;
						gate.streamingArmed = false;
						gate.armStreak = 0;
						seeEndFire(getCurrentSessionId(), 'fail');
						synth('turn/end', { reason: { kind: 'error' } });
						return true;
					}
				}
			}
			return false;
		}

		/* compaction banner: "已压缩 N 条历史记录". The banner is PART of the
		 * rendered log — a conversation switch re-renders it, which used to
		 * pop a 🧹 bubble AND count into the unread badge (user-reported
		 * bug). Now: only a LIVE stream (streamingArmed) may announce, the
		 * banner's N is deduped per session (announce only when N grows),
		 * and it never enters the unread queue — bubble only, no badge. */
		if (!bigCount && gate.streamingArmed && now - lastCompactAt > 600000) {
			for (var ci = 0; ci < addedElsList.length; ci++) {
				var ctext = addedElsList[ci].textContent || '';
				var cm = /已压缩\s*(\d+)\s*条历史/.exec(ctext);
				if (cm) {
					var csid = ensureRegistered();
					var cN = parseInt(cm[1], 10) || 0;
					if (compactSeen[csid] !== cN) {
						compactSeen[csid] = cN;
						capObj(compactSeen, 100); /* memory audit */
						lastCompactAt = now;
						try { say('🧹 上下文刚被压缩：更早的对话已折叠', 4500, csid); } catch (e) {}
					}
					break;
				}
			}
		}

		if (decision.action === 'skip-render' || decision.action === 'skip') {
			if (chips.length) lastChipElement = chips[chips.length - 1];
			return;
		}
		if (decision.action === 'arm') {
			return;
		}
		/* action === 'chip': the single live finish */
		if (bigCount) renderUntilTail();
		function renderUntilTail() { gate.renderUntil = Math.max(gate.renderUntil, now + 2500); }
		var chip = chips[0];
		if (chip === lastChipElement) return; /* same element re-delivered */
		lastChipElement = chip;
		/* freshness gate: the chip's own row carries its stamp; anything
		 * older than 10 minutes is a re-rendered history row */
		var row = chip;
		var flow = row.closest ? row.closest('[data-chat-flow]') : null;
		if (flow) { while (row.parentElement && row.parentElement !== flow) row = row.parentElement; }
		var age = chipAgeMinutes((row.textContent || '') + ' ' + (chip.textContent || ''));
		if (age > 10) return;
		var turnTokens = readTurnUsage();
		/* health sample: a REAL turn finish with nothing read is one strike
		 * against the usage selector (3 in a row = degraded, see health.js) */
		recordUsageHealth(turnTokens > 0);
		if (turnTokens > 0) turnTokenUsage = turnTokens;
		var sid = ensureRegistered();
		feedSessionUsage(sid); /* cumulative burn for the status panel */
		/* the stats node may render a beat after the chip: re-feed once */
		setTimeout(function () { feedSessionUsage(getCurrentSessionId()); }, 800);
		/* mirror guard (09-06 B3): the polled frame may have announced this
		 * same end first (active-session completed now passes the poll gate);
		 * an ±8s match means one physical end — stay silent, keep the usage */
		if (endFiredFor(sid, 'success', Date.now(), 8000)) return;
		seeEndFire(sid, 'success');
		synth('turn/end', { reason: { kind: 'success' } });
		if (debugOn()) debugInject({ kind: 'turn-end', at: Date.now(), title: document.title, composer: dumpComposer(), batches: ringBatches.slice(-150) });
	});

	/* observe BODY, not the flow node: creating/switching conversations
	 * replaces [data-chat-flow] entirely, which would leave a flow-scoped
	 * observer detached (notifications silently die after any switch).
	 * The callback filters cheaply, so the wider scope costs little. */
	function attach() {
		/* the page-load render of the active conversation must never count
		 * as live activity: start in the cooldown window, unarmed */
		gate.renderUntil = Date.now() + 2500;
		observer.observe(document.body, { childList: true, subtree: true });
		ensureRegistered(); /* register now so the title fetch races early */
		/* initial usage + context-pressure read (the load render already
		 * put the stats bar / context meter on screen) */
		setTimeout(function () { feedSessionUsage(getCurrentSessionId()); }, 1200);
	}
	attach();
	})();
