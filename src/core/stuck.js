/**
 * Tool-stuck detection (inline module).
 *
 * Tool calls are SINGLE frames on the mux (no heartbeat while a slow job
 * runs), so a bare time-based watchdog would mis-flag legitimate long jobs
 * (e.g. `Start-Sleep 30`). Rule: a tool call is only "stuck" when it has
 * been pending longer than CONFIG.toolStuckMs AND its session currently has
 * NO running/stopping job. A running job is its own proof of liveness.
 *
 * toolSlot: callId -> { at, sessionId }   (populated by core/frames.js)
 * clearSessionTools / clearTool are called from tool/result and turn/end.
 */

	var toolSlot = new Map(); /* callKey -> { at, sessionId } */
	var STUCK_SCAN_MS = 2000;
	var stuckActive = false; /* any stuck hint currently visible */

	/** Garbage-independent lookup: is any known job for this session live? */
	function sessionHasRunningJob(sessionId) {
		var live = false;
		known.forEach(function (view) {
			if (view.sessionId === sessionId && (view.status === 'running' || view.status === 'stopping')) {
				live = true;
			}
		});
		return live;
	}

	/** Record a tool call (called from tool/call handling). */
	function trackToolCall(callKey, sessionId) {
		toolSlot.set(callKey, { at: Date.now(), sessionId: sessionId });
	}

	/** Clear ONE tool call (tool/result). */
	function clearTool(callKey) {
		toolSlot.delete(callKey);
		refreshStuck();
	}

	/** Clear every tool call of a session (turn/end fallback). */
	function clearSessionTools(sessionId) {
		var dirty = false;
		toolSlot.forEach(function (slot, key) {
			if (slot.sessionId === sessionId) {
				toolSlot.delete(key);
				dirty = true;
			}
		});
		if (dirty) refreshStuck();
	}

	/** Periodic sweep (also called directly by tests). EVERY session with a
	 * pending tool past the threshold gets its own row, worst first —
	 * 09-12 用户拍板: 多会话逐行并列、每行都带会话名（和 ⏳ 计时一样可归属）。
	 * Entries older than 10× the threshold are ZOMBIES (their tool/result
	 * or turn/end cleanup signal was missed, e.g. frames dropped around a
	 * reload) and self-delete — a hang warning nobody can act on after
	 * minutes is noise, 用户报告 09-12. */
	function scanStuckTools() {
		var now = Date.now();
		var zombieMs = Math.max((CONFIG.toolStuckMs || 30000) * 10, 300000);
		var worstBySession = {}; /* sessionId -> { elapsed, seconds } (one row per session even if several calls hang) */
		toolSlot.forEach(function (slot, key) {
			var elapsed = now - slot.at;
			if (elapsed >= zombieMs) { toolSlot.delete(key); return; }
			if (elapsed < CONFIG.toolStuckMs) return;
			if (sessionHasRunningJob(slot.sessionId)) return; /* live job: not stuck */
			var cur = worstBySession[slot.sessionId];
			if (!cur || elapsed > cur.elapsed) {
				worstBySession[slot.sessionId] = { elapsed: elapsed, seconds: Math.round(elapsed / 1000) };
			}
		});
		var sids = Object.keys(worstBySession);
		if (sids.length === 0) {
			hideStuckHint();
			return;
		}
		sids.sort(function (a, b) { return worstBySession[b].elapsed - worstBySession[a].elapsed; });
		var rows = sids.map(function (sid) {
			var name = sessionTitles.get(sid) || bookTitle(sid) || '未命名任务';
			return '⚠️ [' + capNameWidth(name, 110) + '] 工具已运行 ' + worstBySession[sid].seconds + 's';
		});
		showStuckHint(rows);
	}

	/** Show/refresh the stuck hint in the status panel. rows are per-session
	 * lines; _stacked forces one-per-line (并列显示, user request 09-12). */
	function showStuckHint(rows) {
		if (!stuckActive) {
			stuckActive = true;
			ensureStatusEl().classList.add('dsh-whale-status-stuck');
		}
		/* _stuck: self-identify so the displaced-report guard in
		 * status-panel.js never routes the hint itself into reportEl */
		showStatusPanel({ prefix: '', lines: rows, _stacked: true, _stuck: true }, 3000);
	}

	/** Hide the stuck hint when nothing is pending anymore. */
	function hideStuckHint() {
		if (!stuckActive) return;
		stuckActive = false;
		var el = ensureStatusEl();
		el.classList.remove('dsh-whale-status-stuck');
	}

	/** Unstick when an explicit result/end cleared the slot. */
	function refreshStuck() {
		if (!stuckActive) return;
		if (toolSlot.size === 0) {
			hideStuckHint();
			return;
		}
		scanStuckTools(); /* re-evaluate the remaining slots */
	}

	/* the periodic sweep is armed once at startup */
	{
		setInterval(scanStuckTools, STUCK_SCAN_MS);
	}

	/* seams for server-events: background sessions' tool frames are not
	 * forwarded (they would flicker the 🔧 panel for work the user isn't
	 * watching) but their tools must still be tracked for the stuck
	 * watchdog — 09-12 多会话并列的前提是每个会话的工具都在册。
	 * _stuckPending: the report box asks whether the ⚠️ hint currently owns
	 * the main panel (displacement routing, status-panel.js). */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._trackTool = trackToolCall;
		window.__dshWhale._clearTool = clearTool;
		window.__dshWhale._stuckPending = function () { return stuckActive; };
	} catch (e) {}