	/* sleep: 5 minutes without activity -> nap; activity wakes the whale */
	var SLEEP_AFTER_MS = 5 * 60 * 1000;
	var sleepMsOverride = null; /* test seam */
	var sleepTimer = null;
	var asleep = false;
	var lastWakeAt = 0;

	function goSleep() {
		if (asleep) return;
		asleep = true;
		if (whale) whale.classList.add('dsh-whale-asleep');
		say('呼…先睡会儿 Zzz 💤', 4000);
	}

	function wakeUp(silent) {
		if (!asleep) return;
		asleep = false;
		if (whale) whale.classList.remove('dsh-whale-asleep');
		var now = Date.now();
		/* silent wake: the frame that woke the whale carries its own, more
		 * informative bubble (开工了 / 完成 / ⚠️审核…) — don't flash a generic
		 * line over it */
		if (!silent && now - lastWakeAt > 5000) say('唔…有活了？😪', 2600);
		lastWakeAt = now;
	}

	/** Any real activity resets the nap timer; if asleep, wakes with a line.
	 * Pass silentWake=true when the waking frame announces itself (task
	 * turns, attention requests) — the generic mumble would only be
	 * overwritten a tick later anyway. */
	function touchActivity(silentWake) {
		clearTimeout(sleepTimer);
		if (asleep) wakeUp(silentWake);
		if (uiReady) sleepTimer = setTimeout(goSleep, sleepMsOverride || SLEEP_AFTER_MS);
	}

