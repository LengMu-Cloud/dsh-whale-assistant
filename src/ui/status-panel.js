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
	 * there is room under it, ABOVE the whale when the whale hugs the screen
	 * bottom edge (below would clip off-screen, 用户报告 09-12), otherwise
	 * LEFT of it (flip to its RIGHT when there is no room on the left). The
	 * panel's width is capped by the space available on that side minus a
	 * margin from the viewport edge, so it NEVER touches the screen edge and
	 * the open text re-flows (wraps) live while the whale moves. */
	function updateStatusPos() {
		var el = statusEl;
		if (!el || !whale) return;
		var below = window.innerHeight - (whale.offsetTop + whale.offsetHeight);
		var wl = whale.offsetLeft;
		var w = whale.offsetWidth;
		var maxW;
		/* below needs (12px gap + content height) of real estate; a taller
		 * panel than the viewport can take flips ABOVE the whale instead */
		var estH = (statusCache ? statusCache.lines.length : 1) * 16 + 14;
		var above = below >= 80 && whale.offsetTop + whale.offsetHeight + 12 + estH > window.innerHeight;
		el.classList.toggle('dsh-whale-status-above', above);
		el.classList.toggle('dsh-whale-status-below', below >= 80 && !above);
		if (above || below >= 80) {
			/* under/over the whale, left-aligned, expanding right — keep a
			 * 16px margin from the viewport's right edge */
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
	 * one line per item (narrow space wraps into more lines). A `_stacked`
	 * cache (multi-session stuck hint) ALWAYS renders one line per row —
	 * 用户拍板 09-12: 多会话并列显示不合并。 */
	function applyStatusText(el, cache) {
		var box = el || statusEl;
		var data = cache || statusCache;
		if (!box || !data) return;
		var maxW = parseFloat(box.style.maxWidth) || 280;
		if (data._stacked) {
			box.textContent = data.prefix + data.lines.join('\n');
			return;
		}
		var compact = data.prefix + data.lines.join(' · ');
		box.textContent = estWidth(compact) <= maxW ? compact : data.prefix + data.lines.join('\n');
	}

	/** The report's OWN box (用户方案 09-12): while the stuck hint is
	 * pending it owns the main box — a completion report must NOT trample
	 * it, so the report slides in LEFT of the main box instead (fallbacks:
	 * above it when the left edge is reached, then its right). When nothing
	 * is pending the report renders in the main box as before. */
	var reportEl = null;
	var reportCache = null;

	function ensureReportEl() {
		if (reportEl && reportEl.parentNode) return reportEl;
		if (!whale) return null;
		reportEl = document.createElement('div');
		reportEl.className = 'dsh-whale-status dsh-whale-status-report';
		whale.appendChild(reportEl);
		return reportEl;
	}

	function hideReportBox() {
		if (!reportEl) return;
		reportEl.classList.remove('show');
	}

	function stuckPendingNow() {
		try {
			return !!(window.__dshWhale && window.__dshWhale._stuckPending && window.__dshWhale._stuckPending());
		} catch (e) { return false; }
	}

	function showStatusPanel(data, ms) {
		if (stuckPendingNow() && !data._stuck && !data._timer) {
			/* the ⚠️ hint owns the main box right now: slide THIS content in
			 * beside it instead of trampling it (用户方案 09-12) */
			renderDisplaced(data, ms);
			return;
		}
		/* only a real content TAKEOVER clears the side box: when the hint or
		 * the timer rows retake the main box (every 2s sweep / 1s tick) a
		 * displaced report must keep living its own lifetime — the sweep
		 * used to murder it on the very next tick (真机 09-12) */
		if (!data._stuck && !data._timer) hideReportBox();
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

	function renderDisplaced(data, ms) {
		var main = statusEl || ensureStatusEl();
		if (!main) return;
		var el = ensureReportEl();
		if (!el) return;
		reportCache = typeof data === 'string'
			? { prefix: '', lines: [data] }
			: data;
		el.classList.toggle('dsh-whale-status-below', main.classList.contains('dsh-whale-status-below'));
		el.classList.toggle('dsh-whale-status-above', main.classList.contains('dsh-whale-status-above'));
		el.classList.toggle('dsh-whale-status-leftflip', main.classList.contains('dsh-whale-status-leftflip'));
		var maxW = parseFloat(main.style.maxWidth) || 280;
		el.style.maxWidth = maxW + 'px';
		applyStatusText(el, reportCache);
		el.classList.add('show');
		/* LEFT of the main box first; above it when the left edge is hit;
		 * its right side as the last resort */
		var left = main.offsetLeft - el.offsetWidth - 8;
		var top = main.offsetTop;
		if (left < 4) {
			left = main.offsetLeft;
			top = main.offsetTop - el.offsetHeight - 8;
		}
		if (top < 0) {
			left = main.offsetLeft + main.offsetWidth + 8;
			top = main.offsetTop;
		}
		el.style.left = left + 'px';
		el.style.top = top + 'px';
		el.style.right = 'auto';
		el.style.bottom = 'auto';
		clearTimeout(renderDisplaced.timer);
		renderDisplaced.timer = setTimeout(hideReportBox, ms || 4000);
	}

	/** Hide the panel immediately (a report with NO data must not leave a
	 * stale panel on screen). The ONLY callers are the bubble's 1:1
	 * lifecycle hooks (bubble.js) and the click-replay guard — none of them
	 * may touch anything while the ⚠️ hint owns the main box: the hint
	 * must not blink off until its sweep refreshes, and a displaced report
	 * in its own box dies on its OWN renderDisplaced timer, not on some
	 * unrelated bubble's (真机 09-12: a say landing inside the displaced
	 * report's 6s window cut it to ~1s). */
	function hideStatusPanel() {
		if (stuckPendingNow()) return;
		hideReportBox();
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
	// KNOWN-COUPLING: frames->status-panel — push projection writes (sessionUsage/sessionPressure are filled by frames on session/projection tokenUsage|contextPressure frames; reports.js reads them back for report snapshots)
	var sessionUsage = new Map();
	var sessionPressure = new Map();
	// KNOWN-COUPLING: frames->status-panel — push projection write (lastMainSession: the frame router keeps the current main session here so the panel knows which session to display)
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

	/** Pure: percent for a contextPressure projection value. Official口径
	 * (the DSH ContextMeter's computeContextOccupancy): projectedTokens
	 * (usage sample + surface drift since) first, pressureTokens fallback,
	 * clamped at 100. A window WITHOUT any token sample returns null — no
	 * sample, no fabricated 0% (the report skips the line, the warning
	 * no-ops). The legacy DOM feed's {contextWindow:100,
	 * pressureTokens:percent} shape works unchanged. Exported for tests;
	 * reports.js reads it too (existing edge, one formula). */
	function pressurePercentOf(p) {
		if (!p || !p.contextWindow) return null;
		var used = p.projectedTokens != null ? p.projectedTokens : (p.pressureTokens != null ? p.pressureTokens : null);
		if (used === null) return null;
		return Math.min(100, Math.round(used / p.contextWindow * 100));
	}

	function pressurePct() {
		return pressurePercentOf(lastMainSession ? sessionPressure.get(lastMainSession) : null);
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
		// KNOWN-COUPLING: status-panel->frames — read-back (countJobsCompleted/bookTitle query functions plus the sessionTitles projection read below; the only direction the panel pulls pipeline data)
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

	/** The timer's OWN box (用户拍板 2026-09-12): while the main box is
	 * occupied by a report / stuck hint / tool line, the tick renders the
	 * ⏳ rows here — below the main box — so a >30s tool hint and a >2min
	 * run timer are readable AT THE SAME TIME instead of trampling each
	 * other. When the main box is free the rows render there (as before)
	 * and this one hides. Position hugs the main box (JS copies its side
	 * classes + top/left every tick), flipping above it when the space
	 * below would leave the viewport. */
	var timerEl = null;

	function ensureTimerEl() {
		if (timerEl && timerEl.parentNode) return timerEl;
		if (!whale) return null;
		timerEl = document.createElement('div');
		timerEl.className = 'dsh-whale-status dsh-whale-status-timer';
		whale.appendChild(timerEl);
		return timerEl;
	}

	function hideTimerBox() {
		if (!timerEl) return;
		timerEl.classList.remove('show');
	}

	function runTimerTick() {
		if (runSlots.size === 0) { hideTimerBox(); return; }
		var now = Date.now();
		var rows = [];
		runSlots.forEach(function (startAt, sid) {
			var r = timerRowText(sid, now);
			if (r) rows.push(r);
		});
		if (rows.length === 0) { hideTimerBox(); return; }
		/* a live NON-timer panel (token report, stuck hint, tool line) owns
		 * the main box → the rows drop into the timer's own box below it;
		 * a free main box renders them as before and the extra box hides */
		var busyMain = statusEl && statusEl.classList.contains('show') && !(statusCache && statusCache._timer);
		if (busyMain) {
			var main = statusEl;
			var tel = ensureTimerEl();
			if (!tel) return;
			tel.classList.toggle('dsh-whale-status-below', main.classList.contains('dsh-whale-status-below'));
			tel.classList.toggle('dsh-whale-status-leftflip', main.classList.contains('dsh-whale-status-leftflip'));
			var maxW = parseFloat(main.style.maxWidth) || 280;
			tel.style.maxWidth = maxW + 'px';
			var compact = rows.join(' · ');
			tel.textContent = estWidth(compact) <= maxW ? compact : rows.join('\n');
			tel.classList.add('show');
			/* hug the main box: below it, or above when that would leave
			 * the viewport (whale near the screen bottom edge) */
			var top = main.offsetTop + main.offsetHeight + 8;
			if (whale.offsetTop + top + tel.offsetHeight > window.innerHeight &&
				main.offsetTop - tel.offsetHeight - 8 > 0) {
				top = main.offsetTop - tel.offsetHeight - 8;
			}
			tel.style.top = top + 'px';
			tel.style.left = main.offsetLeft + 'px';
			tel.style.right = 'auto';
			tel.style.bottom = 'auto';
			clearTimeout(runTimerTick.boxTimer);
			runTimerTick.boxTimer = setTimeout(hideTimerBox, 1100);
			return;
		}
		hideTimerBox();
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

