	/* gear: achievement decorations on the whale (班味 collection). The
	 * task counter is a DAILY achievement: it resets every day, and the
	 * unlocked widgets disappear on the new day until the threshold is
	 * reached again — otherwise the accumulation never means anything. */
	var GEAR_STATS_KEY = 'dsh-whale:stats';
	var GEAR_DEFS = [
		{ id: 'coffee', name: '小咖啡杯', at: 5, emoji: '☕' },
		{ id: 'helmet', name: '小安全帽', at: 15, emoji: '⛑️' }
	];
	var gearStats = { tasksDone: 0 };
	var unlockedGear = new Set();

	/** Local-date key "YYYY-MM-DD" (the daily counter's bucket). */
	function todayKey() {
		var d = new Date();
		var m = d.getMonth() + 1;
		var day = d.getDate();
		return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
	}

	/** Hide every unlocked gear widget (daily reset). */
	function resetUnlockedGear() {
		unlockedGear.clear();
		for (var i = 0; i < GEAR_DEFS.length; i++) {
			var el = document.getElementById('dsh-whale-gear-' + GEAR_DEFS[i].id);
			if (el) el.style.display = 'none';
		}
	}

	function loadGearStats() {
		var stored = safeGet(GEAR_STATS_KEY, function (v0) {
			/* migrate the two legacy shapes:
			 *  - { tasksDone, date }   (current daily format)
			 *  - { tasksDone }          (pre-daily format — MUST NOT revive
			 *                            an expired counter, so it migrates
			 *                            to a zeroed, expired entry) */
			if (v0 && typeof v0 === 'object' && typeof v0.tasksDone === 'number') {
				return typeof v0.date === 'string' ? v0 : { tasksDone: 0, date: '' };
			}
			return null;
		});
		if (stored && typeof stored.tasksDone === 'number') {
			if (stored.date === todayKey()) {
				/* same day: keep the progress */
				gearStats.tasksDone = stored.tasksDone;
			} else {
				/* a new day (or an expired entry): the counter resets and any
				 * unlocked widget disappears */
				gearStats.tasksDone = 0;
				resetUnlockedGear();
			}
		}
	}

	function saveGearStats() {
		safeSet(GEAR_STATS_KEY, {
			tasksDone: gearStats.tasksDone,
			date: todayKey()
		});
	}

	/** Day rollover while the page stays open: a once-a-minute check resets
	 * the daily counter at midnight. */
	var lastGearDay = todayKey();
	function checkDayRollover() {
		var today = todayKey();
		if (today === lastGearDay) return;
		lastGearDay = today;
		gearStats.tasksDone = 0;
		resetUnlockedGear();
		saveGearStats();
	}
	setInterval(checkDayRollover, GEAR_ROLLOVER_MS);

	/** Award newly-reached gear: announce once, reveal the widget. The gear
	 * groups live INSIDE the whale SVG, so they follow every swim transform
	 * (rotate/mirror) automatically. The announce is DELAYED past the
	 * completion bubble+panel (DURATION_END + margin): unlockCheck runs
	 * inside the turn/end handler, and an immediate uiSay used to STOMP the
	 * just-shown 完成了 bubble and its paired token panel (uiSay is a
	 * single slot and hides the panel — live-verified on 2026-09-03). */
	function unlockCheck() {
		for (var i = 0; i < GEAR_DEFS.length; i++) {
			var def = GEAR_DEFS[i];
			if (gearStats.tasksDone >= def.at && !unlockedGear.has(def.id)) {
				unlockedGear.add(def.id);
				var el = document.getElementById('dsh-whale-gear-' + def.id);
				if (el) el.style.display = 'block';
				(function (name, emoji) {
					setTimeout(function () {
						say('解锁新装饰：' + name + ' ' + emoji + '！', 4000);
					}, 6800);
				})(def.name, def.emoji);
			}
		}
	}

