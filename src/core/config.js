/**
 * User configuration (inline module). Defaults live here; persisted overrides
 * live in 'dsh-whale:config' (v1 envelope) and are merged over the defaults
 * on load. Unknown saved fields are dropped so a future schema cannot leak.
 *
 * Load once at startup (startMux bootstrap); save on every settings change.
 */

	var CONFIG = {
		notifyOnStart: true,           /* announce turn/start (开工了) — defaults ON, contract unchanged */
		toolStuckMs: 15000,            /* tool hover threshold before the "running" hint (15s: legit slow tools like Start-Sleep/pip must not nag at 8s) */
		recentFailWindowMs: 180000,    /* window for the "上次任务失败" summary hint (3 min) */
		volume: 1,                     /* 0..1 master volume for the dings */
		soundDone: 'ding',             /* 完成通知音效: ding|bell|chime|none */
		soundFail: 'thud',             /* 失败通知音效: thud(低沉下行)|ding|bell|chime|none */
		soundAttn: 'chime',            /* 提问/审核音效: chime|ding|bell|none */
		soundRemind: 'bell',           /* 定时提醒音效: bell|ding|chime|thud|none */
		pressureWarnPct: 70,           /* context pressure that fires the /compact warning */
		dndEnabled: false,             /* 免打扰: completion sounds+popups silenced in the window */
		dndFrom: '23:00',              /* DND window start (HH:MM, local) */
		dndTo: '08:00'                 /* DND window end */
	};

	var CONFIG_KEY = 'dsh-whale:config';

	function loadConfig() {
		var saved = safeGet(CONFIG_KEY, function (v0) {
			/* legacy shapes were never persisted before this feature — ignore */
			return (v0 && typeof v0 === 'object') ? v0 : null;
		});
		if (!saved || typeof saved !== 'object') return;
		Object.keys(CONFIG).forEach(function (key) {
			if (typeof saved[key] === typeof CONFIG[key]) CONFIG[key] = saved[key];
		});
		/* one-time migration: the old single soundScheme rides onto the
		 * completion sound (fail/attn keep their own defaults) */
		if (typeof saved.soundScheme === 'string' && saved.soundDone === undefined) {
			if (['bell', 'chime', 'ding'].indexOf(saved.soundScheme) >= 0) CONFIG.soundDone = saved.soundScheme;
		}
		/* one-time legacy bump: 8000 was the pre-M4 default that got persisted
		 * wholesale whenever ANY panel row saved — nobody actually chose it.
		 * Treat a stored 8000 as "unset" and adopt the new 15s default. (A
		 * deliberate 8000 sits 5 preset-cycles away and is accepted as
		 * collateral; the fresh default wins this once.) */
		if (CONFIG.toolStuckMs === 8000) CONFIG.toolStuckMs = 15000;
	}

	function saveConfig() {
		safeSet(CONFIG_KEY, {
			notifyOnStart: CONFIG.notifyOnStart,
			toolStuckMs: CONFIG.toolStuckMs,
			recentFailWindowMs: CONFIG.recentFailWindowMs,
			volume: CONFIG.volume,
			soundDone: CONFIG.soundDone,
			soundFail: CONFIG.soundFail,
			soundAttn: CONFIG.soundAttn,
			pressureWarnPct: CONFIG.pressureWarnPct,
			dndEnabled: CONFIG.dndEnabled,
			dndFrom: CONFIG.dndFrom,
			dndTo: CONFIG.dndTo
		});
	}

	/** Normalize an incoming settings patch: only known keys with the right
	 * type are accepted; returns true when anything changed (caller saves). */
	function applyConfig(patch) {
		var changed = false;
		if (!patch || typeof patch !== 'object') return false;
		if (typeof patch.notifyOnStart === 'boolean' && patch.notifyOnStart !== CONFIG.notifyOnStart) {
			CONFIG.notifyOnStart = patch.notifyOnStart;
			changed = true;
		}
		if (typeof patch.toolStuckMs === 'number' && patch.toolStuckMs >= 3000 && patch.toolStuckMs <= 60000 && patch.toolStuckMs !== CONFIG.toolStuckMs) {
			CONFIG.toolStuckMs = patch.toolStuckMs;
			changed = true;
		}
		if (typeof patch.recentFailWindowMs === 'number' && patch.recentFailWindowMs >= 0 && patch.recentFailWindowMs !== CONFIG.recentFailWindowMs) {
			CONFIG.recentFailWindowMs = patch.recentFailWindowMs;
			changed = true;
		}
		if (typeof patch.volume === 'number' && patch.volume >= 0 && patch.volume <= 1 && patch.volume !== CONFIG.volume) {
			CONFIG.volume = patch.volume;
			changed = true;
		}
		var SOUND_SETS = {
			soundDone: ['ding', 'bell', 'chime', 'none'],
			soundFail: ['thud', 'ding', 'bell', 'chime', 'none'],
			soundAttn: ['chime', 'ding', 'bell', 'none'],
			soundRemind: ['bell', 'ding', 'chime', 'thud', 'none']
		};
		Object.keys(SOUND_SETS).forEach(function (key) {
			if (typeof patch[key] === 'string' && SOUND_SETS[key].indexOf(patch[key]) >= 0 && patch[key] !== CONFIG[key]) {
				CONFIG[key] = patch[key];
				changed = true;
			}
		});
		/* legacy single-scheme field maps onto the completion sound */
		if (typeof patch.soundScheme === 'string' && ['bell', 'chime', 'ding'].indexOf(patch.soundScheme) >= 0) {
			patch.soundDone = patch.soundScheme;
		}
		if (typeof patch.pressureWarnPct === 'number' && patch.pressureWarnPct >= 20 && patch.pressureWarnPct <= 95 && patch.pressureWarnPct !== CONFIG.pressureWarnPct) {
			CONFIG.pressureWarnPct = Math.round(patch.pressureWarnPct);
			changed = true;
		}
		if (typeof patch.dndEnabled === 'boolean' && patch.dndEnabled !== CONFIG.dndEnabled) {
			CONFIG.dndEnabled = patch.dndEnabled;
			changed = true;
		}
		if (typeof patch.dndFrom === 'string' && /^\d{1,2}:\d{2}$/.test(patch.dndFrom) && patch.dndFrom !== CONFIG.dndFrom) {
			CONFIG.dndFrom = patch.dndFrom;
			changed = true;
		}
		if (typeof patch.dndTo === 'string' && /^\d{1,2}:\d{2}$/.test(patch.dndTo) && patch.dndTo !== CONFIG.dndTo) {
			CONFIG.dndTo = patch.dndTo;
			changed = true;
		}
		return changed;
	}