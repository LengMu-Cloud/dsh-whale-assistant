
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', uiInit);
	} else {
		uiInit();
	}

	/* diagnostic seam */
	window.__dshWhale.version = PATCH_VERSION;
	window.__dshWhale.handleJobsFrame = handleJobsFrame;
	window.__dshWhale.handleSubscribedFrame = handleSubscribedFrame;
	window.__dshWhale.handleMuxPayload = handleMuxPayload;
	window.__dshWhale.known = known;
	window.__dshWhale.subagentSessions = subagentSessions;
	window.__dshWhale.spawnRipple = spawnRipple;
	window.__dshWhale.catchLines = CATCH_LINES;
	window.__dshWhale.tiredCatch = TIRED_CATCH;
	window.__dshWhale.idleLines = IDLE_LINES;
	window.__dshWhale.moodLines = MOOD_LINES;
	window.__dshWhale.taskTitle = taskTitle;
	window.__dshWhale.mood = function () {
		return moodKey;
	};
	window.__dshWhale.workLoad = function () {
		return workLoad;
	};
	window.__dshWhale.pickIdleLine = pickIdleLine;
	window.__dshWhale.bumpWork = bumpWork;
	window.__dshWhale.playDing = playDing;
	window.__dshWhale._resetDing = function () {
		/* invalidate the queue: pending dings never render */
		dingGen++;
		dingPlaying = false;
		dingKinds.length = 0;
	};
	window.__dshWhale._setHoldMs = function (ms) {
		holdMsOverride = ms;
	};
	window.__dshWhale._setBaselineTtl = function (ms) {
		baselineTtlOverride = ms;
	};
	window.__dshWhale._setSleepMs = function (ms) {
		sleepMsOverride = ms;
	};
	window.__dshWhale.soundMuted = function () {
		return soundMuted;
	};
	window.__dshWhale.setSoundMuted = setSoundMuted;
	window.__dshWhale.applyConfig = applyConfig;
	window.__dshWhale.saveConfig = saveConfig;
	window.__dshWhale.scanStuckTools = scanStuckTools;
	window.__dshWhale.toolSlot = toolSlot;
	window.__dshWhale.pressureColor = pressureColor;
	window.__dshWhale.applyPressureHue = applyPressureHue;
	window.__dshWhale.pressurePercentOf = pressurePercentOf;
	window.__dshWhale._clearTitleBook = clearTitleBook;
	window.__dshWhale.affection = function () {
		return affection;
	};
	window.__dshWhale.petLine = petLine;
	window.__dshWhale.gearStats = gearStats;
	window.__dshWhale.unlockedGear = unlockedGear;
	window.__dshWhale._setGearDay = function (key) {
		lastGearDay = key;
	};
	window.__dshWhale._rolloverDay = checkDayRollover;
	window.__dshWhale.todayKey = todayKey;
	window.__dshWhale.asleep = function () {
		return asleep;
	};
	window.__dshWhale.turnTokens = function () {
		return turnTokenUsage;
	};
	window.__dshWhale.debugCounters = debugCounters;
	window.__dshWhale.unreadCount = function () {
		return reportQueue.length + (reading ? 1 : 0);
	};
	window.__dshWhale.reportQueue = function () {
		return reportQueue;
	};
	/* health check seam: run one check now / force a report for tests /
	 * read the live state (see core/health.js) */
	window.__dshWhale._health = {
		run: runHealthCheck,
		seed: function (o) { healthOverrides = o; },
		state: function () { return healthState; }
	};
	/* dedup seam: direct access to the cross-channel key decisions (see core/dedup.js) */
	window.__dshWhale._dedup = {
		seeAttention: seeAttention,
		seeEndFire: seeEndFire,
		endFiredRecently: endFiredRecently
	};
	/* run-timer seam (status panel long-task rows, see ui/status-panel.js) */
	window.__dshWhale._runTimer = {
		start: startRunTimer,
		stop: stopRunTimer,
		line: runTimerLine,
		count: countJobsCompleted,
		/* display rows (name-capped) for every running session; pass `now`
		 * to look past the 2-minute gate — tests use this */
		rows: function (now) {
			var t = now || Date.now();
			var out = [];
			runSlots.forEach(function (startAt, sid) {
				var r = timerRowText(sid, t);
				if (r) out.push(r);
			});
			return out;
		},
		state: function () {
			return {
				active: runSlots.size > 0,
				count: runSlots.size,
				sessions: Array.from(runSlots.keys()),
				session: runSlots.keys().next().value || null
			};
		}
	};
	window.__dshWhale.showWhaleNote = showWhaleNote;
	window.__dshWhale._bubble = { resumeMs: bubbleResumeMs };
	/* idle companionship seam (see core/mood.js): force-fire the idle tick
	 * (bypasses the probability gate) for tests */
	window.__dshWhale._idleGuide = {
		tick: idleTick,
		lines: PET_GUIDE_LINES,
		count: function () { return petHintCount; }
	};
	/* test seam: dismiss the current bubble and resolve the reading immediately */
	window.__dshWhale._dismissBubble = function () {
		uiSay.visible = false;
		if (typeof uiSay.timer === 'number') clearTimeout(uiSay.timer);
		var bubble = document.querySelector('.dsh-whale-bubble');
		if (bubble) bubble.classList.remove('show');
		if (typeof readTimer === 'number') clearTimeout(readTimer);
		reading = null;
		renderUnread();
	};
})();
