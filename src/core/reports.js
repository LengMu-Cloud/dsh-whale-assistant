
	function say(text, duration, sessionId) {
		if (uiReady) uiSay(text, duration, sessionId);
		else pendingSay.push({ text: text, duration: duration, sessionId: sessionId });
	}

	/** Unread job-report count: accumulates reports, one click reads one. */
	var reportQueue = [];
	/** The report currently being replayed from a click (still counts in the badge). */
	var reading = null;
	/** Dedicated timer resolving `reading` — never tied to the bubble's own hide. */
	var readTimer = null;
	/** UI hook set by uiInit; receives the current unread count. */
	var onUnreadChange = null;

	/** Badge = queued reports + the one being read right now. */
	function renderUnread() {
		if (onUnreadChange) onUnreadChange(reportQueue.length + (reading ? 1 : 0));
	}

	/** Tokens burned by the CURRENT task (one conversation turn): reset at
	 * turn/start, accumulated from each assistant/message usage, reported at
	 * turn/end — never the session-wide total. */
	var turnTokenUsage = 0;
	/** Which session the burn above belongs to. The counter is global, so
	 * with two sessions running at once the number can be another
	 * conversation's — the attention panel only quotes it when the tag
	 * matches the asking session, otherwise it shows cumulative-only. */
	var turnTokenSession = null;
	/** debug counters (diagnostics only). */
	var debugCounters = { assistantMsgs: 0, usageEvents: 0, usageSum: 0 };

	/** Session-wide token total for a main session (from the tokenUsage projection). */
	function sessionTotalTokens(sessionId) {
		var usage = sessionUsage.get(sessionId);
		if (!usage) return 0;
		return (usage.uncachedInputTokens || 0) +
			(usage.outputTokens || 0) +
			(usage.cacheReadTokens || 0) +
			(usage.cacheWriteTokens || 0);
	}

	/** Compose the status-panel report: THIS task's burn, the conversation's
	 * cumulative burn, and the context pressure — each its own line, joined
	 * into ONE line when the panel has room (see applyStatusText). */
	function statusReport(turnTokens, sessionTokens, pressure) {
		var lines = [];
		if (typeof turnTokens === 'number' && turnTokens > 0) {
			lines.push('此次任务消耗 ' + fmtTokens(turnTokens) + ' tokens');
		}
		if (typeof sessionTokens === 'number' && sessionTokens > 0) {
			lines.push('全对话累计消耗 ' + fmtTokens(sessionTokens) + ' tokens');
		}
		if (pressure && pressure.contextWindow) {
			var pct = Math.round((pressure.pressureTokens || 0) / pressure.contextWindow * 100);
			lines.push('上下文已用 ' + pct + '%');
		}
		return lines.length > 0 ? { prefix: '📊 ', lines: lines } : null;
	}

	/** The report currently displayed in the bubble (the latest push, or the
	 * one being replayed from a click). Double-clicking the bubble to jump
	 * marks THIS report read — it leaves the unread queue and the badge
	 * drops by one. */
	var lastShownReport = null;

	/** Record one job report for the unread badge (bubble is shown by the caller).
	 * `snapshot === false` stores NO token/pressure data (used for the
	 * turn/start report — a task that just started has nothing to report).
	 * `endTime` (ms epoch of the moment this report is about) powers the
	 * double-click jump: the bubble jump pages the log back to THAT moment. */
	function pushReport(text, duration, sessionId, snapshot, endTime) {
		/* snapshot the task's token/pressure with the report, so reading it
		 * later can re-show the same numbers. The per-turn burn is only
		 * snapshotted when it belongs to THIS session (see turnTokenSession) */
		reportQueue.push({
			text: text,
			duration: duration,
			sessionId: sessionId,
			at: Date.now(),
			turnTokens: snapshot === false ? null :
				(turnTokenSession === sessionId ? turnTokenUsage : null),
			sessionTokens: snapshot === false ? null : sessionTotalTokens(sessionId),
			pressure: snapshot === false ? null : sessionPressure.get(sessionId),
			endTime: typeof endTime === 'number' ? endTime : null
		});
		/* generous bound: the badge must keep accumulating long past 20 */
		if (reportQueue.length > REPORT_QUEUE_CAP) reportQueue.shift();
		lastShownReport = reportQueue[reportQueue.length - 1];
		currentSaySession = sessionId || null;
		renderUnread();
	}

	/** Read the newest report: pop it, show it, resolve `reading` on its own timer. */
	function readNext() {
		if (reportQueue.length === 0) return false;
		var item = reportQueue.pop();
		reading = item;
		lastShownReport = item;
		renderUnread();
		/* a click-replay is short: no need to hold the bubble for the full report duration */
		var showMs = Math.min(item.duration || 5000, 3500);
		uiSay(item.text, showMs, item.sessionId);
		/* the report's token/pressure re-appear in the status panel */
		var rep = statusReport(item.turnTokens, item.sessionTokens, item.pressure);
		// KNOWN-COUPLING: reports->status-panel — push render (the 1:1 panel pairing: a report with data opens the panel, one without closes it)
		if (rep) showStatusPanel(rep, DURATION_END);
		else hideStatusPanel(); /* a report without data must not leave the panel up */
		clearTimeout(readTimer);
		readTimer = setTimeout(function () {
			if (reading === item) {
				reading = null;
				renderUnread();
			}
		}, showMs);
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* Completion ding: a synthesized "叮" via Web Audio (no assets).      */
