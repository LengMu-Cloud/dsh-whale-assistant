	/* ------------------------------------------------------------------ */
	/**
	 * Status panel: an independent surface placed LEFT or BELOW the whale
	 * (whichever side has room), so live tool status and the per-task
	 * token/pressure report NEVER collide with the speech bubble
	 * (notifications) or the click summary.
	 */
	var statusEl = null;

	function ensureStatusEl() {
		if (statusEl) return statusEl;
		if (!whale) return null;
		var el = document.createElement('div');
		el.className = 'dsh-whale-status';
		whale.appendChild(el);
		statusEl = el;
		return el;
	}

	/** Pick the panel side from the whale's current position: BELOW when
	 * there is room under it, otherwise LEFT of it. The panel's width is
	 * capped by the space available on that side minus a margin from the
	 * viewport edge, so it NEVER touches the screen edge and the open text
	 * re-flows (wraps) live while the whale moves. */
	function updateStatusPos() {
		var el = statusEl;
		if (!el || !whale) return;
		var below = window.innerHeight - (whale.offsetTop + whale.offsetHeight);
		var wl = whale.offsetLeft;
		var w = whale.offsetWidth;
		var maxW;
		el.classList.toggle('dsh-whale-status-below', below >= 80);
		if (below >= 80) {
			/* under the whale, left-aligned, expanding right — keep a 16px
			 * margin from the viewport's right edge */
			el.classList.remove('dsh-whale-status-leftflip');
			maxW = Math.max(60, Math.min(280, window.innerWidth - wl - 4 - 16));
		} else {
			/* side panel: LEFT of the whale by default, flip to its RIGHT
			 * when there is no room on the left */
			var flip = wl < 140;
			el.classList.toggle('dsh-whale-status-leftflip', flip);
			maxW = flip
				? Math.max(60, Math.min(280, window.innerWidth - (wl + w) - 16))
				: Math.max(60, Math.min(280, wl - 20));
		}
		el.style.maxWidth = maxW + 'px';
		applyStatusText();
	}

	/** Current panel content: { prefix, lines } — kept so the text can be
	 * re-flowed live while the whale moves. */
	var statusCache = null;

	/** Rough pixel width of a text line at 11px (CJK ≈ 11px, ASCII ≈ 6px). */
	function estWidth(s) {
		var w = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			w += (c > 255 || (c >= 0x2e80 && c <= 0xffef)) ? 11 : 6;
		}
		return w + 18; /* padding + border */
	}

	/** Fit the cached content: one compact line when it fits, otherwise
	 * one line per item (narrow space wraps into more lines). */
	function applyStatusText() {
		var el = statusEl;
		if (!el || !statusCache) return;
		var maxW = parseFloat(el.style.maxWidth) || 280;
		var compact = statusCache.prefix + statusCache.lines.join(' · ');
		el.textContent = estWidth(compact) <= maxW ? compact : statusCache.prefix + statusCache.lines.join('\n');
	}

	function showStatusPanel(data, ms) {
		var el = ensureStatusEl();
		if (!el) return;
		statusCache = typeof data === 'string'
			? { prefix: '', lines: [data] }
			: data;
		updateStatusPos();
		el.classList.remove('show');
		void el.offsetWidth;
		el.classList.add('show');
		clearTimeout(showStatusPanel.timer);
		showStatusPanel.timer = setTimeout(function () {
			el.classList.remove('show');
		}, ms || 4000);
	}

	/** Hide the panel immediately (a report with NO data must not leave a
	 * stale panel on screen). */
	function hideStatusPanel() {
		var el = statusEl;
		if (!el) return;
		el.classList.remove('show');
		clearTimeout(showStatusPanel.timer);
	}

	/** Busy flag: a turn is running — the panel (if visible) gets a subtle
	 * pulsing emphasis until the turn ends. Pure visual, zero behaviour.
	 * ensureStatusEl() is used so a start that precedes any panel creation
	 * still gets the class; the panel is opacity:0 until first shown. */
	function markStatusBusy(busy) {
		var el = statusEl || (busy ? ensureStatusEl() : null);
		if (!el) return;
		if (busy) el.classList.add('dsh-whale-status-busy');
		else el.classList.remove('dsh-whale-status-busy');
	}

	/** Status bubbles (tool calls, steps) are throttled so a busy agent
	 * never turns the panel into a strobe light; they never unread/bell. */
	var STATUS_GAP_MS = 2000;
	var lastStatusAt = 0;

	function showStatus(text, ms) {
		var now = Date.now();
		if (now - lastStatusAt < STATUS_GAP_MS) return;
		lastStatusAt = now;
		showStatusPanel(text, ms);
	}

	/* context pressure + session-wide token usage PER MAIN SESSION
	 * (projections are pushed live) */
	var sessionUsage = new Map();
	var sessionPressure = new Map();
	var lastMainSession = null;
	var pressureWarned = false;
	var PRESSURE_WARN_PCT = 70;
	var PRESSURE_RESET_PCT = 50;

	function fmtTokens(n) {
		n = Number(n) || 0;
		if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
		if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
		return String(n);
	}

	function pressurePct() {
		var p = lastMainSession ? sessionPressure.get(lastMainSession) : null;
		if (!p || !p.contextWindow) return null;
		return Math.round((p.pressureTokens || 0) / p.contextWindow * 100);
	}

	/** One-shot warning when the context fills up; re-arms after relief. */
	function maybeWarnPressure() {
		var pct = pressurePct();
		if (pct === null) return;
		var warnAt = (typeof CONFIG === 'object' && CONFIG && CONFIG.pressureWarnPct) || PRESSURE_WARN_PCT;
		if (pct >= warnAt && !pressureWarned) {
			pressureWarned = true;
			say('上下文快挤爆了…建议 /compact 🫠', 5200);
		} else if (pct < PRESSURE_RESET_PCT) {
			pressureWarned = false;
		}
	}

	/** Pressure -> border color (pure): 0% is blue-grey, 100% is deep red.
	 * Returns an rgba() string. Exported as a pure function for tests. */
	function pressureColor(pct) {
		var t = Math.max(0, Math.min(1, (pct || 0) / 100));
		var r = Math.round(99 + (239 - 99) * t);
		var g = Math.round(150 - 90 * t);   /* 150 -> 60 */
		var b = Math.round(255 - 175 * t);  /* 255 -> 80 */
		return 'rgba(' + r + ',' + g + ',' + b + ',0.45)';
	}

	/** Drive the panel's border from the live context pressure.
	 * Primary path: a CSS variable + color-mix in the stylesheet (smooth
	 * transition). Fallback (color-mix unsupported): JS sets border-color
	 * directly via pressureColor(). */
	function applyPressureHue() {
		var pct = pressurePct();
		if (pct === null) return;
		var root = document.documentElement;
		if (root && root.style && root.style.setProperty) {
			root.style.setProperty('--dsh-whale-pressure', String(pct));
		}
		var supportsMix = (typeof CSS !== 'undefined' && CSS.supports &&
			CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'));
		var panel = statusEl || ensureStatusEl();
		if (!panel) return;
		if (!supportsMix) panel.style.borderColor = pressureColor(pct);
	}

	/* ------------------------------------------------------------------ */
	/* Long-task run timer (#1+#2): after 2 minutes of a running turn the
	 * status panel gains a live "⏳ [对话名] mm:ss" row — silence must
	 * never read as a hang. 09-06 多任务归属（用户拍板）: ONE SLOT PER
	 * RUNNING SESSION and every row carries the session name — the old
	 * single "newest start wins" slot could not say whose time was
	 * running. Subtask completions count per session. No bubble, no bell,
	 * no unread: the tick re-arms a ~1s panel lifetime, so a turn end
	 * that carries no report still can't leave the rows hanging. */
	/* ------------------------------------------------------------------ */
	var RUNTIMER_MIN_MS = 120000;
	var runSlots = new Map(); /* sessionId -> startAtMs; insertion order = start order */
	var runTimerId = null;

	/** Pure: the timer line for an elapsed time + completed-subtask count,
	 * or null while the run is still too young to show. Exported for tests. */
	function runTimerLine(elapsedMs, doneCount) {
		if (elapsedMs < RUNTIMER_MIN_MS) return null;
		var s = Math.floor(elapsedMs / 1000);
		var mm = Math.floor(s / 60);
		var ss = s % 60;
		var line = '⏳ 已运行 ' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
		if (doneCount > 0) line += ' · 已完成 ' + doneCount + ' 个子任务';
		return line;
	}

	/** Cap a session name to a rough pixel budget (CJK ≈11px, ASCII ≈6px
	 * at the panel's 11px font) so a row can never blow the ~280px panel —
	 * long titles get a '…' suffix. */
	function capNameWidth(name, budget) {
		if (estWidth(name) - 18 <= budget) return name;
		var w = 11; /* reserved for the '…' suffix */
		var cut = '';
		for (var i = 0; i < name.length; i++) {
			w += name.charCodeAt(i) > 255 ? 11 : 6;
			if (w > budget) break;
			cut += name.charAt(i);
		}
		return cut + '…';
	}

	/** One display row for a running session. The name rides the tick's
	 * 1s re-render, so a title arriving late replaces 未命名任务 on its
	 * own; "已运行" makes room for the name (⏳ + a live clock already
	 * say "running"). */
	function timerRowText(sessionId, now) {
		var startAt = runSlots.get(sessionId);
		if (startAt == null) return null;
		var line = runTimerLine(now - startAt, countJobsCompleted(sessionId, startAt));
		if (line === null) return null;
		var name = sessionTitles.get(sessionId) || bookTitle(sessionId) || '未命名任务';
		return line.replace('⏳ 已运行', '⏳ [' + capNameWidth(name, 110) + ']');
	}

	/** How many main turns are running RIGHT NOW. Turns already mid-flight
	 * at page load never got a slot, so sessions with outstanding tool
	 * calls count too (⏳ rows and 🔧/📋 naming share this definition). */
	function runningSessionCount() {
		if (runSlots.size >= 2) return runSlots.size;
		var seen = {};
		runSlots.forEach(function (startAt, sid) { seen[sid] = 1; });
		toolSlot.forEach(function (slot) { if (slot && slot.sessionId) seen[slot.sessionId] = 1; });
		return Object.keys(seen).length;
	}

	/** '[对话名]' prefix for live status lines (🔧/📋): a single running
	 * task stays clean, concurrent tasks can be told apart. */
	function multiRunTag(sessionId) {
		if (runningSessionCount() < 2) return '';
		var name = sessionTitles.get(sessionId) || bookTitle(sessionId) || '未命名任务';
		return '[' + capNameWidth(name, 110) + ']';
	}

	function runTimerTick() {
		if (runSlots.size === 0) return;
		/* never trample a live NON-timer panel (token report, tool hint):
		 * the tick yields and resumes once that panel expires */
		if (statusEl && statusEl.classList.contains('show') && !(statusCache && statusCache._timer)) return;
		var now = Date.now();
		var rows = [];
		runSlots.forEach(function (startAt, sid) {
			var r = timerRowText(sid, now);
			if (r) rows.push(r);
		});
		if (rows.length === 0) return;
		/* prefix stays empty: applyStatusText joins rows with ' · ' while
		 * they fit the panel and stacks them one per line once they don't */
		showStatusPanel({ prefix: '', lines: rows, _timer: true }, 1100);
	}

	function startRunTimer(sessionId, startAtMs) {
		runSlots.set(sessionId, startAtMs || Date.now());
		if (!runTimerId) runTimerId = setInterval(runTimerTick, 1000);
	}

	function stopRunTimer(sessionId) {
		/* only the ended session's row goes; other runs keep ticking */
		if (!sessionId || !runSlots.has(sessionId)) return;
		runSlots.delete(sessionId);
		if (runSlots.size === 0 && runTimerId) {
			clearInterval(runTimerId);
			runTimerId = null;
		}
	}

