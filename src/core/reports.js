
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
	/** Per-session burn (用户报告 09-20): the single global counter above is
	 * clobbered by ANY session's turn/start — back-to-back quick tasks made
	 * a completion report read 0 and lose its 此次 line right before render
	 * (面板只剩压力行，甚至整块消失). The map keeps every session's running
	 * turn honest regardless of who started later; sessionTurnTokens() is
	 * the only read the report paths use. Capped like the other maps. */
	var turnTokensBySession = new Map();

	function sessionTurnTokens(sessionId) {
		var t = turnTokensBySession.get(sessionId);
		if (t != null) return t;
		/* legacy fallback: the global counter when it still carries THIS
		 * session's burn (events seen before the map existed) */
		return (turnTokenSession === sessionId) ? turnTokenUsage : 0;
	}

	function addSessionTurnTokens(sessionId, add) {
		turnTokensBySession.set(sessionId, (turnTokensBySession.get(sessionId) || 0) + add);
		if (turnTokensBySession.size > 20) {
			turnTokensBySession.delete(turnTokensBySession.keys().next().value);
		}
	}

	/** Late-projection backfill (same 用户报告): the tokenUsage/
	 * contextPressure projections can land AFTER turn/end — a panel rendered
	 * before them shows missing lines, or nothing at all. armEndBackfill
	 * remembers the end panel's deadline (the bubble's lifetime) and
	 * backfillEndPanel re-renders it — same deadline — when the missing
	 * projection finally arrives. */
	var endPanelBackfill = null;

	function armEndBackfill(sessionId, lines) {
		endPanelBackfill = { sessionId: sessionId, deadline: Date.now() + DURATION_END, lines: lines };
	}

	function backfillEndPanel(sessionId) {
		if (!endPanelBackfill || endPanelBackfill.sessionId !== sessionId) return;
		var now = Date.now();
		if (now >= endPanelBackfill.deadline) { endPanelBackfill = null; return; }
		var rep = statusReport(sessionTurnTokens(sessionId), sessionTotalTokens(sessionId), sessionPressure.get(sessionId));
		if (!rep || rep.lines.length <= endPanelBackfill.lines) return;
		endPanelBackfill.lines = rep.lines.length;
		showStatusPanel(rep, Math.max(1500, endPanelBackfill.deadline - now));
		if (endPanelBackfill.lines >= 3) endPanelBackfill = null;
	}
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
		if (pressure) {
			var pct = pressurePercentOf(pressure); /* null = no honest reading: skip the line */
			if (pct !== null) {
				lines.push('上下文已用 ' + pct + '%');
			}
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
			turnTokens: snapshot === false ? null : sessionTurnTokens(sessionId),
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
