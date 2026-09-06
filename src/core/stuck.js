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

	/** Periodic sweep (also called directly by tests). */
	function scanStuckTools() {
		var now = Date.now();
		var worst = null; /* { sessionId, seconds, key } */
		toolSlot.forEach(function (slot, key) {
			var elapsed = now - slot.at;
			if (elapsed < CONFIG.toolStuckMs) return;
			if (sessionHasRunningJob(slot.sessionId)) return; /* live job: not stuck */
			if (!worst || elapsed > worst.elapsed) {
				worst = { sessionId: slot.sessionId, seconds: Math.round(elapsed / 1000), key: key, elapsed: elapsed };
			}
		});
		if (worst) {
			showStuckHint(worst.sessionId, worst.seconds);
		} else {
			hideStuckHint();
		}
	}

	/** Show/refresh the stuck hint in the status panel. */
	function showStuckHint(sessionId, seconds) {
		if (!stuckActive) {
			stuckActive = true;
			ensureStatusEl().classList.add('dsh-whale-status-stuck');
		}
		showStatusPanel(multiRunTag(sessionId) + '⚠️ 工具运行中（' + seconds + 's）', 3000);
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