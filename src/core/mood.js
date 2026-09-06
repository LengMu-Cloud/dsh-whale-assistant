	/* ------------------------------------------------------------------ */
	/* 班味 (workplace fatigue) system: the whale gets gradually tired     */
	/* like a real office worker, with small ups and downs.                */
	/* ------------------------------------------------------------------ */
	var MOOD_STAGES = [
		{ min: 0, key: 'fresh', name: '元气满满' },
		{ min: 4, key: 'warm', name: '渐入佳境' },
		{ min: 9, key: 'tired', name: '有点班味' },
		{ min: 16, key: 'burnt', name: '班味十足' }
	];
	/** Lines spoken while idle, per mood stage (gradually mixed in). */
	var MOOD_LINES = {
		fresh: ['精神着呢！来什么活都接 💪✨', '新鲜出炉的打工人，活力满满 🐋⚡'],
		warm: ['还行，这班上得有点感觉了 😌', '任务一个接一个，稳着来 🤝', '今天手感不错 🎯'],
		tired: ['……又来了吗 😮‍💨', '有点班味了，但还能干 💪', '今天第好几个活了，继续吧 🫡'],
		burnt: ['这班味儿，上头 😮‍💨', '打工鲸，打工魂 🫠', '我已经没有什么情绪了 😶', '行吧，干完这单再说 🥱']
	};
	/** Weary catch reactions when already tired. */
	var TIRED_CATCH = [
		'……你抓吧，反正我也跑不动了 😮‍💨',
		'哎，抓就抓吧，正好歇会儿 🥱',
		'我累了，不挣扎了 😴',
		'这班我是一天都不想上了 🫠'
	];
	/** Weary report tails when burnt out. */
	var WEARY_TAILS = {
		running: ['……又开工 😮‍💨', '来活了，来活了 😮‍💨'],
		failed: ['……意料之中 😮‍💨', '累了，不想修了 😑'],
		remind: ['还活着呢… 🫠', '在跑，别催 😮‍💨']
	};
	/** Relief lines when a tired whale finally finishes something. */
	var RELIEF_LINES = [
		'终于搞定了！😮‍💨🎉',
		'呼——总算完了，累死我了 🫠',
		'搞定！可以喘口气了 😮‍💨',
		'收工一个，血回了一点 🩹',
		'这单终于结了……舒服了 😌',
		'不容易啊，终于完了 🥲'
	];

	/** Completion tail: relief when tired, celebration otherwise. */
	function completedTail() {
		if (moodStageIndex() >= 2 && Math.random() < 0.7) {
			return RELIEF_LINES[Math.floor(Math.random() * RELIEF_LINES.length)];
		}
		return pickTail('completed');
	}

	/** Cumulative workload: starts + failures add, completions relieve. */
	var workLoad = 0;
	var moodKey = 'fresh';

	function updateMood() {
		var key = 'fresh';
		for (var i = MOOD_STAGES.length - 1; i >= 0; i--) {
			if (workLoad >= MOOD_STAGES[i].min) {
				key = MOOD_STAGES[i].key;
				break;
			}
		}
		moodKey = key;
	}

	/** One unit of work done/started/failed (+1) or relieved (-1). */
	function bumpWork(delta) {
		workLoad = Math.max(0, workLoad + delta);
		updateMood();
	}

	/** Current mood stage index (0..3). */
	function moodStageIndex() {
		var index = 0;
		for (var i = 0; i < MOOD_STAGES.length; i++) {
			if (workLoad >= MOOD_STAGES[i].min) index = i;
		}
		return index;
	}

	/** A mix of the base playful lines and mood-appropriate ones. */
	function pickIdleLine() {
		var base = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
		var stage = moodStageIndex();
		if (stage === 0) {
			return Math.random() < 0.35
				? MOOD_LINES.fresh[Math.floor(Math.random() * MOOD_LINES.fresh.length)]
				: base;
		}
		var pool = [];
		for (var s = 1; s <= stage; s++) {
			pool = pool.concat(MOOD_LINES[MOOD_STAGES[s].key]);
		}
		return Math.random() < 0.55
			? pool[Math.floor(Math.random() * pool.length)]
			: base;
	}

	/** Catch line: weary reactions join in once the whale is tired. */
	function pickCatchLine() {
		if (moodStageIndex() >= 2 && Math.random() < 0.5) {
			return TIRED_CATCH[Math.floor(Math.random() * TIRED_CATCH.length)];
		}
		return CATCH_LINES[Math.floor(Math.random() * CATCH_LINES.length)];
	}

	/* ------------------------------------------------------------------ */
	/* Idle companionship tick (#11 + #12'): every 10 minutes, if the whale
	 * is TRULY idle (asleep? no — asleep whales don't speak; no running
	 * jobs; no unread; not DND), it may either drop one of the rare
	 * pet-guide lines (affection < 10 — the 右键双击 gesture is invisible
	 * otherwise) or quietly float a few hearts (affection 10+). Hard cap:
	 * 3 spoken hints per day; hearts are silent and capped too. */
	/* ------------------------------------------------------------------ */
	var PET_GUIDE_LINES = [
		'今天都没人摸我头…… 🥺',
		'右键双击可以摸摸我哦 🐋',
		'悄悄说：右键连点我两下，会有惊喜 💙'
	];
	var IDLE_TICK_MS = 10 * 60 * 1000;
	var IDLE_CHANCE = 0.25;
	var PET_HINT_DAILY_CAP = 3;
	var petHintDay = null;
	var petHintCount = 0;

	function loadPetHint() {
		try {
			var raw = JSON.parse(localStorage.getItem('dsh-whale:petHint') || 'null');
			if (raw && raw.day === todayKey()) {
				petHintDay = raw.day;
				petHintCount = raw.n;
			}
		} catch (e) {}
	}

	function savePetHint() {
		try {
			localStorage.setItem('dsh-whale:petHint', JSON.stringify({ day: todayKey(), n: petHintCount }));
		} catch (e) {}
	}

	function hasRunningJobs() {
		var busy = false;
		known.forEach(function (view) {
			if (view.status === 'running') busy = true;
		});
		return busy;
	}

	function idleTick(force) {
		if (asleep || dndActive()) return;
		if (typeof window.__dshWhale.unreadCount === 'function' && window.__dshWhale.unreadCount() > 0) return;
		if (hasRunningJobs()) return;
		if (!force && Math.random() >= IDLE_CHANCE) return;
		if (affection < 10) {
			/* low affection: the spoken guide is the point (daily-capped) */
			if (petHintCount >= PET_HINT_DAILY_CAP) return;
			petHintCount++;
			savePetHint();
			say(PET_GUIDE_LINES[Math.floor(Math.random() * PET_GUIDE_LINES.length)], 3600);
		} else {
			/* affectionate whale floats hearts instead of words (#12') */
			if (petHintCount >= PET_HINT_DAILY_CAP + 3) return;
			petHintCount++;
			savePetHint();
			if (typeof window.__dshWhale.spawnHearts === 'function') {
				window.__dshWhale.spawnHearts(affection >= 100 ? 3 : (affection >= 50 ? 2 : 1));
			}
		}
	}

	loadPetHint();
	setInterval(idleTick, IDLE_TICK_MS);

	/**
	 * The logo whale faces LEFT with its tail on the right (upper-middle).
	 * When swimming we mirror it so it faces the direction of travel, which
	 * puts the tail on the left — the ripple trail point, in div coords.
	 */
	var TAIL_X = 22;
	var TAIL_Y = 31;

