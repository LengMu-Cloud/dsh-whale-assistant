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
		/* BUG-1 后半程（0.4.3 阶段 B）：每日装饰计数困在桌宠页每-boot 失忆的
		 * localStorage——PET_MODE 下沿 pushPetSync 进 petDoc（{date,count} 成对；
		 * date 错位=隔日存量，宿主 boot 回放后页侧按 loadGearStats 同款过期
		 * 规则归零）。容量预算：日期 10 字符 + 计数宿主侧钳顶 9999999。
		 * fire-and-forget：宿主离线静默，下次计数自然补上。 */
		if (PET_MODE) pushPetSync({ gearStats: { date: todayKey(), count: gearStats.tasksDone } });
	}

	/** BUG-1 后半程（0.4.3 阶段 B）：宿主 /pet/state 下行的装饰计数快照采用
	 * ——本地已有（键存在）不覆盖（幂等，与 petSyncFromHost 同款）；日期
	 * 错位（隔日存量）按 loadGearStats 同款规则归零；由 ui/drawers.js 的
	 * petSyncExtrasFromHost 转发。坏形状整字段丢弃。 */
	function adoptGearStatsFromHost(date, count) {
		try {
			if (localStorage.getItem(GEAR_STATS_KEY) !== null) return;
		} catch (e) { return; /* 存储不可用：放弃采用 */ }
		if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
		gearStats.tasksDone = (date === todayKey() && typeof count === 'number' && isFinite(count) && count >= 0)
			? Math.min(9999999, Math.floor(count)) : 0;
		saveGearStats();
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

