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

	/* I-③-2 治本（0.4.3 阶段 C）：默认值快照——loadConfig 越界回落用（不在
	 * 钳制处逐字段重抄默认值，单点防漂移；CONFIG 字面量改默认时这里自动跟）。 */
	var CONFIG_DEFAULTS = JSON.parse(JSON.stringify(CONFIG));
	/* I-③-2 治本（0.4.3 阶段 C）：DND 时段白名单——旧 /^\d{1,2}:\d{2}$/ 放行
	 * 99:99（=全天免打扰假象）。小时 0-23 / 分钟 00-59；applyConfig（写入
	 * 路径）与 loadConfig（旁路路径）共用一判据；dings.js dndToMin 是第二
	 * 道防线（越界→null）。 */
	var DND_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
	/* 音色白名单（0.4.3 阶段 C 从 applyConfig 局部上移）：**只服务 applyConfig
	 * 写入路径**。loadConfig 有意不钳音色——存量脏音色走 panel-page 音色下拉
	 * 的「回落显示到第一项且 CONFIG 不改写」契约（11-11 审计 P3-7；test
	 * 「dirty tone value displays option 0」/「display fallback does not
	 * rewrite CONFIG」双断言）：load 期改写会让下拉走 sel.value 分支、桩上
	 * selectedIndex 成空，且违反「显示回落不改写存量」。数值/时段越界才在
	 * load 钳制（I-③-2 治本范围）。 */
	var SOUND_SETS = {
		soundDone: ['ding', 'bell', 'chime', 'none'],
		soundFail: ['thud', 'ding', 'bell', 'chime', 'none'],
		soundAttn: ['chime', 'ding', 'bell', 'none'],
		soundRemind: ['bell', 'ding', 'chime', 'thud', 'none']
	};

	function loadConfig() {
		var saved = safeGet(CONFIG_KEY, function (v0) {
			/* legacy shapes were never persisted before this feature — ignore */
			return (v0 && typeof v0 === 'object') ? v0 : null;
		});
		if (!saved || typeof saved !== 'object') return;
		Object.keys(CONFIG).forEach(function (key) {
			if (typeof saved[key] === typeof CONFIG[key]) CONFIG[key] = saved[key];
		});
		/* I-③-2 治本（0.4.3 阶段 C）：采纳后过 applyConfig 同款范围钳制——
		 * localStorage 手改的越界值（volume:5 / toolStuckMs:99 / 压力 5% /
		 * 99:99 时段）不再旁路生效。判据与 applyConfig 写入路径逐条同源；
		 * 越界回落默认值（脏数据语义未知，回落比贴边诚实）。 */
		if (!(CONFIG.toolStuckMs >= 3000 && CONFIG.toolStuckMs <= 60000)) CONFIG.toolStuckMs = CONFIG_DEFAULTS.toolStuckMs;
		if (!(CONFIG.recentFailWindowMs >= 0)) CONFIG.recentFailWindowMs = CONFIG_DEFAULTS.recentFailWindowMs;
		if (!(CONFIG.volume >= 0 && CONFIG.volume <= 1)) CONFIG.volume = CONFIG_DEFAULTS.volume;
		if (!(CONFIG.pressureWarnPct >= 20 && CONFIG.pressureWarnPct <= 95)) CONFIG.pressureWarnPct = CONFIG_DEFAULTS.pressureWarnPct;
		if (!DND_TIME_RE.test(CONFIG.dndFrom)) CONFIG.dndFrom = CONFIG_DEFAULTS.dndFrom;
		if (!DND_TIME_RE.test(CONFIG.dndTo)) CONFIG.dndTo = CONFIG_DEFAULTS.dndTo;
		/* 音色四键有意不在 load 期钳制：存量脏值（如 done 塞了 thud）按既定
		 * 契约走显示回落（panel-page 音色下拉 selectedIndex 0 + CONFIG 存量
		 * 不改写）——load 改写会让下拉误走 sel.value 分支（vm 桩 selectedIndex
		 * 成空）并违反「display fallback does not rewrite CONFIG」。 */
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
			soundRemind: CONFIG.soundRemind,
			pressureWarnPct: CONFIG.pressureWarnPct,
			dndEnabled: CONFIG.dndEnabled,
			dndFrom: CONFIG.dndFrom,
			dndTo: CONFIG.dndTo
		});
		/* 11-11 真机修复轮（用户实报「设置了叮叮桌宠响单声叮」）：桌宠
		 * WebView2 是独立 localStorage 分区，页面 CONFIG 不会自己过去——
		 * 每次持久化即向宿主 /pet/config 推一份（桌宠 2s state 轮询差分
		 * 应用）。pushPetConfig 定义在 exports.js（共享 IIFE 作用域，函数
		 * 声明跨模块提升，运行时顺序无关）；PET_MODE 下静默。 */
		if (!PET_MODE) pushPetConfig();
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
		if (typeof patch.dndFrom === 'string' && DND_TIME_RE.test(patch.dndFrom) && patch.dndFrom !== CONFIG.dndFrom) {
			CONFIG.dndFrom = patch.dndFrom;
			changed = true;
		}
		if (typeof patch.dndTo === 'string' && DND_TIME_RE.test(patch.dndTo) && patch.dndTo !== CONFIG.dndTo) {
			CONFIG.dndTo = patch.dndTo;
			changed = true;
		}
		return changed;
	}