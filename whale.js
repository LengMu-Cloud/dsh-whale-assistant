/* ---- module: src/index.js ---- */
/**
 * dsh-whale — companion mascot for the DeepSeek Harness Web UI.
 *
 * - Draggable: pointer-drag moves it anywhere; position persists in
 *   localStorage ("dsh-whale:pos"). Double-click makes it SWIM back to the
 *   default corner: it turns to face the direction of travel (mirrored logo
 *   whale + live heading from the path tangent), undulates as it swims along
 *   a gentle arc, and trails expanding water ripples from its tail, ending
 *   with a little splash.
 * - Interactive: click shows a brief status summary / idle line.
 * - Job-aware: opens its OWN WebSocket to the host mux stream
 *   (/api/events.mux — a full broadcast, verified) and reports background-job
 *   transitions (started / completed / failed / killed) in a speech bubble,
 *   with a running-count badge. No polling, no interception of the app's
 *   socket, no interference with the app.
 * - Sub-task silence: background jobs (pwsh/bash/…) NEVER announce, and
 *   neither do spawned subagents — their turns are recognized by the bare-UUID
 *   session id and stay silent. Only the user's own conversations (session-
 *   prefixed ids) are the "main task" and announce turn/start + turn/end;
 *   approval/question requests announce for any session (the user must act).
 *
 * Baseline handling: the host pushes a `session/subscribed` frame whenever a
 * session (re)subscribes, immediately followed by that session's job baseline.
 * Jobs in that first baseline frame are adopted silently (no announcements),
 * so reloading the page never re-announces old jobs; only later transitions
 * speak.
 *
 * Exposed as window.__dshWhale for diagnostics/tests.
 */
(function () {
	'use strict';

	if (window.__dshWhale) return;
	window.__dshWhale = { sockets: [] };

/* ---- module: src/utils/constants.js ---- */
	/** Centralized magic values (inline module authored after the split).
	 * Consumers reference these names instead of raw literals. */

	/** 桌宠模式（第一批）：pet 页在 whale.js 之前定义 window.__dshPetHost
	 * （形态菜单缝 + 页面注入证据）；普通 DSH 页面没有它。整个共享 IIFE
	 * 里凡属桌宠专属分支（枚举 feed 端点 / 历史惰性 / 跳转文案 / 菜单缝）
	 * 都以它为总开关。 */
	var PET_MODE = typeof window !== 'undefined' && !!window.__dshPetHost;

	/** 桌宠合成会话前缀（与 lib/pet.js enumerateFrames 跨端契约）：宿主枚举
	 * feed 里的会话 id 一律 'session-pet-sN'——必须带 'session-' 主会话前缀，
	 * 否则鲸鱼的子代理静默闸门会吞掉全部任务通知（冒烟实测 10-31）；
	 * N=宿主 per-boot 会话码，页面据此显示「任务 N」。 */
	var PET_SID_PREFIX = 'session-pet-s';

	/** Whale patch version (M5.1). Build-time override: build-whale.js reads
	 * env PATCH_VERSION; the default here is the fallback single source. */
	var PATCH_VERSION = '0.4.3-rc.1';

	/** Session id prefix that marks a user conversation ("main task").
	 * Spawned subagents use bare UUIDs and are treated as silent sub-tasks. */
	var SESSION_ID_PREFIX = 'session-';

	/** Notification bubble display durations (ms). */
	var DURATION_START = 4500;   /* turn/start 开工了 */
	var DURATION_END = 6000;     /* turn/end 完成/失败/截断 + status panel */
	var DURATION_ATTN = 6000;    /* approval/question */

	/** Unread badge / report-queue caps. */
	var UNREAD_CAP = 99;         /* badge shows '99+' above this */
	var REPORT_QUEUE_CAP = 999;  /* hard bound on the queue */

	/** Daily gear rollover poll interval (ms). */
	var GEAR_ROLLOVER_MS = 60000;/* ---- module: src/types.js ---- */
/**
 * Type contracts (JSDoc only — no runtime effect).
 * Describes the shapes the whale exchanges with the host mux stream and its
 * own internal state. Editors (and optional `tsc --checkJs`) surface these.
 * Inline module: authored, not a line slice.
 */

/** Union of mux payload kinds the whale consumes. */
// @typedef {'session/jobs'|'session/subscribed'|'session/projection'|'session/event'|'approval/requested'|'question/requested'} MuxPayloadType

/** A single event carried inside a session/event frame. */
// @typedef {{type:string, seq?:number, time?:number, data?:Object}} EventFrame

/** One mux payload (frame) delivered on the whale's own socket. */
// @typedef {{type:MuxPayloadType, sessionId?:string, event?:EventFrame, key?:string, value?:any, jobs?:Array<JobView>, lastSeq?:number}} MuxFrame

/** A background job as seen in session/jobs frames. */
// @typedef {{status:string, label?:string, kind?:string, sessionId?:string, startedAt?:number, finishedAt?:number, detail?:string}} JobView

/** Per-session tracking record (main conversations and subagents). */
// @typedef {{label:string, title?:string, mode?:string, fetching?:boolean, _flush?:Array<{seq:number, fn:Function}>}} SessionInfo

/** One queued unread notification. snapshot may be null (start reports). */
// @typedef {{text:string, duration:number, sessionId?:string, at:number, turnTokens:number|null, sessionTokens:number|null, pressure:Object|null}} Report

/** Notification sound kinds. */
// @typedef {'done'|'attention'|'fail'} DingKind

/** Gear (daily decoration) definition. */
// @typedef {{id:string, name:string, at:number, emoji:string}} GearDef

/** Versioned localStorage payload (see utils/storage.js). */
// @typedef {{v:number, data:any}} VersionedStore

/** One task-history record (core/history.js, M3.1). kind → drawer icon:
 *  done ✓ / fail ✗ / max-tokens ⏹ / killed ⏹ (user-stopped) /
 *  approval yellow ? / question blue ?. endTime is the mux frame time the
 *  jump feature passes to __dshOpenSession for back-paging (falls back to
 *  `at` when absent on pre-M4 records). */
// @typedef {{title:string, sessionId:string, kind:'done'|'fail'|'max-tokens'|'killed'|'approval'|'question', at:number, endTime?:number, turnTokens:number|null}} HistoryEntry

/** User settings (core/config.js, M3.4), persisted as 'dsh-whale:config'.
 *  notifyOnStart defaults true — contract unchanged (plan C2). */
// @typedef {{notifyOnStart:boolean, toolStuckMs:number, recentFailWindowMs:number, volume:number}} WhaleConfig

/** A pending tool call tracked by the stuck watchdog (core/stuck.js, M3.3). */
// @typedef {{at:number, sessionId:string}} ToolSlot/* ---- module: src/utils/storage.js ---- */
/**
 * Versioned localStorage wrapper (inline module).
 *
 * Every persisted key is stored as:
 *     { v: 1, data: <payload> }
 *
 * safeGet  : reads v1, or reads a legacy v0 shape and MIGRATES it to v1
 *            immediately (best-effort write-back). Corruption / private mode
 *            degrade silently to a default.
 * safeSet  : writes the v1 envelope; privacy-mode failures are ignored.
 *
 * Legacy v0 shapes per key (they must stay readable forever):
 *   dsh-whale:pos        { x, y }                       (bare JSON object)
 *   dsh-whale:sound      'off' | 'on'                   (bare string)
 *   dsh-whale:affection  { value: N }                   (bare JSON object)
 *   dsh-whale:stats      { tasksDone, date? }           (date added later;
 *                         a shape WITHOUT date is pre-daily and must never
 *                         revive an expired counter — see core/gear.js)
 */

	/** Read a stored value. Returns `payload` (v1 data, or migrated v0) or
	 * null when absent/corrupt. If `migrate` is given, legacy v0 payloads are
	 * passed through it, then written back as v1 and the migrated value is
	 * returned. */
	function safeGet(key, migrate) {
		var raw = null;
		try {
			raw = localStorage.getItem(key);
		} catch (error) {
			return null; /* private mode etc. */
		}
		if (raw === null || raw === undefined) return null;
		var parsed = null;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			parsed = raw; /* legacy bare string (e.g. sound 'off'/'on') */
		}
		if (parsed !== null && typeof parsed === 'object' && parsed.v === 1) {
			return parsed.data;
		}
		if (parsed !== null && typeof parsed === 'object' && typeof parsed.v === 'number' && parsed.v > 1) {
			/* a NEWER whale wrote this envelope (v2+): never migrate it backwards
			 * and never write back over it — degrade to the caller's default and
			 * keep the blob intact for when the user upgrades the whale */
			return null;
		}
		/* legacy v0: migrate (best-effort write-back) */
		var migrated = typeof migrate === 'function' ? migrate(parsed) : parsed;
		safeSet(key, migrated);
		return migrated;
	}

	/** Write a value as the v1 envelope. Never throws (privacy mode). */
	function safeSet(key, data) {
		try {
			localStorage.setItem(key, JSON.stringify({ v: 1, data: data }));
		} catch (error) {
			/* private mode etc. — silent, the value is simply not persisted */
		}
	}

	/** Remove a stored key. Never throws. */
	function safeRemove(key) {
		try {
			localStorage.removeItem(key);
		} catch (error) {
			/* ignore */
		}
	}/* ---- module: src/utils/session-key.js ---- */
/* Session-key resolution (inline module): ONE copy of the active-conversation
 * id extraction, shared by BOTH event channels — core/alpha-adapter.js (DOM
 * side) and core/server-events.js (poll side) previously carried byte-identical
 * copies that could drift silently. Resolution order:
 *   0. per-window pin (sessionStorage 'dsh-whale:window-session', P1
 *      2026-10-28) — see 多窗口归属 note below; absent for every fresh
 *      window, so single-window behavior is byte-identical to pre-pin;
 *   1. localStorage 'dsh.sessions.current' (JSON {sessionId}) — authoritative
 *      across switches;
 *   2. insertion-ordered 'dsh.conversation[.chat].session-*' localStorage keys
 *      (a cache that goes STALE after a jump back to an older conversation —
 *      fallback only);
 *   3. FALLBACK_ID placeholder ('session-alpha-active') — the alpha adapter's
 *      synthetic active session when nothing resolvable is present.
 *
 * 多窗口归属（P1 2026-10-28）：'dsh.sessions.current' 是全部分区共享的单值键，
 * 两个 DSH 窗口看不同会话时，后切换的窗口改写全局键，先窗口的芯片用量/完成
 * 通知/历史记录就会记到别人的会话头上。修法 = 每窗口 sessionStorage pin：
 * 本窗口出现「非鲸鱼自身的」DOM 活动（alpha-adapter 的 MutationObserver）或
 * 本窗口主动打开会话（session-jump）时，把此刻的全局链结果快照进 pin；之后
 * 别的窗口改写全局键不再影响本窗口。pin 只在首个活动信号后出现——单窗口
 * 用户全程走原链路，行为零变化。
 */
var FALLBACK_ID = 'session-alpha-active';
var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;
var WINDOW_PIN_KEY = 'dsh-whale:window-session';

function isRealSessionId(sid) {
	return typeof sid === 'string' && sid.indexOf('session-') === 0 && sid !== FALLBACK_ID;
}

/** The pre-pin chain (global key → conversation cache → fallback), kept
 * separate so adoption can snapshot it WITHOUT the pin shadowing itself. */
function resolveGlobalSessionId() {
	try {
		var raw = localStorage.getItem('dsh.sessions.current');
		if (raw) {
			var v = JSON.parse(raw);
			if (v && typeof v.sessionId === 'string' && v.sessionId.indexOf('session-') === 0) return v.sessionId;
		}
	} catch (e) {}
	try {
		var keys = Object.keys(localStorage);
		for (var i = keys.length - 1; i >= 0; i--) {
			var m = keys[i].match(SESSION_KEY_RE);
			if (m) return m[1];
		}
	} catch (e) {}
	return FALLBACK_ID;
}

function resolveCurrentSessionId() {
	try {
		if (typeof sessionStorage !== 'undefined') {
			var pin = sessionStorage.getItem(WINDOW_PIN_KEY);
			if (isRealSessionId(pin)) return pin;
		}
	} catch (e) {}
	return resolveGlobalSessionId();
}

/** Pin THIS window to `sid` (sessionStorage survives per BrowserWindow;
 * localStorage is shared across the whole partition). Non-real ids are
 * rejected so the placeholder never gets pinned over a later real one. */
function pinWindowSession(sid) {
	try {
		if (typeof sessionStorage === 'undefined' || !isRealSessionId(sid)) return;
		sessionStorage.setItem(WINDOW_PIN_KEY, sid);
		/* 通知已读联动（11-14）：pin=「本窗口正在看 sid」的唯一漏斗
		 * （本地 DOM 活动 + session-jump 双信号汇合）。派发给 bootstrap
		 * 的已读清理缝——清未读/桌宠中继都在那边（utils 不 import ui，
		 * 事件是方向闸门合规通道；幂等去重在监听端做）。 */
		if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
			window.dispatchEvent(new window.CustomEvent('dsh-whale:session-viewed', { detail: { sessionId: sid } }));
		}
	} catch (e) {}
}

/** Local-activity adoption: snapshot the GLOBAL chain result into the pin.
 * Called by alpha-adapter when THIS window shows non-whale chat activity
 * (the single-active-window flow: the last switch wrote the global key,
 * and it was this window's). No-ops on the placeholder so a bare window
 * never pins it over a later real session. */
function adoptCurrentSessionPin() {
	var sid = resolveGlobalSessionId();
	if (isRealSessionId(sid)) pinWindowSession(sid);
}
/* ---- module: src/core/config.js ---- */
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
	}/* ---- module: src/core/history.js ---- */
/**
 * Task history (inline module): the most recent finished main-task records,
 * newest first, persisted as 'dsh-whale:history' (v1 envelope, cap 50).
 * Consumed by the history drawer (ui/history.js) and the fail-recall hint
 * (M3.2, via recentFailAt).
 */

	var HISTORY_KEY = 'dsh-whale:history';
	var HISTORY_CAP = 50;
	var history = []; /* newest first */
	/* Deletion sync: 清空历史 bumps this generation marker (persisted here
	 * AND in the server doc) — every record older than it is dropped on
	 * every merge, so a clear can never be undone by a cloud pull. */
	var CLEAR_KEY = 'dsh-whale:clearAt';

	function getClearAt() {
		var v = safeGet(CLEAR_KEY, function (v0) { return typeof v0 === 'number' ? v0 : null; });
		return v || 0;
	}

	function bumpClearAt(ts) {
		/* explicit timestamp = ranged clear (#8): drop everything OLDER than
		 * it (e.g. 7 days ago) while keeping recent records for the report */
		var now = typeof ts === 'number' ? ts : Date.now();
		/* monotonic: a slower window must not move the marker backwards */
		if (now <= getClearAt()) now = getClearAt() + 1;
		safeSet(CLEAR_KEY, now);
		return now;
	}

	/* Server-side mirror (dsh-whale-assistant plugin): the task history lives in
	 * ~/.dsh/whale-assistant.json via /api/whale-assistant/get|save, so every
	 * browser/window sees the SAME history — localStorage is per-browser
	 * and diverges between the desktop shell and any other browser.
	 * localStorage stays as the instant cache + offline fallback. */

	function dedupeKey(entry) {
		return (entry.sessionId || '') + '|' + (entry.endTime || entry.at || 0) + '|' + (entry.kind || '');
	}

	/** Merge two history lists (either side may be ahead): union by dedupe
	 * key, newest first, capped. Records older than the clearAt generation
	 * marker are dropped from BOTH sides first — a clear must survive every
	 * merge. Returns a new array. */
	function mergeHistories(a, b) {
		var clearAt = getClearAt();
		var seen = {};
		var merged = [];
		var lists = [a, b];
		for (var li = 0; li < lists.length; li++) {
			var list = lists[li] || [];
			for (var i = 0; i < list.length; i++) {
				var entry = list[i];
				if (!entry || typeof entry !== 'object') continue;
				if (clearAt && (entry.at || 0) < clearAt) continue;
				var key = dedupeKey(entry);
				if (seen[key]) continue;
				seen[key] = true;
				merged.push(entry);
			}
		}
		merged.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
		if (merged.length > HISTORY_CAP) merged.length = HISTORY_CAP;
		return merged;
	}

	/** Fire-and-forget upload of the current list (with the clear marker so
	 * the server drops cleared records on its side too). */
	function pushCloudHistory() {
		/* 桌宠（第一批）：pet 窗口不写共享台账——它的会话是枚举化的合成 id
		 * (pet-sN)，写进去是纯噪声；清空走 /pet/ctrl clear-history（11-05），
		 * 记录读取走 /pet/history 枚举路由——写路径保持全关。 */
		if (PET_MODE) return;
		if (typeof fetch !== 'function') return;
		try {
			fetch('/api/whale-assistant/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ v: 1, history: history, clearAt: getClearAt() })
			}).catch(function () {});
		} catch (e) {}
	}

	/** Pull the server copy and merge it in (union by key). `onDone` fires
	 * after the merge so the caller can re-render. */
	function pullCloudHistory(onDone) {
		/* 桌宠（11-05 扩容，用户实报「历史任务里面读取不到，桌宠的时候还会
		 * 出现」）：第一批把读写双门全关（pet profile 磁盘零历史），但菜单
		 * 「📜 历史任务」入口还在——抽屉永远空而通知照常出，成了半成品。
		 * 现在读路接通：走 /pet/history 枚举路由（真实 id 不出宿主、字段
		 * 白名单），**内存态只读渲染——本地磁盘仍然零写入**（safeSet/回写
		 * 都不发生），清空走 /pet/ctrl clear-history 直达共享账本。 */
		if (PET_MODE) {
			if (typeof fetch !== 'function') { if (onDone) onDone(); return; }
			try {
				fetch('/api/whale-assistant/pet/history').then(function (response) {
					return response.ok ? response.json() : null;
				}).then(function (doc) {
					if (doc && Array.isArray(doc.history) && doc.history.length) {
						var merged = mergeHistories(history, doc.history);
						/* 11-05 与页内分支同款键签名比较——长度守卫在 cap 处失效
						 * （内存满 50 时新进一条=挤走最旧一条，长度不变 → 丢弃），
						 * 真机插桩实锤：路由 170 条 top=新记录、抽屉停在旧数据 */
						var sig = function (list) {
							var s = '';
							for (var si = 0; si < list.length; si++) s += dedupeKey(list[si]) + ';';
							return s;
						};
						if (sig(merged) !== sig(history)) history = merged;
					}
					if (onDone) onDone();
				}).catch(function () { if (onDone) onDone(); });
			} catch (e) { if (onDone) onDone(); }
			return;
		}
		if (typeof fetch !== 'function') { if (onDone) onDone(); return; }
		try {
			fetch('/api/whale-assistant/state').then(function (response) {
				return response.ok ? response.json() : null;
			}).then(function (doc) {
				if (doc && Array.isArray(doc.history)) {
					var merged = mergeHistories(history, doc.history);
					/* 11-05 用户实报「要退出重启才能同步」真凶：**长度守卫在
					 * cap 处失效**——内存已被 HISTORY_CAP 截到 50 时，新记录
					 * 并入=「新进一条挤走最旧一条」，长度不变 → 合并结果被整
					 * 个丢弃（真机插桩：拉到 169 条 top=03:18，渲染停在
					 * 02:29）。改为**键签名比较**：任一变化都落地。 */
					var sig = function (list) {
						var s = '';
						for (var si = 0; si < list.length; si++) s += dedupeKey(list[si]) + ';';
						return s;
					};
					if (sig(merged) !== sig(history)) {
						history = merged;
						safeSet(HISTORY_KEY, history);
						/* write the merge back: a browser whose local history was
						 * ahead uploads it — this is also how an existing window's
						 * records migrate to the server on first open */
						pushCloudHistory();
					}
				}
				if (onDone) onDone();
			}).catch(function () { if (onDone) onDone(); });
		} catch (e) { if (onDone) onDone(); }
	}

	function loadHistory() {
		var stored = safeGet(HISTORY_KEY, function (v0) {
			return Array.isArray(v0) ? v0 : null; /* legacy bare array -> v1 */
		});
		history = Array.isArray(stored) ? stored : [];
		if (history.length > HISTORY_CAP) history.length = HISTORY_CAP; /* trim oversized legacy data too */
		pullCloudHistory(); /* warm the server mirror at startup */
	}

	function pushHistory(entry) {
		/* 桌宠：合成会话不落历史（抽屉如实显示空；真实记录由休眠中的页面
		 * 鲸鱼数据管线继续写） */
		if (PET_MODE) return;
		if (!entry || typeof entry.sessionId !== 'string') return;
		history.unshift(entry);
		if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
		safeSet(HISTORY_KEY, history);
		pushCloudHistory(); /* write-through: other windows merge on their next pull */
	}

	/** correctReports hook: a late title rewrites this session's 未命名任务
	 * rows in place (attention records saved before the LLM name existed).
	 * The title prefill skips 未命名任务, so an uncorrected row can never
	 * re-seed the map — this only upgrades the visible record. */
	function correctHistoryTitle(sessionId, title) {
		var changed = false;
		for (var i = 0; i < history.length; i++) {
			if (history[i].sessionId === sessionId && history[i].title === '未命名任务') {
				history[i].title = title;
				changed = true;
			}
		}
		if (changed) {
			safeSet(HISTORY_KEY, history);
			pushCloudHistory(); /* write-through */
		}
		return changed;
	}

	/** Late turnTokens: history written at turn/end can carry 0 when usage
	 * projections land after the end frame (09-27 用户截图：读回少一行).
	 * Upgrade ONLY the newest empty row for this session — rewriting every
	 * zero row would inflate the weekly report sum (same-session old ends). */
	function correctHistoryTurnTokens(sessionId, turnTokens) {
		if (!sessionId || !(turnTokens > 0)) return false;
		for (var i = 0; i < history.length; i++) {
			var row = history[i];
			if (row.sessionId !== sessionId) continue;
			if (row.turnTokens != null && row.turnTokens !== 0) return false; /* newest already has a number */
			row.turnTokens = turnTokens;
			safeSet(HISTORY_KEY, history);
			pushCloudHistory();
			return true;
		}
		return false;
	}

	/** Timestamp of the newest 'fail' record, or null. */
	function recentFailAt() {
		for (var i = 0; i < history.length; i++) {
			if (history[i].kind === 'fail') return history[i].at || 0;
		}
		return null;
	}/* ---- module: src/core/stuck.js ---- */
/**
 * Tool-stuck detection (inline module).
 *
 * Tool calls are SINGLE frames on the mux (no heartbeat while a slow job
 * runs), so a bare time-based watchdog would mis-flag legitimate long jobs
 * (e.g. `Start-Sleep 30`). Rule: a tool call is only "stuck" when it has
 * been pending longer than CONFIG.toolStuckMs AND its session currently has
 * NO running/stopping job. A running job is its own proof of liveness.
 *
 * toolSlot: callId -> { at, sessionId }   (populated by core/frames.js)
 * clearSessionTools / clearTool are called from tool/result and turn/end.
 */

	var toolSlot = new Map(); /* callKey -> { at, sessionId } */
	var STUCK_SCAN_MS = 2000;
	var STUCK_FOLD_AT = 3; /* more than this many stuck sessions folds into a summary (P1 2026-10-27) */
	var stuckActive = false; /* any stuck hint currently visible */

	/** Garbage-independent lookup: is any known job for this session live? */
	function sessionHasRunningJob(sessionId) {
		var live = false;
		known.forEach(function (view) {
			if (view.sessionId === sessionId && (view.status === 'running' || view.status === 'stopping')) {
				live = true;
			}
		});
		return live;
	}

	/** Record a tool call (called from tool/call handling). */
	function trackToolCall(callKey, sessionId) {
		toolSlot.set(callKey, { at: Date.now(), sessionId: sessionId });
	}

	/** Clear ONE tool call (tool/result). */
	function clearTool(callKey) {
		toolSlot.delete(callKey);
		refreshStuck();
	}

	/** Clear every tool call of a session (turn/end fallback). */
	function clearSessionTools(sessionId) {
		var dirty = false;
		toolSlot.forEach(function (slot, key) {
			if (slot.sessionId === sessionId) {
				toolSlot.delete(key);
				dirty = true;
			}
		});
		if (dirty) refreshStuck();
	}

	/** Periodic sweep (also called directly by tests). EVERY session with a
	 * pending tool past the threshold gets its own row, worst first —
	 * 09-12 用户拍板: 多会话逐行并列、每行都带会话名（和 ⏳ 计时一样可归属）。
	 * Entries older than 10× the threshold are ZOMBIES (their tool/result
	 * or turn/end cleanup signal was missed, e.g. frames dropped around a
	 * reload) and self-delete — a hang warning nobody can act on after
	 * minutes is noise, 用户报告 09-12. */
	function scanStuckTools() {
		var now = Date.now();
		var zombieMs = Math.max((CONFIG.toolStuckMs || 30000) * 10, 300000);
		var worstBySession = {}; /* sessionId -> { elapsed, seconds } (one row per session even if several calls hang) */
		toolSlot.forEach(function (slot, key) {
			var elapsed = now - slot.at;
			if (elapsed >= zombieMs) { toolSlot.delete(key); return; }
			if (elapsed < CONFIG.toolStuckMs) return;
			if (sessionHasRunningJob(slot.sessionId)) return; /* live job: not stuck */
			var cur = worstBySession[slot.sessionId];
			if (!cur || elapsed > cur.elapsed) {
				worstBySession[slot.sessionId] = { elapsed: elapsed, seconds: Math.round(elapsed / 1000) };
			}
		});
		var sids = Object.keys(worstBySession);
		if (sids.length === 0) {
			hideStuckHint();
			return;
		}
		sids.sort(function (a, b) { return worstBySession[b].elapsed - worstBySession[a].elapsed; });
		var rows = sids.map(function (sid) {
			var name = sessionTitles.get(sid) || bookTitle(sid) || '未命名任务';
			return '⚠️ [' + capNameWidth(name, 110) + '] 工具已运行 ' + worstBySession[sid].seconds + 's';
		});
		/* P1 2026-10-27 (K3): 超过 STUCK_FOLD_AT 个会话同时卡住时折叠为一行摘要 +
		 * 最严重一行——五条近同构告警行是告警疲劳不是信息（10 月截图实证）。
		 * ≤3 仍逐行并列，保留 09-12 拍板的可归属语义。 */
		if (sids.length > STUCK_FOLD_AT) {
			var worstSid = sids[0];
			var worstName = sessionTitles.get(worstSid) || bookTitle(worstSid) || '未命名任务';
			rows = [
				'⚠️ ' + sids.length + ' 个会话的工具卡住 · 最长 ' + worstBySession[worstSid].seconds + 's',
				'最严重：[' + capNameWidth(worstName, 110) + ']，其余 ' + (sids.length - 1) + ' 个会话同卡住'
			];
		}
		showStuckHint(rows);
	}

	/** Show/refresh the stuck hint in the status panel. rows are per-session
	 * lines; _stacked forces one-per-line (并列显示, user request 09-12). */
	function showStuckHint(rows) {
		if (!stuckActive) {
			stuckActive = true;
			ensureStatusEl().classList.add('dsh-whale-status-stuck');
		}
		/* _stuck: self-identify so the displaced-report guard in
		 * status-panel.js never routes the hint itself into reportEl */
		showStatusPanel({ prefix: '', lines: rows, _stacked: true, _stuck: true }, 3000);
	}

	/** Hide the stuck hint when nothing is pending anymore. */
	function hideStuckHint() {
		if (!stuckActive) return;
		stuckActive = false;
		var el = ensureStatusEl();
		el.classList.remove('dsh-whale-status-stuck');
	}

	/** Unstick when an explicit result/end cleared the slot. */
	function refreshStuck() {
		if (!stuckActive) return;
		if (toolSlot.size === 0) {
			hideStuckHint();
			return;
		}
		scanStuckTools(); /* re-evaluate the remaining slots */
	}

	/* the periodic sweep is armed once at startup */
	{
		setInterval(scanStuckTools, STUCK_SCAN_MS);
	}

	/* seams for server-events: background sessions' tool frames are not
	 * forwarded (they would flicker the 🔧 panel for work the user isn't
	 * watching) but their tools must still be tracked for the stuck
	 * watchdog — 09-12 多会话并列的前提是每个会话的工具都在册。
	 * _stuckPending: the report box asks whether the ⚠️ hint currently owns
	 * the main panel (displacement routing, status-panel.js). */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._trackTool = trackToolCall;
		window.__dshWhale._clearTool = clearTool;
		window.__dshWhale._stuckPending = function () { return stuckActive; };
	} catch (e) {}/* ---- module: src/core/chip-gate.js ---- */
/**
 * Pure chip-gate policy for the alpha adapter — NO DOM, NO timers of its
 * own: every input is a fact gathered by the MutationObserver callback and
 * `now` is injected, so the whole policy is unit-testable. The test file
 * requires this module directly (the browser build shares it inside the
 * IIFE; `module` is undefined there so the export guard is a no-op).
 *
 * `st` is the adapter-owned state bag (mutated in place):
 *   lastKnownTitle   {string} document.title at the previous batch
 *   streamingArmed   {boolean} live streaming was seen for this conversation
 *   armStreak        {number} consecutive small in-flow batches
 *   lastArmAt        {number} ts of the last arming-eligible batch
 *   renderUntil      {number} skip-window after a detected (re)render
 *   turnEndUntil     {number} cooldown: no chip fires before this ts
 *
 * Facts for one batch `f`:
 *   now, title, addedEls, addedChars, chipCount, inFlow
 *
 * Returns one action:
 *   { action: 'skip-render', reason } — a (re)render was detected
 *   { action: 'skip' }                — nothing to do
 *   { action: 'arm' }                 — streaming evidence, stay quiet
 *   { action: 'chip' }                — fire turn/end for the single chip
 *
 * TURN/START IS NOT DETECTED HERE (2026-09-02 revision): every composer-
 * clear heuristic eventually mistook DSH's own flow mutations (timestamp
 * refreshes, lazy rows, in-flow re-renders) for a "confirmed send" and
 * faked an 开工 — and the tool box then hung waiting for a turn that never
 * existed. The server event bus carries the AUTHORITATIVE turn/start for
 * EVERY session (core/server-events.js owns start announcements now, with
 * a per-session throttle); the DOM adapter only detects the live FINISH
 * (chip) for zero latency, exactly as before.
 */
function decideChipAction(st, f) {
	var now = f.now;

	/* gate 1 — title: a switch re-renders the NEW conversation; anything in
	 * this batch belongs to it, never to a live turn */
	if (f.title !== st.lastKnownTitle) {
		st.lastKnownTitle = f.title;
		st.streamingArmed = false;
		st.armStreak = 0;
		st.renderUntil = now + 2500;
		return { action: 'skip-render', reason: 'title' };
	}
	/* gate 2 — render cooldown: lazy render tails of a just-detected render */
	if (now < st.renderUntil) {
		return { action: 'skip-render', reason: 'cooldown' };
	}

	var bigRender = f.addedEls > 40 || f.addedChars > 6000 || f.chipCount >= 2;

	/* gate 3 — bulk render (switch/jump/scroll-paging): whole-log re-renders
	 * and multi-chip batches, armed or not. A single chip while ARMED falls
	 * through (the finished message may re-render together with its chip). */
	if (bigRender && (f.chipCount !== 1 || !st.streamingArmed)) {
		st.streamingArmed = false;
		st.armStreak = 0;
		st.renderUntil = now + 2500;
		return { action: 'skip-render', reason: 'bulk' };
	}

	if (f.chipCount === 0) {
		/* gate 4 — arming: small text additions inside the flow at streaming
		 * cadence (two within 5s) arm the adapter; one-off scroll-paged rows
		 * never reach the streak */
		var flowEvidence = f.addedChars > 0 && f.inFlow;
		if (flowEvidence) {
			st.armStreak = now - st.lastArmAt < 5000 ? st.armStreak + 1 : 1;
			st.lastArmAt = now;
			if (st.armStreak >= 2) st.streamingArmed = true;
		} else {
			st.armStreak = 0;
		}
		return { action: 'arm' };
	}

	/* chips present — a live finish adds ONE new chip in a small batch */
	if (now < st.turnEndUntil) {
		return { action: 'skip-render', reason: 'turn-end-cooldown' };
	}
	/* gate 5 — a chip with no live streaming behind it: a re-rendered
	 * history row (big renders were already handled above) */
	if (!st.streamingArmed) {
		return { action: 'skip', reason: 'unarmed' };
	}
	if (bigRender) {
		/* single chip inside a big batch while armed: likely the finished
		 * message re-rendering together with its chip — allow, but treat as
		 * a render for the follow-up tail */
		st.renderUntil = now + 2500;
	}
	st.streamingArmed = false;
	st.armStreak = 0;
	/* completion text renders in pieces: the chip re-renders with it —
	 * never double-fire inside the tail (real turns need a new send +
	 * stream and cannot finish within 3.5s of the previous one) */
	st.turnEndUntil = now + 3500;
	return { action: 'chip' };
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { decideChipAction: decideChipAction };
}
/* ---- module: src/core/alpha-adapter.js ---- */
/**
 * Alpha adapter (inline module, M5 alpha-compat): synthesizes mux-equivalent
 * event frames from DOM observations. dsh 0.1.2-alpha removed the WebSocket
 * event mux; the web UI is per-request streaming + DOM rendering.
 *
 * The gate POLICY lives in core/chip-gate.js as a pure function (unit
 * tested); this file gathers the facts from the DOM and acts on decisions.
 *
 * Live-verified DOM signals (2026-09-01/02 captures):
 *   - usage chip: "用量 X tok" per finished turn row (+ row timestamp)
 *   - question: an ask_user_question tool row in state running, inside a
 *     chat call row → question/requested 🤔
 *   - other running tools → tool/call 🔧 (+ a sweep retires them)
 *   - failure: a 本轮运行失败 row while the turn is live → turn/end error
 *   - compaction: the "已压缩 N 条历史记录" banner → one-off bubble notice
 *   - usage bar "输入 X tok · 输出 Y tok" → tokenUsage projection
 *   - context meter "上下文已用 N%" → contextPressure projection
 *
 * NOT detected here any more: turn/start. Every composer-clear heuristic
 * faked an 开工 on DSH's own flow mutations; the server event bus carries
 * the authoritative turn/start for EVERY session (core/server-events.js).
 *
 * Wrapped in an inner IIFE so the early-return (test env) exits the adapter
 * only, not the whale's outer IIFE.
 */
	(function initAlphaAdapter() {
	/* test seam: drive the DOM usage sweep directly (0.1.5 split-node
	 * cumulative label regression). Must sit BEFORE the early return below —
	 * the vm test env has no MutationObserver, but the seam still has to
	 * land for unit group 60 (function declarations hoist, so the reference
	 * is valid here). */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._feedSessionUsage = feedSessionUsage;
	} catch (e) {}
	if (typeof MutationObserver === 'undefined' || typeof window === 'undefined') return;

	/* The real conversation id lives in the app's localStorage keys
	 * (dsh.conversation.chat.session-<uuid> / dsh.conversation.session-<uuid>).
	 * Using it (instead of a placeholder) makes the jump-to-conversation
	 * feature and history records point at the actual session. */
	/* active-session id resolution lives in utils/session-key.js
	 * (resolveCurrentSessionId) — shared verbatim with server-events. */

	/* reportTurn() only speaks for sessions registered in subagentSessions —
	 * that map is filled by the subagentTiming PROJECTION frame, so register
	 * once per session before any turn/event is fed. Registering also makes
	 * frames.js fetch the conversation title (real name in notifications). */
	var registeredId = null;
	function ensureRegistered() {
		var sid = resolveCurrentSessionId();
		if (sid === registeredId) return sid;
		try {
			handleMuxPayload({
				type: 'session/projection',
				sessionId: sid,
				key: 'subagentTiming',
				value: {}
			});
			registeredId = sid;
		} catch (e) {}
		return sid;
	}

	function parseTokNum(text) {
		var m = text.match(/([\d.]+)\s*([KM万]?)/);
		if (!m) return 0;
		var n = parseFloat(m[1]);
		if (m[2] === 'K') n *= 1000;
		else if (m[2] === 'M') n *= 1000000;
		else if (m[2] === '万') n *= 10000;
		return Math.round(n);
	}

	/* read the newest "用量 X tok" chip in the chat flow. Primary selector is
	 * the chip's label class; a text-node sweep is the fallback for when the
	 * app renames its classes (the token panel must not silently vanish
	 * just because a selector went stale — user-reported bug). */
	function readTurnUsage() {
		var flow = document.querySelector('[data-chat-flow]');
		if (!flow) return 0;
		var last = 0;
		var chips = flow.querySelectorAll('[class*="label"]');
		for (var i = 0; i < chips.length; i++) {
			var t = (chips[i].textContent || '').trim();
			if (t.indexOf('用量') === 0) last = parseTokNum(t);
		}
		if (last > 0) return last;
		try {
			var walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, null, false);
			var node;
			while ((node = walker.nextNode())) {
				var s = node.textContent || '';
				var m = /用量\s*([\d.]+\s*[KM万]?)\s*tok/.exec(s);
				if (m) last = parseTokNum(m[1]);
			}
		} catch (e) {}
		return last;
	}

	/* Session-title fallback: the old /api/session.history RPC is gone on
	 * alpha, but the app renders the current conversation title in
	 * document.title ("<title> — DeepSeek Harness"). The title is
	 * LLM-generated AFTER the turn ends, so the first attempt usually
	 * misses — retry until the app sets it, then backfill history records
	 * pushed as 未命名任务. */
	function applyPageTitleFallback(sid, attempt) {
		try {
			var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
			var info = subs && subs.get(sid);
			if (!info || info.title || info.label) return;
			var m = /^([\s\S]+?)\s+—\s+DeepSeek Harness$/.exec(document.title || '');
			if (!(m && m[1] && m[1] !== 'DeepSeek Harness')) {
				if ((attempt || 0) < 4) {
					setTimeout(function () { applyPageTitleFallback(sid, (attempt || 0) + 1); }, 1500);
				}
				return;
			}
			info.title = m[1];
			sessionTitles.set(sid, m[1]);
			rememberTitle(sid, m[1]);
			/* backfill: turn/end already pushed history with the placeholder */
			var changed = false;
			for (var i = 0; i < history.length; i++) {
				var h = history[i];
				if (h.sessionId === sid && h.title === '未命名任务') {
					h.title = m[1];
					changed = true;
				}
			}
			if (changed) safeSet(HISTORY_KEY, history);
		} catch (e) {}
	}

	/* boot: the conversation you reloaded INTO already has its real name in
	 * document.title — feed it eagerly instead of waiting for the first
	 * chip event. A post-清空 reload has no other title source: the prefill
	 * reads the cleared records and title projections only push on change
	 * (09-06 用户报告：清空后首次发送“未命名任务”、再清一次又正常，交替).
	 * Scheduled, not inline: frames-side state is not initialized yet at
	 * IIFE-eval time. */
	function seedActiveTitle(attempt) {
		try {
			var sid = resolveCurrentSessionId();
			var m = /^([\s\S]+?)\s+—\s+DeepSeek Harness$/.exec(document.title || '');
			var have = sid && m && m[1] && m[1] !== 'DeepSeek Harness';
			if (!have && (attempt || 0) < 6) {
				setTimeout(function () { seedActiveTitle((attempt || 0) + 1); }, 1000);
				return;
			}
			if (have) {
				sessionTitles.set(sid, m[1]);
				rememberTitle(sid, m[1]);
				var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
				var info = subs && subs.get(sid);
				if (info && !info.title) info.title = m[1];
			}
		} catch (e) {}
	}
	setTimeout(function () { seedActiveTitle(0); }, 800);

	function synthOn(sid, eventType, data) {
		try {
			applyPageTitleFallback(sid); /* before the hold timer: reportTurn reads it */
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: eventType, time: Date.now(), data: data || {} }
			});
		} catch (e) {}
	}

	function synth(eventType, data) {
		synthOn(ensureRegistered(), eventType, data);
	}

	/* Session-wide usage + context pressure.
	 * 0.1.2-rc.1: "输入 X tok · 输出 Y tok" + "上下文已用 N%".
	 * 0.1.5-rc.2 (live 2026-09-11): cumulative bar became
	 * "10.8M tok·缓存命中 6%" and the 上下文已用 meter is gone from the
	 * composer strip (per-turn chip "用量 X tok" still works). Keep the
	 * old regexes and add the new total-token form so 全对话累计 does not
	 * silently die after the 0.1.5 stats redesign. */
	function feedSessionUsage(sid) {
		try {
			var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
			var node;
			var usageDone = false;
			var pressureDone = false;
			while ((node = walker.nextNode())) {
				var t = node.textContent || '';
				if (!usageDone) {
					var m = /输入\s*([\d.]+\s*[KM万]?)\s*tok[\s\S]{0,60}?输出\s*([\d.]+\s*[KM万]?)\s*tok/.exec(t);
					if (m) {
						usageDone = true;
						handleMuxPayload({
							type: 'session/projection',
							sessionId: sid,
							key: 'tokenUsage',
							value: { uncachedInputTokens: parseTokNum(m[1]), outputTokens: parseTokNum(m[2]) }
						});
					} else {
						/* 0.1.5: the stats label renders the total and the
						 * cache-hit share as SEPARATE text nodes —
						 * <span>10.9M tok<span aria-hidden>·</span>缓存命中 7%</span>
						 * — so node-level text never holds both halves and the
						 * combined match must retry on the parent's textContent
						 * (live-DOM regression 2026-09-11: 全对话累计 silently
						 * died after the 0.1.5 upgrade; the per-turn chip's
						 * parent lacks 缓存命中 so it can never false-positive).
						 * Prefilter keeps the whole-body walk cheap. */
						var m2 = t.match(/([\d.]+\s*[KM万]?)\s*tok\s*[·•]?\s*缓存命中/);
						if (!m2 && node.parentElement &&
							(t.indexOf('tok') !== -1 || t.indexOf('缓存命中') !== -1)) {
							m2 = (node.parentElement.textContent || '').match(/([\d.]+\s*[KM万]?)\s*tok\s*[·•]?\s*缓存命中/);
						}
						if (m2) {
							usageDone = true;
							var total = parseTokNum(m2[1]);
							/* display path only sums uncachedInput+output; put the
							 * whole total on output so the panel shows a real number */
							handleMuxPayload({
								type: 'session/projection',
								sessionId: sid,
								key: 'tokenUsage',
								value: { uncachedInputTokens: 0, outputTokens: total }
							});
						}
					}
				}
				if (!pressureDone) {
					var p = /上下文已用\s*([\d.]+)\s*%/.exec(t);
					if (p) {
						pressureDone = true;
						handleMuxPayload({
							type: 'session/projection',
							sessionId: sid,
							key: 'contextPressure',
							value: { contextWindow: 100, pressureTokens: parseFloat(p[1]) }
						});
					}
				}
				if (usageDone && pressureDone) break;
			}
		} catch (e) {}
	}

	/* How many minutes ago the chip's own row stamp ("…02:17" /
	 * "9月1日 02:17") is. A conversation switch re-renders the WHOLE
	 * log and historical chips flow through this observer — they carry
	 * old stamps; a LIVE turn just ended, so its stamp is fresh. */
	/** Absolute epoch ms of a row's rendered stamp; 0 when no stamp parses.
	 * Same layouts as chipAgeMinutes (which now derives its age from this). */
	function chipStampMs(text) {
		var now = new Date();
		var m = text.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
		if (m) {
			var d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
			if (d.getTime() > Date.now() + 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2], +m[3], +m[4]);
			return d.getTime();
		}
		m = text.match(/(\d{1,2}):(\d{2})\s*$/);
		if (m) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]).getTime();
		return 0;
	}

	function chipAgeMinutes(text) {
		var stampMs = chipStampMs(text);
		if (!stampMs) return 0; /* no stamp parsed: treat as fresh */
		return (Date.now() - stampMs) / 60000;
	}

	/* does this batch touch the chat flow at all? (arming is flow-scoped:
	 * typing in the composer or sidebar activity must NOT arm the adapter) */
	function batchInFlow(mutations) {
		for (var i = 0; i < mutations.length; i++) {
			var t = mutations[i].target;
			if (t && t.closest && t.closest('[data-chat-flow]')) return true;
			var added = mutations[i].addedNodes;
			for (var j = 0; j < added.length; j++) {
				var n = added[j];
				var el = n.nodeType === 1 ? n : n.parentElement;
				if (el && el.closest && el.closest('[data-chat-flow]')) return true;
			}
		}
		return false;
	}

	/* --- runtime diagnostic switch: set localStorage 'dsh-whale:debug' to
	 * 'on' (the settings panel toggles it) — captures mutation fingerprints
	 * into the whale-assistant state doc `_debug` key for remote forensics. --- */
	function debugOn() {
		try { return localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) { return false; }
	}
	var attRe = /(允许|拒绝|批准|审核|等待|提问|需要你|approve|deny|reject|ask_user)/i;
	var ringBatches = [];
	var lastAttDumpAt = 0;
	function debugInject(payload) {
		if (!debugOn() || typeof fetch !== 'function') return;
		var attempt = function () {
			fetch('/api/whale-assistant/state').then(function (r) {
				return r.ok ? r.json() : {};
			}).catch(function () { return {}; }).then(function (doc) {
				if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = { v: 1, history: [] };
				doc._debug = payload;
				return fetch('/api/whale-assistant/save', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(doc)
				});
			}).catch(function () {});
		};
		setTimeout(attempt, 2500);
		setTimeout(attempt, 7000);
	}
	function dumpComposer() {
		var out = [];
		try {
			var cands = document.querySelectorAll('textarea, [contenteditable="true"], [class*="input" i], [class*="composer" i], [class*="editor" i]');
			for (var i = 0; i < cands.length && i < 8; i++) {
				var n = cands[i];
				out.push({
					tag: n.tagName,
					cls: String(n.className || '').slice(0, 150),
					ce: n.getAttribute ? n.getAttribute('contenteditable') : null,
					html: (n.outerHTML || '').slice(0, 500)
				});
			}
		} catch (e) {}
		return out;
	}
	function describeEl(n) {
		try {
			return { tag: n.tagName, cls: String(n.className || '').slice(0, 150), html: (n.outerHTML || '').slice(0, 2500) };
		} catch (e) { return { tag: '?', cls: '', html: '' }; }
	}

	/* gate state — consumed/mutated by decideChipAction (core/chip-gate.js) */
	var gate = {
		lastKnownTitle: document.title || '',
		streamingArmed: false,
		armStreak: 0,
		lastArmAt: 0,
		renderUntil: 0,
		turnEndUntil: 0
	};
	var lastChipElement = null; /* dedupe by ELEMENT reference, not text */
	var lastFailureAt = 0; /* failure-row throttle */
	var lastCompactAt = 0; /* compaction-banner throttle */
	var compactSeen = {}; /* sessionId -> last announced 已压缩 N 条历史 count */

	/* alpha tool rows never emit tool/result: a lazy sweep watches each
	 * tracked call's data-state and clears it when the row leaves the
	 * running state (or vanishes in a re-render), so the status hint and
	 * the stuck watchdog settle instead of flagging forever. */
	var seenCallIds = {};
	var pendingTools = {};
	var sweepTimer = null;
	function ensureToolSweep() {
		if (sweepTimer || typeof setInterval !== 'function') return;
		sweepTimer = setInterval(function () {
			for (var id in pendingTools) {
				var state = 'gone';
				try {
					var row = document.querySelector('[data-chat-call-id="' + String(id).replace(/"/g, '') + '"] [data-state]');
					if (row) state = row.getAttribute('data-state') || 'gone';
				} catch (e) {}
				if (state !== 'running') {
					var t = pendingTools[id];
					delete pendingTools[id];
					synthOn(t.sid, 'tool/result', { callId: id });
				}
			}
		}, 2500);
	}

	/** 每窗口归属（P1 2026-10-28）：从一批 DOM 变动里找「非鲸鱼自身的」新增
	 * 元素——找到才把此刻的全局链会话快照进本窗口 pin（utils/session-key.js）。
	 * 批内全是鲸鱼内部节点时不写：在 A 窗口开鲸鱼菜单/气泡不该把 B 窗口刚切
	 * 的全局键钉进来。pin 只在值变化时落盘，流式 token 的高频批次零写入。 */
	var whaleRootCache = null;
	function adoptLocalChatActivity(mutations) {
		try {
			var whaleRoot = (whaleRootCache && whaleRootCache.parentNode)
				? whaleRootCache
				: (whaleRootCache = document.getElementById('dsh-whale'));
			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (node.nodeType !== 1) continue;
					if (whaleRoot && (node === whaleRoot || (whaleRoot.contains && whaleRoot.contains(node)))) continue;
					adoptCurrentSessionPin();
					return;
				}
			}
		} catch (e) {}
	}

	var observer = new MutationObserver(function (mutations) {
		adoptLocalChatActivity(mutations);
		/* pass 1 — count elements FIRST (cheap refs only): text measurement
		 * is skipped for huge batches (they are renders by definition and
		 * their chips are ignored) — the whole subtree textContent read was
		 * the single most expensive thing on conversation switches */
		var addedElsList = [];
		for (var i = 0; i < mutations.length; i++) {
			var added = mutations[i].addedNodes;
			for (var j = 0; j < added.length; j++) {
				if (added[j].nodeType === 1 && addedElsList.length < 400) addedElsList.push(added[j]);
			}
		}
		var bigCount = addedElsList.length > 60;
		var chips = [];
		var addedChars = 0;
		var removedChars = 0;
		var attNodes = [];
		var runningToolNodes = [];
		if (!bigCount) {
			for (var a = 0; a < addedElsList.length; a++) {
				var node = addedElsList[a];
				var text = node.textContent || '';
				addedChars += text.length;
				if (text.indexOf('用量') >= 0 && text.indexOf('tok') >= 0) {
					var chipEl = node.querySelector ? node.querySelector('[class*="label"]') : null;
					if (!chipEl) chipEl = node;
					chips.push(chipEl);
				}
				/* '运行中' is the hidden label of a tool row in its running
				 * state — a cheap pre-filter before the querySelector below */
				if (runningToolNodes.length < 6 && text.indexOf('运行中') >= 0) runningToolNodes.push(node);
				if (debugOn() && attNodes.length < 4 && attRe.test(text)) attNodes.push(node);
			}
		} else {
			/* big render: still check a bounded slice for RUNNING tool rows
			 * (switching to a conversation whose turn is live) */
			for (var b = 0; b < addedElsList.length && b < 12; b++) {
				var n2 = addedElsList[b];
				if (n2.querySelector && n2.querySelector('[data-tool][data-state="running"]')) runningToolNodes.push(n2);
			}
			addedChars = 99999; /* forces the bulk-render path */
		}
		if (debugOn()) {
			for (var k = 0; k < mutations.length; k++) {
				var removed = mutations[k].removedNodes;
				for (var r = 0; r < removed.length; r++) removedChars += (removed[r].textContent || '').length;
			}
		}
		var inFlow = batchInFlow(mutations);

		if (debugOn()) {
			ringBatches.push({ t: Date.now(), els: addedElsList.length, ch: addedChars, rm: removedChars, fl: inFlow ? 1 : 0, chips: chips.length });
			if (ringBatches.length > 200) ringBatches.shift();
			if (attNodes.length > 0 && Date.now() - lastAttDumpAt > 2000) {
				lastAttDumpAt = Date.now();
				debugInject({ kind: 'attention', at: lastAttDumpAt, title: document.title, matches: attNodes.map(describeEl), composer: dumpComposer(), batches: ringBatches.slice(-80) });
			}
		}

		var now = Date.now();

		/* attention + tool status (live-verified): ask_user_question running
		 * = the turn is BLOCKED waiting for the user → question/requested 🤔.
		 * Any OTHER running tool = live tool status 🔧. Historical rows
		 * re-render with a non-running state, so re-renders never re-fire;
		 * the call id dedupes the spinner's own childList churn.
		 * SWITCH GUARD (2026-09-02): a conversation switch re-renders the
		 * pending question row and used to ring a SECOND 🤔 right after the
		 * background channel's own — now a batch that belongs to a switch
		 * (title just changed, or inside a render tail) never rings, and a
		 * callId the background channel already announced (shared
		 * __dshWhale.attSeen) is skipped too. */
		var switchRender = (document.title || '') !== gate.lastKnownTitle || now < gate.renderUntil;
		for (var q = 0; q < runningToolNodes.length; q++) {
			var trow = runningToolNodes[q].querySelector('[data-tool][data-state="running"]');
			if (!trow && runningToolNodes[q].matches && runningToolNodes[q].matches('[data-tool][data-state="running"]')) {
				trow = runningToolNodes[q];
			}
			if (!trow) continue;
			var tool = trow.getAttribute('data-tool') || '';
			var callRow = trow.closest ? trow.closest('[data-chat-call-id]') : null;
			var callId = (callRow && callRow.getAttribute('data-chat-call-id')) || (tool + ':' + (trow.textContent || '').slice(0, 60));
			var sharedAttSeen = null;
			try { sharedAttSeen = window.__dshWhale && window.__dshWhale.attSeen; } catch (e) {}
			if (seenCallIds[callId]) continue;
			/* 09-12 修复：TOOL 行不再吃 switchRender 拦截——seenCallIds 已按
			 * callId 去重（切换重渲染同 id 不会双响，历史行重渲染非 running），
			 * 而旧拦截会让"首次渲染恰好落在切换/冷却窗口"的新工具调用被永久
			 * 错过（真机 09-12：新会话的 pwsh 行再无后续突变，一漏到底）。
			 * 🤔 提问保留全量拦截：双响 bug（09-02）的主角是它。 */
			if (tool === 'ask_user_question') {
				if (switchRender || (sharedAttSeen && sharedAttSeen[callId])) continue;
			} else if (sharedAttSeen && sharedAttSeen[callId]) {
				continue;
			}
			seenCallIds[callId] = 1;
			capObj(seenCallIds, 200); /* memory audit: one entry per question row ever rendered */
			var idKeys = Object.keys(seenCallIds);
			if (idKeys.length > 80) delete seenCallIds[idKeys[0]];
			var attSid = ensureRegistered();
			if (tool === 'ask_user_question') {
				handleMuxPayload({ type: 'question/requested', sessionId: attSid, time: now });
			} else {
				pendingTools[callId] = { sid: attSid, name: tool, at: now };
				ensureToolSweep();
				synthOn(attSid, 'tool/call', { name: tool, callId: callId });
			}
		}

		/* failure + compaction rows (small live batches only, armed):
		 * run AFTER the pure gate so renders/cooldowns can't echo them.
		 * NOTE: turn/start is NOT synthesized here any more — the composer
		 * heuristic faked 开工 whenever DSH's own flow mutations (timestamp
		 * refreshes, lazy rows) landed inside the confirmation window; the
		 * server event bus now owns start announcements for every session. */
		var decision = decideChipAction(gate, {
			now: now,
			title: document.title || '',
			addedEls: addedElsList.length,
			addedChars: addedChars,
			chipCount: chips.length,
			inFlow: inFlow
		});

		/* failure rows: "本轮运行失败 5xx …" — only while the turn is LIVE
		 * (streamingArmed); retries can emit several rows, so throttle */
		if (!bigCount && decision.action !== 'skip-render' && streamingFailureCheck(mutations)) {
			/* handled inside the check */
		}

		function streamingFailureCheck(muts) {
			if (now - lastFailureAt < 15000 || !gate.streamingArmed) return false;
			for (var fi = 0; fi < muts.length; fi++) {
				var fadded = muts[fi].addedNodes;
				for (var fj = 0; fj < fadded.length; fj++) {
					var fnode = fadded[fj];
					if (fnode.nodeType !== 1) continue;
					var ftext = fnode.textContent || '';
					if (ftext.indexOf('本轮运行失败') >= 0 || ftext.indexOf('已达到每') >= 0) {
						lastFailureAt = now;
						gate.streamingArmed = false;
						gate.armStreak = 0;
						seeEndFire(resolveCurrentSessionId(), 'fail');
						synth('turn/end', { reason: { kind: 'error' } });
						return true;
					}
				}
			}
			return false;
		}

		/* compaction banner: "已压缩 N 条历史记录". The banner is PART of the
		 * rendered log — a conversation switch re-renders it, which used to
		 * pop a 🧹 bubble AND count into the unread badge (user-reported
		 * bug). Now: only a LIVE stream (streamingArmed) may announce, the
		 * banner's N is deduped per session (announce only when N grows),
		 * and it never enters the unread queue — bubble only, no badge. */
		if (!bigCount && gate.streamingArmed && now - lastCompactAt > 600000) {
			for (var ci = 0; ci < addedElsList.length; ci++) {
				var ctext = addedElsList[ci].textContent || '';
				var cm = /已压缩\s*(\d+)\s*条历史/.exec(ctext);
				if (cm) {
					var csid = ensureRegistered();
					var cN = parseInt(cm[1], 10) || 0;
					if (compactSeen[csid] !== cN) {
						compactSeen[csid] = cN;
						capObj(compactSeen, 100); /* memory audit */
						lastCompactAt = now;
						try { say('🧹 上下文刚被压缩：更早的对话已折叠', 4500, csid); } catch (e) {}
					}
					break;
				}
			}
		}

		if (decision.action === 'skip-render' || decision.action === 'skip') {
			if (chips.length) lastChipElement = chips[chips.length - 1];
			return;
		}
		if (decision.action === 'arm') {
			return;
		}
		/* action === 'chip': the single live finish */
		if (bigCount) renderUntilTail();
		function renderUntilTail() { gate.renderUntil = Math.max(gate.renderUntil, now + 2500); }
		var chip = chips[0];
		if (chip === lastChipElement) return; /* same element re-delivered */
		lastChipElement = chip;
		/* freshness gate: the chip's own row carries its stamp; anything
		 * older than 10 minutes is a re-rendered history row */
		var row = chip;
		var flow = row.closest ? row.closest('[data-chat-flow]') : null;
		if (flow) { while (row.parentElement && row.parentElement !== flow) row = row.parentElement; }
		var chipStampText = (row.textContent || '') + ' ' + (chip.textContent || '');
		var age = chipAgeMinutes(chipStampText);
		if (age > 10) return;
		var turnTokens = readTurnUsage();
		/* health sample: a REAL turn finish with nothing read is one strike
		 * against the usage selector (3 in a row = degraded, see health.js) */
		recordUsageHealth(turnTokens > 0);
		if (turnTokens > 0) turnTokenUsage = turnTokens;
		var sid = ensureRegistered();
		/* per-session ledger (用户报告 09-20): the DOM chip is the official
		 * number for the active turn — write THIS session's ledger entry so
		 * a completion report can never read another conversation's burn.
		 * FLOOR guard (0.2.0 desktop, 用户报告 09-30): the server
		 * assistant/message frame is now forwarded for the active session
		 * too and ADDS per-reply deltas (multi-step turns sum correctly);
		 * the chip only reads the NEWEST row's total, so a blind .set()
		 * would CLOBBER the accumulated ledger back down to the last step.
		 * The chip may only RAISE the ledger — it stays the backstop for
		 * engines/hosts where the server frame never arrives.
		 * STALE guard (same report round): a chip whose row stamp is from a
		 * minute BEFORE the current turn's start belongs to the PREVIOUS
		 * turn (back-to-back tasks race the chip render) — writing it would
		 * pre-inflate the new turn's ledger by the whole previous burn.
		 * Minute-granular stamps keep a +60s slack (same-minute chips pass). */
		var stampMs = chipStampMs(chipStampText);
		var startedAt = sessionTurnStartedAt(sid);
		var staleChip = !!(stampMs && startedAt && startedAt > stampMs + 60000);
		if (turnTokens > 0 && turnTokens > sessionTurnTokens(sid) && !staleChip) {
			turnTokensBySession.set(sid, turnTokens);
			if (typeof patchEndSnapshots === 'function') patchEndSnapshots(sid);
		}
		feedSessionUsage(sid); /* cumulative burn for the status panel */
		/* the stats node may render a beat after the chip: re-feed once */
		setTimeout(function () {
			feedSessionUsage(resolveCurrentSessionId());
			backfillEndPanel(resolveCurrentSessionId()); /* 迟到的芯片数字补全面板 */
		}, 800);
		/* mirror guard (09-06 B3): the polled frame may have announced this
		 * same end first (active-session completed now passes the poll gate);
		 * an ±8s match means one physical end — stay silent, keep the usage */
		if (endFiredFor(sid, 'success', Date.now(), 8000)) return;
		seeEndFire(sid, 'success');
		synth('turn/end', { reason: { kind: 'success' } });
		if (debugOn()) debugInject({ kind: 'turn-end', at: Date.now(), title: document.title, composer: dumpComposer(), batches: ringBatches.slice(-150) });
	});

	/* observe BODY, not the flow node: creating/switching conversations
	 * replaces [data-chat-flow] entirely, which would leave a flow-scoped
	 * observer detached (notifications silently die after any switch).
	 * The callback filters cheaply, so the wider scope costs little. */
	function attach() {
		/* the page-load render of the active conversation must never count
		 * as live activity: start in the cooldown window, unarmed */
		gate.renderUntil = Date.now() + 2500;
		observer.observe(document.body, { childList: true, subtree: true });
		ensureRegistered(); /* register now so the title fetch races early */
		/* initial usage + context-pressure read (the load render already
		 * put the stats bar / context meter on screen) */
		setTimeout(function () { feedSessionUsage(resolveCurrentSessionId()); }, 1200);
	}
	attach();
	/* debug seam: live gate state for diagnosing switchRender stalls */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._gate = gate;
	} catch (e) {}
	})();
/* ---- module: src/core/dedup.js ---- */
/**
 * Cross-channel event dedup (inline module): ONE place that owns every
 * "this exact event already spoke" decision, with EXPLICIT keys and
 * RING-CAPPED storage (the three ad-hoc maps this replaces — bgSeen,
 * attSeen-writes and the single-slot lastEndFire — grew without bound or
 * could shadow each other; the single-slot lastEndFire even let two
 * interleaved failing sessions defeat each other's 30s suppression).
 *
 * Coverage matrix (why each class is in or out):
 *   question/approval — IN  : the one class both channels can legitimately
 *                             produce (server forwards background rows, the
 *                             DOM adapter renders active ones, and a session
 *                             can flip active↔background mid-question).
 *                             Key = the natural callId; time fallback keeps
 *                             a SHORT window because two REAL questions can
 *                             land in the same second (never fold those).
 *   fail/max-tokens   — IN  : DOM failure-row + server authoritative frame
 *                             describe the same turn; keyed PER SESSION so
 *                             sessions never shadow each other. The DOM
 *                             success chip also records an end-fire (parity
 *                             with the old lastEndFire semantics).
 *   done              — IN (09-06): the "channels are disjoint" assumption
 *                             broke once in the wild (question-answer flow,
 *                             active-detection race → the same end announced
 *                             by both the chip adapter and the polled frame).
 *                             Keyed by EVENT TIME ±8s: the same physical end
 *                             seen by both clocks matches (single machine),
 *                             while a real quick repeat completion carries
 *                             its own endTime seconds away and still
 *                             announces.
 *   turn/start        — OUT : already throttled per session (15s) in
 *                             server-events + boot-time silence.
 */

var DEDUP = {
	attention: {}, /* callId-ish -> 1 (shared with the DOM adapter via window.__dshWhale.attSeen) */
	endFire: {}    /* sessionId -> { kind: 'success'|'fail', at } */
};
var DEDUP_CAP = {
	attention: 200,
	endFire: 50
};

/** Ring-prune one bucket to its cap, evicting the oldest keys first. */
function pruneDedup(bucket) {
	var cap = DEDUP_CAP[bucket] || 100;
	var keys = Object.keys(DEDUP[bucket]);
	while (keys.length > cap) {
		delete DEDUP[bucket][keys.shift()];
		keys = Object.keys(DEDUP[bucket]);
	}
}

/** Generic ring-cap for plain OBJECT accumulators (oldest keys evicted
 * first). Used by the per-session Maps/objects that used to grow without
 * bound across days-long page lifetimes (memory audit, P2⑨). */
function capObj(obj, cap) {
	var keys = Object.keys(obj);
	var excess = keys.length - cap;
	for (var i = 0; i < excess; i++) delete obj[keys[i]];
}

/** Generic ring-cap for Map accumulators (Map preserves insertion order,
 * so first-inserted = oldest). Same memory-audit purpose. */
function capMap(map, cap) {
	if (map.size <= cap) return;
	var excess = map.size - cap;
	var it = map.keys();
	for (var i = 0; i < excess; i++) {
		var k = it.next();
		if (k.done) break;
		map.delete(k.value);
	}
}

/**
 * Record an attention event key. Returns true the FIRST time the key is
 * seen (caller may announce), false on repeats. The map lives on
 * window.__dshWhale.attSeen so the DOM adapter's switch-render guard keeps
 * reading the very same object it always has.
 */
function seeAttention(key) {
	if (!key) return false;
	try {
		window.__dshWhale = window.__dshWhale || {};
		var seen = window.__dshWhale.attSeen = window.__dshWhale.attSeen || DEDUP.attention;
		if (seen[key]) return false;
		seen[key] = 1;
		DEDUP.attention = seen;
		pruneDedup('attention');
		return true;
	} catch (e) {
		return true; /* storage hiccups must never eat a real question */
	}
}

/** Record that THIS session's turn just ended with `kind` on the DOM side.
 * `endTime` (ms epoch of the ended event; default now) powers the
 * cross-channel completion dedup: the polled frame for the SAME end carries
 * the same wall-clock second (single machine), so an ±8s match means "same
 * physical end", never "a second quick end". */
function seeEndFire(sessionId, kind, endTime) {
	if (!sessionId) return;
	DEDUP.endFire[sessionId] = {
		kind: kind || 'success',
		at: Date.now(),
		endAt: typeof endTime === 'number' ? endTime : Date.now()
	};
	pruneDedup('endFire');
}

/** True when a same-kind end with an event time within `tolMs` of `endTime`
 * was already announced by the other channel — the completion dedup key
 * (see the matrix: done is IN since 09-06, keyed by event time so legitimate
 * quick repeat completions still announce). */
function endFiredFor(sessionId, kind, endTime, tolMs) {
	var rec = DEDUP.endFire[sessionId];
	if (!rec || rec.kind !== (kind || 'success')) return false;
	if (typeof rec.endAt !== 'number' || typeof endTime !== 'number') return false;
	return Math.abs(rec.endAt - endTime) <= (tolMs || 8000);
}

/**
 * True when THIS session's DOM side already announced an end recently:
 * a failure within `failMs` suppresses the server's authoritative failure
 * frame for the same turn; any end within the window keeps parity with the
 * old single-slot lastEndFire (now per session, so two sessions failing in
 * interleaved order can no longer shadow each other's suppression).
 */
function endFiredRecently(sessionId, failMs, anyMs) {
	var rec = DEDUP.endFire[sessionId];
	if (!rec) return false;
	var now = Date.now();
	if (rec.kind === 'fail' && now - rec.at < (failMs || 30000)) return true;
	return now - rec.at < (anyMs || 30000);
}
/* ---- module: src/core/server-events.js ---- */
/**
 * Server-events consumer (inline module): polls the whale-assistant host's
 * /api/whale-assistant/events route (the host lives in the dsh server's cordis
 * container and buffers session events for EVERY session) and feeds the
 * frames the DOM adapter cannot see:
 *
 *   - turn/start of EVERY session (2026-09-02 revision: start announces
 *     moved here ENTIRELY — DOM composer heuristics faked 开工 whenever
 *     DSH's own flow mutations landed in the confirmation window)
 *   - turn/end + turn/start of BACKGROUND sessions (the whole point: the
 *     DOM only renders the conversation you are looking at)
 *   - turn/end with reason error/max-tokens for ANY session (authoritative
 *     failure reasons — the DOM has no failure signal for finished turns)
 *   - turn/end with reason aborted for the ACTIVE session too (a manual stop
 *     renders no chip at all — 09-06: the ⏳ timer otherwise never stops)
 *   - title projections of background sessions (real names in notifications)
 *
 * The ACTIVE session's instant signals stay with the DOM adapter (chip
 * finish, question rows); this consumer skips those end frames so nothing
 * double-fires.
 */
	(function initServerEvents() {
	if (typeof fetch !== 'function' || typeof setInterval !== 'function') return;

	/* active-session id resolution lives in utils/session-key.js
	 * (resolveCurrentSessionId) — shared verbatim with alpha-adapter. */

	/* 3s poll (was 8s): the route is a cheap in-memory slice, and the user
	 * reported the background latency as too high. NOTE this only helps
	 * while the window renders — the desktop shell now sets
	 * backgroundThrottling:false so a minimized DSH keeps real timers. */
	var POLL_MS = 3000;
	var lastSeq = 0;
	/* the host resets its seq counter on every restart: the persisted
	 * last-seq is only valid WITHIN one boot generation (keyed by bootId).
	 * Without this, a page that survived a server restart drops every new
	 * frame until the counter crawls past the stale value — background
	 * notifications then arrive in one late burst (live-verified bug). */
		var state = { bootId: null, seq: 0 };
		try {
			/* localStorage, not sessionStorage: closing and reopening the shell
			 * within one service boot must NOT replay frames the previous
			 * window already consumed (09-06 real-machine: replay re-announced
			 * completions and re-recorded history with inflated token sums).
			 * bootId keying still resets on a host restart; frames emitted
			 * while no window was open carry higher seqs and still arrive. */
			state = JSON.parse(localStorage.getItem('dsh-whale:evseq') || 'null') || state;
		} catch (e) {}
	lastSeq = state.seq || 0;
	var knownBootId = state.bootId;
	var bootAt = Date.now();
	var lastStartAt = {}; /* per-session turn/start announce throttle */
	var lastEndAt = {}; /* per-session last turn/end seen (throttle refinement) */
	/* batch fold: how many completed turn/ends of the SAME session ride in
	 * one poll batch (a hidden/throttled tab lets minutes of events pile up
	 * in a single fetch). FOLD_MIN or more collapse into ONE 📦 summary
	 * announcement — history still records every turn. */
	var FOLD_MIN = 3;

	function rememberSeq(n) {
		lastSeq = n;
		try { localStorage.setItem('dsh-whale:evseq', JSON.stringify({ bootId: knownBootId, seq: n })); } catch (e) {}
	}

	/* 桌宠仲裁判定（第一批；11-01 语义修正）：页内休眠 = 桌宠开启且**已就绪**
	 * ——与形态无关。隐藏形态下桌宠窗口仍在（进程活着、托盘可召回），页鲸
	 * 必须保持休眠：唤醒页鲸会把「隐藏桌宠」变成事实上的「退出桌宠」（真机
	 * 取证 11-01：用户看到鲸鱼跳回 DSH 右下角=语义混淆）。召回入口=托盘
	 * （点击/右键菜单「🐋 显示小鲸鱼」）+首次隐藏的气球提示。up=false =
	 * 桌宠还在 spawn 窗口期/已阵亡——页鲸原地不动（接力式交接）：等桌宠
	 * 窗口真出现了（ready 握手）才潜水让位。 */
	function petDormantOf(enabled, form, up, spawning) {
		void form;
		/* 常驻架构修订（11-05，用户实报「下午打开时桌宠和 DSH 里的小金鱼同时
		 * 出现，过一会 DSH 里面的才消失」）：spawn 窗口期（up=false 且
		 * spawning=true）页鲸也休眠——桌宠马上要出现，页鲸先顶班再潜水就是
		 * 双鲸同屏（真机抓包 t2.9→t4.3 两鲸重叠 2s；「up=false 页鲸顶班」是
		 * 交接时代语义，交接已随第九轮常驻架构退役）。spawn 失败（up=false
		 * 且 spawning=false）页鲸照旧苏醒兜底，永不无鱼可看。 */
		return !!(enabled && (up !== false || spawning));
	}

	function feedEventFrame(frame) {
		var sid = frame.sessionId;
	/* 桌宠（第一批）：feed 会话是宿主编码的合成 id（PET_SID_PREFIX =
	 * 'session-pet-sN'，带主会话前缀才能过子代理静默闸门——冒烟实测）。
	 * 这里就地给合成会话一个稳定名字「任务 N」，通知读起来是
	 * 「任务 3 完成了 ✅」；rememberTitle 写 pet profile 的 localStorage
	 * ——只有合成名，没有真实标题。 */
		if (PET_MODE && sid && sid.indexOf(PET_SID_PREFIX) === 0) {
			try {
				var existingPetName = sessionTitles.get(sid) || '';
				if (!existingPetName) {
					var petName = '任务 ' + (parseInt(String(sid).slice(PET_SID_PREFIX.length), 10) || '?');
					sessionTitles.set(sid, petName);
					rememberTitle(sid, petName);
				}
			} catch (e) {}
		}
		var event = frame.event || {};
		var active = resolveCurrentSessionId();
		var isActive = sid === active;
		var type = event.type;
		if (type === 'turn/end') {
			var reason = event.data && event.data.reason && event.data.reason.kind;
			/* throttle bookkeeping FIRST, before any dedup/announce return:
			 * a genuinely NEW turn is "an end arrived after the last start",
			 * no matter which announcement path that end takes below */
			lastEndAt[sid] = Date.now();
			capObj(lastEndAt, 100); /* memory audit */
			/* the timer stop must NOT hang on the announcement paths: the
			 * dedup return below (chip fired first) and the fail-window
			 * return both run BEFORE the processed branch's stopRunTimer —
			 * a 2s dev-say turn leaked a 1h ⏳ row exactly that way (09-06
			 * 真机 B6: chip announced, polled end dedup-dropped, slot lived
			 * on). Stop is idempotent; announcement gating is untouched. */
			try { stopRunTimer(sid); } catch (e) {}
			if (isActive) {
				/* the DOM adapter already fired success for a visible chip;
				 * only authoritative FAILURES may speak here, and only when
				 * the DOM did not just announce this same turn (per-session
				 * keyed — the old single-slot lastEndFire let two sessions
				 * failing in interleaved order defeat each other's 30s
				 * suppression) */
				/* 'completed' joins the pass list (09-06 真机 B3): when the
				 * adapter never armed for this turn (turn started before the
				 * page loaded, or an ask-card resumed without a composer) the
				 * chip NEVER fires and the visible completion was silently
				 * lost — no record, no bell. The ±8s endFiredFor below (and
				 * the chip-side mirror guard) absorb the normal double. */
				if (reason !== 'error' && reason !== 'max-tokens' && reason !== 'aborted' && reason !== 'completed') return;
				/* a manual stop (reason aborted, 09-06 用户报告: 手动停止后
				 * ⏳ 计时仍在走) has NO DOM signal at all — a killed turn
				 * never renders a usage chip — so this polled frame is the
				 * ONLY stop signal the whale gets: the run timer, the ⏹
				 * history row and the 被中止了 announcement all hang on it.
				 * It must also skip endFiredRecently: that 30s fail window
				 * would swallow a legitimate stop → restart → stop. */
				if (reason !== 'aborted' && !frame.replaySuppress && endFiredRecently(sid)) return;
			}
			/* 审计 B1（2026-11-04）：重放批帧豁免活页面竞态短路——dedup/
			 * endFiredRecently 是为「同代活页面双通道竞态」设计的（同一次
			 * 完成两条通道各报一次）；重启恢复流的语义是**只记账**（suppress
			 * 已由 consume 标定），不该被这些窗口整个丢弃——丢弃=照记契约
			 * 失效（红标/历史全丢）。 */
			/* cross-channel completion dedup (09-06): the active-session
			 * check above can race (chip gate / session tracking) and the
			 * DOM chip adapter may have JUST announced this same end —
			 * same physical end = same wall clock within seconds; a real
			 * new completion carries its own endTime and still announces */
			if (reason === 'completed' && !frame.replaySuppress && endFiredFor(sid, 'success', frame.time || Date.now(), 8000)) return;
			try { registerBackground(sid); } catch (e) {}
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: {
					type: 'turn/end', time: frame.time || Date.now(), seq: frame.seq, data: event.data || {},
					/* batch-fold markers (set by consume's pre-scan): all but
					 * the newest completed turn of a flood session announce
					 * NOTHING; the newest announces for the whole batch */
					foldSuppress: event.foldSuppress || undefined,
					foldCount: event.foldCount || undefined,
					/* 重放批标记（审计 B1，2026-11-04）：consume 在**外层信封**
					 * 上标 replaySuppress（bootId 换代+boot 前帧），这里构造
					 * 内层 event 时必须带上——此前丢失=frames 的四条通知路径
					 * 永远看不到标记，「重放批静默」从未真正生效（第十三轮
					 * 夜间验证被免打扰+autoplay 掩盖，真机从未听到） */
					replaySuppress: event.replaySuppress || frame.replaySuppress || undefined
				}
			});
			return;
		}
		if (type === 'approval/asked') {
			/* 审核请求（11-06，用户实报「提问能通知，审核通知不了」）：
			 * approval/requested 在鲸鱼里只有消费壳（frames.js 的 ⚠️ 分支）
			 * 而零生产者——审核通知从未被实现。DSH 0.2.1 的审批事件类型
			 * approval/asked {id, toolName, callId?, reason?}（asar 类型表
			 * 实证）。若它流经 session 事件总线，这里转成注意帧（⚠️
			 * [会话名]需要你审核，reportAttention 现成）；active+后台都走
			 * （页鲸休眠期间 DOM 不可见=桌宠/页鲸唯一通知源），seeAttention
			 * 共享去重（SSE/轮询双通道 race + 未来 DOM 检测同 key 合流）。 */
			var aData = event.data || {};
			var aKey = aData.callId || aData.id || ('a:' + (frame.time || ''));
			if (seeAttention(aKey)) {
				try { registerBackground(sid); } catch (e) {}
				handleMuxPayload({ type: 'approval/requested', sessionId: sid, time: frame.time || Date.now() });
			}
			return;
		}
		if (type === 'session/title') {
			/* rc.1 broadcasts titles as session/title EVENTS (data.title,
			 * source kind fallback/llm) while ctx.sessionProjections.onChanged
			 * has never fired on this build (09-06 real-machine test: 0
			 * projection frames all boot) — so a question raised before the
			 * name was known kept [未命名任务] in the bubble, the unread row
			 * AND history forever. Translate the event into the projection
			 * payload the page already consumes; needed for ACTIVE and
			 * background sessions alike, and idempotent on re-writes. */
			var t = event.data && event.data.title;
			if (t && typeof t === 'string') {
				handleMuxPayload({ type: 'session/projection', sessionId: sid, key: 'title', value: t });
			}
			return;
		}
		if (type === 'approval/asked' && PET_MODE) {
			/* 桌宠（11-06）：枚举 feed/SSE 里的审核请求（宿主白名单只放行
			 * toolName）→ ⚠️ 注意帧。去重键带 frame.seq——feed 轮询整环重放
			 * 靠 consume 的 lastSeq 闸门，这里再兜 SSE/poll 双通道 race。 */
			if (seeAttention('pet-a:' + (frame.seq || event.time || ''))) {
				try { registerBackground(sid); } catch (e) {}
				handleMuxPayload({ type: 'approval/requested', sessionId: sid, time: frame.time || Date.now() });
			}
			return;
		}
		if (type === 'tool/call' && !isActive) {
			/* a question raised in a BACKGROUND session must still ring:
			 * convert its tool/call into the attention frame the whale
			 * speaks (the DOM adapter does this for the visible one). The
			 * callId goes into the SHARED dedup map (seeAttention, ring-
			 * capped) so the DOM adapter's switch re-render of the same row
			 * never rings a second 🤔. */
			if (event.data && event.data.name === 'ask_user_question') {
				var qKey = event.data.callId || ('q:' + (frame.time || ''));
				if (seeAttention(qKey)) {
					try { registerBackground(sid); } catch (e) {}
					handleMuxPayload({ type: 'question/requested', sessionId: sid, time: frame.time || Date.now() });
				}
				return;
			}
			/* other background tools: tracked for the stuck watchdog ONLY —
			 * the 🔧 line stays active-session-only (forwarding it would
			 * flicker the panel for work the user isn't watching). 09-12
			 * 多会话卡住提示需要每个会话的工具都在册。 */
			try {
				if (window.__dshWhale && window.__dshWhale._trackTool) {
					window.__dshWhale._trackTool(
						(event.data && event.data.callId) || ('bg:' + (frame.time || '')),
						sid
					);
				}
			} catch (e) {}
			return;
		}
		if (type === 'tool/result' && !isActive) {
			/* the tracking twin of the branch above: a background tool result
			 * retires its watchdog entry (turn/end is the coarse fallback) */
			try {
				if (window.__dshWhale && window.__dshWhale._clearTool && event.data) {
					window.__dshWhale._clearTool(event.data.callId);
				}
			} catch (e) {}
			return;
		}
		if (type === 'turn/start') {
			/* AUTHORITATIVE start for EVERY session (active included): the
			 * server event means a turn really began — no heuristics. A
			 * start that predates the page load means the turn was already
			 * mid-flight when we loaded: stay silent (its turn/end will
			 * still speak), otherwise a reload during a long turn would
			 * announce a bogus 开工. A 15s per-session throttle absorbs any
			 * duplicate emissions.
			 * (2026-09-03 hotfix: this guard read `f.time` — `f` is the
			 * POLL LOOP's local, not a name in this function. Every
			 * turn/start threw ReferenceError, silently swallowed by the
			 * poll catch, and 开工了 never announced. The variable is
			 * `frame`; the event time lives at frame.event.time.) */
			var startAt = event.time || frame.time;
			if (startAt && startAt < bootAt - 5000) return;
			var nowMs = Date.now();
			/* throttle ONLY duplicate emissions of the SAME turn: a start is
			 * stale when it is recent AND no turn/end arrived since it. The
			 * bare 15s window used to swallow GENUINE back-to-back turns too
			 * (retry right after a failure, quick follow-up) — and the
			 * swallowed forward carries the ledger reset, the turn stamp and
			 * the ⏳ timer start, so the next report summed onto the previous
			 * turn's burn. An end after the last start re-arms everything. */
			if (lastStartAt[sid] && nowMs - lastStartAt[sid] < 15000 && !(lastEndAt[sid] && lastEndAt[sid] > lastStartAt[sid])) return;
			lastStartAt[sid] = nowMs;
			capObj(lastStartAt, 100); /* memory audit */
			try { registerBackground(sid); } catch (e) {}
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: 'turn/start', time: startAt || Date.now(), seq: frame.seq, data: event.data || {} }
			});
			return;
		}
		if (type === 'assistant/message') {
			/* per-model-reply usage: THE authoritative source of THIS-turn
			 * token burn for EVERY session — it lands ~1ms before turn/end,
			 * so the completion report reads a full ledger on first render.
			 * Forwarded for BACKGROUND sessions since 2026-09-03 (the DOM
			 * chip cannot see them); the old `&& !isActive` gate also
			 * dropped the ACTIVE session's frame on the 0.1.x assumption
			 * that the visible chip covers it — on the 0.2.0 desktop the
			 * chip renders 0.4s+ late and sometimes never, so completion
			 * panels lost the 此次任务 line entirely (用户报告 09-30, proven
			 * by driving _pollConsume live: active frame dropped, background
			 * counted). The chip path (alpha-adapter) keeps its floor-guard
			 * write, so both engines stay correct when this frame is absent. */
			touchActivity();
			handleMuxPayload({
				type: 'session/event',
				sessionId: sid,
				event: { type: 'assistant/message', time: frame.time || Date.now(), seq: frame.seq, data: event.data || {} }
			});
			return;
		}
		/* tool/call, tool/result, step/start: the active session's DOM covers
		 * status instantly; background tool noise would only flicker the
		 * panel — intentionally not forwarded */
	}

	/** A background session needs registration before reportTurn speaks,
	 * and a title before the notification reads well. The server-side
	 * 'title' projection names it; until one arrives the registered
	 * placeholder keeps the notification generic instead of wrong. */
	function registerBackground(sid) {
		try {
			if (window.__dshWhale && window.__dshWhale.subagentSessions && !window.__dshWhale.subagentSessions.get(sid)) {
				handleMuxPayload({
					type: 'session/projection',
					sessionId: sid,
					key: 'subagentTiming',
					value: {}
				});
			}
		} catch (e) {}
		lookupTitlesFromHistory();
	}

	/* Title projections are PUSH-ON-CHANGE: right after a page reload no
	 * title frame flows, so the first background notification announced
	 * itself as [未命名任务]. The whale's OWN synced history knows every
	 * conversation's latest name — one fetch prefills them all. Runs once
	 * at startup AND on the first background registration. */
	var titlesLookedUp = false;
	function lookupTitlesFromHistory(force) {
		/* 桌宠：不取真实标题（枚举化边界），命名由 feedEventFrame 的合成名负责 */
		if (PET_MODE) return;
		if (titlesLookedUp && !force) return;
		titlesLookedUp = true;
		if (typeof fetch !== 'function') return;
		fetch('/api/whale-assistant/state').then(function (r) {
			return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status));
		}).then(function (doc) {
			var hist = doc && Array.isArray(doc.history) ? doc.history : [];
			var set = 0;
			for (var i = 0; i < hist.length; i++) {
				var h = hist[i];
				if (!h || !h.sessionId || !h.title || h.title === '未命名任务') continue;
				try {
					if (!sessionTitles.get(h.sessionId)) { sessionTitles.set(h.sessionId, h.title); set++; }
					var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
					var info = subs && subs.get(h.sessionId);
					if (info && !info.title) info.title = h.title;
				} catch (e) {}
			}
			try {
				fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'title-prefill', at: Date.now(), records: hist.length, set: set }) });
			} catch (e) {}
		}).catch(function (e) {
			try {
				fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ kind: 'title-prefill-error', at: Date.now(), error: String(e && e.message || e) }) });
			} catch (e2) {}
		});
	}
	lookupTitlesFromHistory(true);

	/* pet 即时帧「执行一次」闸（11-14，用户实报「桌宠菜单刷新一次，DSH
	 * 页连刷好几次」）：pet/jump、pet/reload-page、pet/open-settings 在
	 * consume 的 seq 闸门之前处理（即时动作语义），帧的 seq 永不入账
	 * ——10s 时间窗内每次 boot 轮询/SSE 重放都会重新送达：reload 重放
	 * =连刷 N 次（reload 循环 ~2s < 10s 窗），jump/open-settings 重放
	 * =动作重演。sessionStorage 按「类型+时间戳」记账：同一帧只在首个
	 * 消费者执行一次；新点击=新时间戳=照常执行。sessionStorage 跨
	 * reload 存活（同 tab）=重载链上的全部重放被拦；无账本环境（桩缺
	 * 席/隐私模式）降级为旧行为照旧执行。 */
	var petFrameOnce = function (kind, time) {
		if (typeof window === 'undefined' || !window.sessionStorage || typeof window.sessionStorage.getItem !== 'function') return true;
		try {
			var key = 'dsh-whale:once-' + kind;
			if (String(window.sessionStorage.getItem(key)) === String(time)) return false;
			window.sessionStorage.setItem(key, String(time));
		} catch (e) { return true; }
		return true;
	};

	/* 可见页回执清账（11-14，用户实报「跳转偶发弹开的是设置页」）：页鲸
	 * 可见态即时消费 jump/settings 后 POST /pet/ctrl clear-pending 清掉
	 * ledger 留守——pending 意图只服务「页鲸不在场」的补偿场景，可见页
	 * 已把动作落到用户眼前，留守只会变成下次唤醒的过期重演。隐藏页不
	 * 回执：v2 僵尸渲染层角落（消费了但窗口不可见）仍由补投兜底。 */
	var ackPendingClear = function (kind) {
		if (typeof document === 'undefined' || document.hidden) return;
		if (typeof fetch !== 'function') return;
		try {
			fetch('/api/whale-assistant/pet/ctrl', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'clear-pending', kind: kind })
			}).catch(function () {});
		} catch (e) { /* 回执失败无碍主流程：120s 新鲜闸仍是兜底 */ }
	};

	function consume(events, bootId) {
		var replayBatch = false;
		if (bootId && bootId !== knownBootId) {
			/* new host generation: its seq starts over — reset and only take
			 * frames newer than the swap */
			knownBootId = bootId;
			lastSeq = 0;
			rememberSeq(0);
			/* 桌宠重放批（11-03）：DSH 重启后整环重放——重启前 60s 内的完成
			 * 帧会**再响一次**（用户实报「任务提示音出现两次」）。历史恢复只
			 * 应**记账**（红标/历史），不应**重播**（say/音效/面板）。
			 * 审计 B1（2026-11-04）语义修正：**「上一代 bootId」必须取持久化
			 * 记录**——内存态 knownBootId 初始 null，首次连接（页面刚打开/
			 * 页面关闭期间的补达帧）也被判成「换代」→ 48b 的「补达要响」被
			 * 误杀。真重启的判据=**localStorage 里存过上一代 bootId 且 !=
			 * 本次**（页面重载后仍在=真的换宿主代了）；首次打开无记录=补达
			 * 场景，照常播报。 */
			var prevBoot = null;
			try { prevBoot = localStorage.getItem('dsh-whale:lastBootId'); } catch (e0) {}
			if (prevBoot && prevBoot !== bootId) replayBatch = true;
			try { localStorage.setItem('dsh-whale:lastBootId', bootId); } catch (e1) {}
		}
		/* --- batch-fold pre-scan ---: count each session's completed
		 * turn/ends that will actually feed this batch (same freshness and
		 * seq filters as the loop below). FOLD_MIN+ collapses into one 📦
		 * summary: all but the newest turn are marked foldSuppress (record
		 * silently), the newest carries foldCount and speaks for the batch. */
		var foldN = {};
		var foldLastSeq = {};
		var nowPre = Date.now();
		for (var pi = 0; pi < events.length; pi++) {
			var pf = events[pi];
			if (!pf || typeof pf.seq !== 'number' || pf.seq <= lastSeq) continue;
			/* freshness: host frames carry NO top-level time (only
			 * event.time) — the bare pf.time check was dead code and a seq
			 * reset re-announced/re-recorded the whole buffer (09-06 真机) */
			var pfTime = pf.time || (pf.event && pf.event.time);
			if (pfTime && nowPre - pfTime > 60000 && bootAt - pfTime > 60000) continue;
			if (pf.type !== 'session/event' || !pf.event || pf.event.type !== 'turn/end') continue;
			var pr = pf.event.data && pf.event.data.reason && pf.event.data.reason.kind;
			if (pr !== 'completed') continue; /* never fold failures/aborts */
			foldN[pf.sessionId] = (foldN[pf.sessionId] || 0) + 1;
			foldLastSeq[pf.sessionId] = pf.seq;
		}
		for (var i = 0; i < events.length; i++) {
			var f = events[i];
			/* 桌宠仲裁（第一批）：pet/state 在 seq 闸门之前处理——它是绝对态
			 * （幂等，重放无害），SSE 在线的页面不跑轮询，任何 seq 陈旧/缺失
			 * 都不能错过休眠/唤醒（2026-10-31 真机洞）。
			 * PET_MODE 短路（11-06 SSE 枚举流）：桌宠页现在也订 /events/stream，
			 * pet/state 帧会到达桌宠页——桌宠页自己就是桌宠，绝不能把
			 * #dsh-whale（桌宠鲸本体）休眠掉；休眠机器只属于 DSH 页内鲸。 */
			if (f && f.type === 'pet/state') {
				if (!PET_MODE && typeof f.enabled === 'boolean') {
					/* force（11-05）：权威状态即使值未变也要走 DOM 应用——
					 * 开机先藏的页鲸靠它唤醒（幂等闸门不许拦权威状态） */
					try { applyPetDormant(petDormantOf(f.enabled, f.form, f.up, f.spawning), true); } catch (e) {}
				}
				/* 形态即时应用（11-14 用户实报）：桌宠页收到 pet/state 帧即缝给
				 * page.html 的 applyForm（幂等：同形态零动作）——此前桌宠页的 form
				 * 变化只有 2s fetchState 兜底轮询一条路。休眠仲裁仍 PET_MODE 短路。 */
				if (PET_MODE && typeof f.form === 'string') {
					try {
						var petHost = typeof window !== 'undefined' && window.__dshPetHost;
						if (petHost && typeof petHost.applyForm === 'function') petHost.applyForm(f.form);
					} catch (ePe) {}
				}
				continue;
			}
			/* 桌宠通知双击跳转（11-03）：宿主把合成码反查回真实 sessionId 后
			 * 广播 pet/jump——页鲸是唯一持有跳转桥的一方（桌宠页没有桥也没有
			 * DSH DOM）。core 不直接引用 ui 的跳转函数（方向闸门）：派发自定义
			 * 事件，session-jump.js 自行监听执行。跳转是即时动作：只认 10s 内
			 * 的新帧，重放缓冲里的旧 jump 一律忽略（刷新页面/新窗口不得凭空
			 * 跳回旧会话）。atMs（11-06）：时间锚点透传——页鲸
			 * openSessionAt(sid, atMs) 翻页回溯到该任务的消息。 */
			if (f && f.type === 'pet/jump') {
				var jTime = f.time || 0;
				if (Date.now() - jTime < 10000 && f.sessionId &&
					typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' &&
					petFrameOnce('jump', jTime)) {
					try { window.dispatchEvent(new CustomEvent('dsh-whale:pet-jump', { detail: { sessionId: f.sessionId, atMs: typeof f.atMs === 'number' ? f.atMs : undefined } })); } catch (e) {}
					ackPendingClear('jump');
				}
				continue;
			}
			/* 通知已读联动（11-14）：页鲸看到用户在 DSH 里打开某会话时 POST
			 * dismiss，宿主反查任务码后广播 pet/dismiss——桌宠页把对应任务的
			 * 未读清掉（红标 -1、队列剔除）。core 不引用 ui 的队列函数（方向
			 * 闸门）：派发自定义事件，bootstrap.js 自行监听执行。 */
			if (f && f.type === 'pet/dismiss') {
				if (PET_MODE && Number.isInteger(f.code) && f.code > 0 &&
					typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
					try { window.dispatchEvent(new CustomEvent('dsh-whale:pet-dismiss', { detail: { code: f.code } })); } catch (e) {}
				}
				continue;
			}
			/* 刷新 DSH 页面（11-07，桌宠菜单语义拆分）：桌宠菜单「🔄 刷新 DSH
			 * 页面」→宿主广播 pet/reload-page→**本页（页鲸）执行真正的
			 * location.reload()**——桌宠页自己没有 DSH DOM，只能借道。10s 内
			 * 的新帧才执行（重放缓冲里的旧指令一律忽略，与 pet/jump 同闸）；
			 * PET_MODE 短路（桌宠页绝不因这条帧自我刷新，否则回环）。 */
			if (f && f.type === 'pet/reload-page') {
				var rpTime = f.time || 0;
				if (!PET_MODE && Date.now() - rpTime < 10000 && petFrameOnce('reload', rpTime) &&
					typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
					try { setTimeout(function () { window.location.reload(); }, 80); } catch (e) {}
				}
				continue;
			}
			/* 桌宠菜单「设置」跳转（11-11 三报，用户实报「点设置只弹提示没有
			 * 意义」）：宿主广播 pet/open-settings → 本页调
			 * layout.selectPanel('whale-assistant') 打开侧边栏设置页。桥住在
			 * client.js（window.__dshWhaleSelectPanel）——core 不直接引用
			 * ui/client（方向闸门，与 pet/jump 的派发模式同款）：派发
			 * 自定义事件由 client.js 监听执行。10s 内新帧才执行（重放闸同
			 * pet/jump）；PET_MODE 短路（桌宠页无 DSH 面板可开）。 */
			if (f && f.type === 'pet/open-settings') {
				var osTime = f.time || 0;
				if (!PET_MODE && Date.now() - osTime < 10000 && petFrameOnce('settings', osTime) &&
					typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
					try { window.dispatchEvent(new CustomEvent('dsh-whale:pet-open-settings')); } catch (e) {}
					ackPendingClear('settings');
				}
				continue;
			}
			if (!f || typeof f.seq !== 'number' || f.seq <= lastSeq) continue;
			rememberSeq(f.seq);
			/* a fresh page must not replay the buffer's history — same
			 * event.time fallback as the fold pre-scan (host frames have no
			 * top-level time; bare f.time made this guard dead code) */
			var fTime = f.time || (f.event && f.event.time);
			if (fTime && Date.now() - fTime > 60000 && bootAt - fTime > 60000) continue;
			/* 重放批标记（11-03）：boot 前的帧只记账不重播——see replayBatch */
			if (replayBatch && fTime && fTime < bootAt) {
				try { f.replaySuppress = true; } catch (e) {}
			}
			if (f.type === 'session/projection') {
				if (f.key === 'title') {
					/* 11-14（用户 rc.3 实机「[任务 36] 需要你选择」而侧栏有真名）：
					 * 「当前会话跳过」在页面语境=标题由 DOM 读取器喂，但桌宠页
					 * 没有 DOM 读取器——投影帧是唯一真名来源；而 session-key 的
					 * 缓存扫描兜底会把刚被 feedEventFrame 命名的合成会话
					 * （session-pet-sN='任务 N'）解析成「当前会话」→ 投影永远
					 * 被跳过=真名饿死。PET_MODE 下绝不跳过。 */
					if (f.sessionId !== resolveCurrentSessionId() || PET_MODE) {
						var v = f.value;
						var title = typeof v === 'string' ? v : (v && typeof v.title === 'string' ? v.title : null);
						if (title) {
							try { sessionTitles.set(f.sessionId, title); rememberTitle(f.sessionId, title); } catch (e) {}
							try {
								var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
								var info = subs && subs.get(f.sessionId);
								/* 占位快照跟随真名（11-14）：注册期快照可能是「任务 N」
								 * （桌宠首轮命名早于注册）——已有值但为占位时也要刷新 */
								if (info && (!info.title || /^任务 \d+$/.test(info.title))) info.title = title;
							} catch (e) {}
							/* 晚到真名改写（11-06 二轮，SSE 稳态补齐）：title 帧
							 * 晚于通知入队时（宿主 announceTitle 异步+快速任务
							 * 同拍完成），已在屏/在队的「任务 N」要改写成真名——
							 * poll 分支的 titles 预填早有同款调用，SSE 路径补上。
							 * _correctReports 幂等（已是真名则 no-op）。 */
							try {
								if (typeof window.__dshWhale._correctReports === 'function') {
									window.__dshWhale._correctReports(f.sessionId, title);
								}
							} catch (e2) {}
						}
					}
					continue;
				}
				/* usage + pressure projections: the host sees EVERY session, so
				 * feeding them here keeps 全对话累计/上下文压力 real for
				 * sessions this window never opened (after a reload the DOM
				 * reader only sees the one visible conversation).
				 * tokenUsage stays active-session-skipped: the DOM 累计条 feed
				 * covers it and must not race the server values.
				 * contextPressure is NOT skipped (09-13 压力复活): DSH 0.1.5
				 * removed the「上下文已用 N%」DOM text, so the DOM feed has
				 * nothing to contribute — the server projection (token-meter,
				 * dsh-base roster) is the ONLY source for the active session,
				 * and the report pressure line / border color / 70% warning
				 * all read it. Both shapes (legacy DOM
				 * {contextWindow:100,pressureTokens:percent} and server
				 * real-token counts) yield a correct percentage through the
				 * same pressurePercentOf formula. */
				if ((f.key === 'tokenUsage' && f.sessionId !== resolveCurrentSessionId()) || f.key === 'contextPressure') {
					try {
						handleMuxPayload({ type: 'session/projection', sessionId: f.sessionId, key: f.key, value: f.value });
					} catch (e) {}
				}
				continue;
			}
			if (f.type === 'session/event') {
				/* tag the fold markers onto the frame's event for the
				 * forwarder to carry (only for sessions above FOLD_MIN) */
				if (f.event && f.event.type === 'turn/end' && (foldN[f.sessionId] || 0) >= FOLD_MIN) {
					var fr2 = f.event.data && f.event.data.reason && f.event.data.reason.kind;
					if (fr2 === 'completed') {
						if (f.seq !== foldLastSeq[f.sessionId]) f.event.foldSuppress = true;
						else f.event.foldCount = foldN[f.sessionId];
					}
				}
				/* never break the channel loop (mux.js discipline): a frame
				 * that throws would otherwise (a) kill the SSE onmessage
				 * handler for good, (b) make the poll path read a handler
				 * bug as a dead server in the health check. Drop the poisoned
				 * frame loudly and keep flowing. */
				try {
					feedEventFrame(f);
				} catch (e) {
					try { console.error('[dsh-whale] event handler failed for seq ' + f.seq, e); } catch (e2) {}
				}
			}
			/* session/jobs frames are intentionally ignored (empty payloads) */
		}
	}

	function poll() {
		if (sseUp) return; /* the stream is live: it delivers frames + pings */
		/* 桌宠：枚举 feed（token 由 WebView2 头注入层补）代替全量 events；
		 * 页面轮询同一响应里还带着 pet.enabled 仲裁 flag */
		fetch(PET_MODE ? '/api/whale-assistant/pet/feed' : '/api/whale-assistant/events').then(function (r) {
			return r.ok ? r.json() : null;
		}).then(function (data) {
			if (data && Array.isArray(data.events)) {
				markServerPoll(true);
				/* 桌宠：存量标题预填（11-03）——session/title 事件只在标题变化
				 * 时广播，老会话对桌宠静默；宿主把历史里的 真实会话→标题 用码本
				 * 转成合成 id 随 feed 下发，这里预填通讯录（只补空缺，不覆盖
				 * 实时 title 帧）。这是页鲸「开机主动取名」的桌宠等价物。 */
				if (PET_MODE && data.titles && typeof data.titles === 'object') {
					/* 11-03 诊断缝（收口后移除） */
					try {
						var pp = window.__dshWhale._prefillProbe = window.__dshWhale._prefillProbe || [];
						pp.push('poll@' + Date.now() + ' keys=' + Object.keys(data.titles).join(','));
						if (pp.length > 12) pp.shift();
					} catch (e) {}
					for (var tsid in data.titles) {
						var tv = data.titles[tsid];
						if (typeof tv !== 'string' || !tv) continue;
						/* real names REPLACE the 任务 N placeholder (the
						 * placeholder must never block the real one) — a live
						 * title frame still wins by arriving later. get-then-set
						 * kept on one line (timing-contract lint). */
						if (!sessionTitles.get(tsid) || /^任务 \d+$/.test(sessionTitles.get(tsid))) {
							sessionTitles.set(tsid, tv); try { rememberTitle(tsid, tv); } catch (e) {}
							/* reportTurn reads info.label || info.title ||
							 * bookTitle — a placeholder already固化 in
							 * subagentSessions would压住 the real name, so
							 * swap it here too (placeholder-only) */
							try {
								var w = window.__dshWhale || {};
								var sinfo = w.subagentSessions && w.subagentSessions.get(tsid);
								if (sinfo && (!sinfo.title || /^任务 \d+$/.test(sinfo.title))) sinfo.title = tv;
								/* 秒回任务的完成通知先于本预填生成（文案已带
								 * 「任务 N」占位入队）——晚到真名改写队列与在屏
								 * 气泡，与页鲸 correctReports 同一条契约 */
								if (typeof w._correctReports === 'function') w._correctReports(tsid, tv);
							} catch (e) {}
						}
					}
				}
				/* PET_MODE 短路（11-06 SSE 枚举流）：休眠仲裁只属于 DSH 页内鲸
				 * ——桌宠页即使拿到 pet 字段也绝不应用（桌宠页的 #dsh-whale
				 * 是桌宠本体，不是页鲸） */
				if (!PET_MODE && data.pet && typeof data.pet.enabled === 'boolean') {
					try { applyPetDormant(petDormantOf(data.pet.enabled, data.pet.form, data.pet.up, data.pet.spawning), true); } catch (e) {}
				}
				consume(data.events, data.bootId);
			} else {
				/* a non-OK route (plugin gone / auth changed) is exactly the
				 * silent failure the health check exists to surface */
				markServerPoll(false, data ? 'bad-payload' : 'http-not-ok');
			}
		}).catch(function (e) {
			markServerPoll(false, String(e && e.message || e));
		});
	}

	/* 0.4.0 SSE client: frames + hello + pings pushed the instant they exist.
	 * EventSource reconnects on its own (server sent retry: 3000); while the
	 * stream is up the 3s poll skips itself — network callbacks are NOT
	 * throttled in hidden tabs, which is the whole point. Pings count toward
	 * server liveness so an IDLE server no longer reads as dead (R3). */
	var sse = null;
	var sseUp = false;
	var sseBootId = null;
	function handleSseData(raw) {
		var f = null;
		try { f = JSON.parse(raw); } catch (e) { return; }
		if (!f || typeof f !== 'object') return;
		if (f.type === 'ping') { markServerPoll(true); return; }
			if (f.type === 'hello') {
				if (f.bootId && f.bootId !== knownBootId) { sseBootId = f.bootId; consume([], f.bootId); }
				else if (f.bootId) { sseBootId = f.bootId; }
				/* 桌宠仲裁：连接即知开关态（SSE 在线的页面不跑轮询，hello 是它
				 * 唯一的 connect-time 状态源）；隐藏形态不休眠（召回入口）。
				 * PET_MODE 短路（11-06 SSE 枚举流）：桌宠页同理由本页扮演桌宠，
				 * 不应用休眠。 */
				if (!PET_MODE && f.pet && typeof f.pet.enabled === 'boolean') {
					try { applyPetDormant(petDormantOf(f.pet.enabled, f.pet.form, f.pet.up, f.pet.spawning), true); } catch (e) {}
				}
				return;
			}
		consume([f], sseBootId || undefined);
	}
	var sseFails = 0;
	function connectSSE() {
		/* 11-06 枚举 SSE 流（用户实报「任务通知有延时」）：宿主现在按 pet
		 * token 把 SSE 连接分流——桌宠连接收到的是逐帧枚举载荷（与 /pet/feed
		 * 同一码本同一边界），页鲸连接照旧收全量帧。桌宠通知从 3s 轮询节奏
		 * 变成即时推送；轮询保留作断线兜底（EventSource 断开→sseUp=false→
		 * poll 恢复跑 /pet/feed 补漏帧，lastSeq 闸门去重）。 */
		if (typeof EventSource !== 'function') return; /* vm sandbox / ancient browsers */
		try { sse = new EventSource('/api/whale-assistant/events/stream'); } catch (e) { return; }
		sse.onopen = function () { sseUp = true; sseFails = 0; };
		sse.onerror = function () {
			sseUp = false; /* EventSource auto-reconnects */
			/* v15（11-13）：离线熔断——壳退出时宿主服务器排空连接，EventSource
			 * 的 3s 自动重连会不断造出新的活跃连接，把排空拖成死锁（壳停在退
			 * 出挂起态=单实例锁握着=用户重开 DSH 无响应，挂起复现实测 40s+，
			 * 桌宠连接归零后依然挂=重连风暴才是主阻塞）。连续 3 次失败（约
			 * 9s）即关闭事件源停止重连，让壳干净退场；恢复钩子=可见/聚焦/上线
			 * 三事件重新 connectSSE（关窗唤醒后页鲸照常回线，hello 补投兑现）。 */
			if (++sseFails >= 3 && sse) {
				try { sse.close(); } catch (e2) { }
				sse = null;
			}
		};
		sse.onmessage = function (ev) { handleSseData(ev.data); };
	}
	/* v15：熔断后的恢复钩子——窗口重新可见/获得焦点/系统网络恢复时重连。
	 * 退出挂起期的隐藏页不会触发这些事件=保持断开=排空不被打扰。 */
	if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
		document.addEventListener('visibilitychange', function () {
			try { if (!document.hidden && !sse) { sseFails = 0; connectSSE(); } } catch (e) { }
		});
	}
	if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
		window.addEventListener('focus', function () {
			try { if (!sse) { sseFails = 0; connectSSE(); } } catch (e) { }
		});
		window.addEventListener('online', function () {
			try { if (!sse) { sseFails = 0; connectSSE(); } } catch (e) { }
		});
	}
	/* test seam: this whole module is a closure, so exports.js can't see it —
	 * mirror the _pollConsume pattern and hang the handler on the window seam */
	if (typeof window !== 'undefined' && window.__dshWhale) window.__dshWhale._sseFrame = handleSseData;

	/* start as soon as the boot render settles (1.5s); the first polls still
	 * skip frames that predate the page via the bootAt guards above */
	setTimeout(function () {
		setInterval(poll, POLL_MS);
		poll();
		connectSSE();
	}, 1500);

	/* test seam: drive the polled-frame gate directly (active-session skip +
	 * cross-channel completion dedup) without waiting for the 3s poll */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._feedEventFrame = feedEventFrame;
		/* drive the FULL poll consume loop (projection gate + batch folds),
		 * not just the event branch — the projection active-session gate
		 * lives in consume() and must be testable end to end */
		window.__dshWhale._pollConsume = consume;
		/* 每窗口归属（P1 2026-10-28）seams: pin/adopt/resolve 供测试直接驱动 */
		window.__dshWhale._pinSession = pinWindowSession;
		window.__dshWhale._adoptSessionPin = adoptCurrentSessionPin;
		window.__dshWhale._resolveSessionId = resolveCurrentSessionId;
		/* 仲裁纯函数缝（11-05）：spawning 语义单测入口——petDormantOf 定义在
		 * initServerEvents 闭包内，exports.js 够不着（test-whale 实证） */
		window.__dshWhale._petDormantOf = petDormantOf;
	} catch (e) {}
	})();
/* ---- module: src/core/health.js ---- */
/**
 * Dependency self-check (inline module): the whale fails QUIETLY by design
 * (a stale DOM selector or a missing event route just means no
 * notifications), and twice already that silence hid real breakage for
 * days (the f.time ReferenceError, the rc.1 usage-DOM migration). This
 * module makes degradation VISIBLE without touching the healthy path:
 *
 *   server — the /events poll's HTTP outcome (markServerPoll, fed by
 *            server-events). Idle ≠ fail: a quiet stream with successful
 *            requests is healthy; 3 consecutive failed/non-OK requests OR
 *            a visible page whose last OK is >90s old is a fail.
 *   dom    — per-turn usage sampling (recordUsageHealth, fed by the
 *            adapter at every REAL turn finish). 3 consecutive finishes
 *            with no 用量 chip text read = the selector lost the race.
 *            Sampled only at turn ends — an idle page has no chips, so a
 *            load-time probe would false-positive by design.
 *   jump   — the session-jump hook exists. WARN-ONLY: the sidebar
 *            fallback covers for it, so it never trips the headline.
 *
 * Zero footprint while healthy (no chip, no log). Degraded: one ⚠️ chip
 * near the whale (click = detail panel), a console line on every state
 * TRANSITION, and a _debug forensic write. Never throws, never announces.
 * Cadence: first check 10s after load, then every 60s (timers throttle
 * naturally in hidden tabs — irrelevant, since a hidden page can't show
 * the chip anyway and the poll marks resume on visibility).
 */

	var healthState = { degraded: false, lastReport: null, everDegraded: false };
	var healthOverrides = null; /* test seam: { server, dom, jump } forced report */

	/** Record one poll outcome (called from server-events' poll loop). */
	function markServerPoll(ok, why) {
		try {
			window.__dshWhale = window.__dshWhale || {};
			var sh = window.__dshWhale.__serverHealth = window.__dshWhale.__serverHealth || { lastOkAt: 0, failStreak: 0, lastError: '' };
			if (ok) {
				sh.lastOkAt = Date.now();
				sh.failStreak = 0;
				sh.lastError = '';
			} else {
				sh.failStreak++;
				sh.lastError = why || 'unknown';
			}
		} catch (e) {}
	}

	/** Record one real turn-finish usage read (called from the adapter's
	 * chip path). readOk=false means a turn ended and NOTHING was read. */
	function recordUsageHealth(readOk) {
		try {
			window.__dshWhale = window.__dshWhale || {};
			var uh = window.__dshWhale.__usageHealth = window.__dshWhale.__usageHealth || { attempts: 0, misses: 0, missStreak: 0 };
			uh.attempts++;
			if (readOk) uh.missStreak = 0;
			else { uh.misses++; uh.missStreak++; }
		} catch (e) {}
	}

	/** Compose one report; never throws. jump='warn' is informational and
	 * does NOT count toward the degraded headline. */
	function runHealthCheck() {
		var rep;
		if (healthOverrides) {
			rep = { server: healthOverrides.server || 'ok', dom: healthOverrides.dom || 'ok', jump: healthOverrides.jump || 'ok' };
		} else {
			var sh = (typeof window !== 'undefined' && window.__dshWhale && window.__dshWhale.__serverHealth) || null;
			var uh = (typeof window !== 'undefined' && window.__dshWhale && window.__dshWhale.__usageHealth) || null;
			var visibleStale = !!(sh && sh.lastOkAt && typeof document !== 'undefined' &&
				document.visibilityState === 'visible' && Date.now() - sh.lastOkAt > 90000);
			rep = {
				server: (sh && (sh.failStreak >= 3 || visibleStale)) ? 'fail' : 'ok',
				dom: (uh && uh.missStreak >= 3) ? 'fail' : 'ok',
				/* jump probe: the page whale reports its bridge binding (jumpReady);
				 * the PET whale has NO bridge — its jump runs through the HOST
				 * channel (POST /pet/ctrl → reverse-lookup → pet/jump broadcast →
				 * the page whale's own bridge executes), which rides the SAME
				 * /pet/* routes and token as the notification feed. There the
				 * server health IS the jump-channel health — reporting jumpReady
				 * on the pet page would warn forever on a working feature
				 * (11-03 实机：桌宠健康面板把修好的跳转报成 ⚠️ 不可用）. */
				jump: PET_MODE
					? ((sh && sh.failStreak < 3 && !visibleStale) ? 'ok' : 'warn')
					: (jumpReady() ? 'ok' : 'warn')
			};
		}
		var degraded = rep.server === 'fail' || rep.dom === 'fail';
		var firstDegrade = degraded && !healthState.degraded;
		if (degraded !== healthState.degraded || rep.server !== (healthState.lastReport && healthState.lastReport.server) || rep.dom !== (healthState.lastReport && healthState.lastReport.dom)) {
			/* log transitions only — a healthy whale is silent. Diagnostic
			 * mode appends the bounded-state census (memory audit visibility) */
			var line = '[🐋] Health check: ' + JSON.stringify(rep);
			try {
				if (debugOn()) {
					/* diagnostic mode: append the bounded-state census */
					var W = window.__dshWhale || {};
					line += ' | sizes: ' + JSON.stringify({
						attSeen: Object.keys(W.attSeen || {}).length,
						endFire: Object.keys(DEDUP.endFire).length,
						known: known.size,
						subagentSessions: W.subagentSessions ? W.subagentSessions.size : -1,
						sessionTitles: sessionTitles.size
					});
				}
			} catch (e) {}
			if (typeof console !== 'undefined' && console[degraded ? 'warn' : 'log']) {
				console[degraded ? 'warn' : 'log'](line);
			}
		}
		healthState.lastReport = rep;
		healthState.degraded = degraded;
		if (degraded) healthState.everDegraded = true;
		try { updateHealthChip(degraded); } catch (e) {}
		if (firstDegrade) {
			try { debugInject({ kind: 'health', at: Date.now(), report: rep }); } catch (e) {}
		}
		return rep;
	}

	var healthChip = null;
	function updateHealthChip(degraded) {
		if (degraded) {
			if (!healthChip) healthChip = ensureHealthChip();
			if (healthChip) healthChip.style.display = 'block';
		} else if (healthChip) {
			healthChip.style.display = 'none';
		}
	}

	function ensureHealthChip() {
		var w = (typeof window !== 'undefined' && window.__dshWhale && window.__dshWhale.whale) || null;
		if (!w || typeof document === 'undefined' || !document.createElement) return null;
		var chip = document.createElement('div');
		chip.className = 'dsh-whale-health-chip';
		chip.textContent = '⚠️';
		/* no native tooltip (user rule): the click panel IS the explanation */
		chip.addEventListener('click', function (event) {
			event.stopPropagation();
			openHealthPanel();
		});
		w.appendChild(chip);
		return chip;
	}

	/** Degraded-state detail panel: built by menu.js (the floating-panel
	 * slots live inside uiInit's closure, not this scope) — delegate; the
	 * menu side reads healthState.lastReport. */
	function openHealthPanel() {
		if (typeof window !== 'undefined' && typeof window.__dshWhale.openHealthPanel === 'function') {
			window.__dshWhale.openHealthPanel();
		}
	}

	/* start 10s after load (uiInit has run by then; the first poll has had
	 * time to succeed or fail), then once a minute */
	if (typeof setTimeout === 'function') {
		setTimeout(function () {
			try { runHealthCheck(); } catch (e) {}
			if (typeof setInterval === 'function') {
				setInterval(function () {
					try { runHealthCheck(); } catch (e) {}
				}, 60000);
			}
		}, 10000);
	}
/* ---- module: src/core/state.js ---- */
	var whale = null;
	var MUX_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/events.mux';

	/* ------------------------------------------------------------------ */
	/* Shared state between the mux channel and the UI                     */
	/* ------------------------------------------------------------------ */
	/** job id -> { status, label, kind, sessionId } */
	var known = new Map();
	/**
	 * Sessions whose next session/jobs frame is a silent baseline.
	 * Keyed by sessionId -> timestamp; a marker EXPIRES after BASELINE_TTL_MS,
	 * so a stale marker (subscribed with no jobs to baseline, e.g. an idle
	 * conversation) can never swallow the workload of a LATER brand-new job.
	 */
	var baselineSessions = new Map();
	var BASELINE_TTL_MS = 3000;
	var baselineTtlOverride = null; /* test seam */
	var pendingSay = [];
	var uiReady = false;
	/** sessionId of the report currently shown in the bubble (for late-title rewrites). */
	var currentSaySession = null;

	/* 桌宠仲裁（第一批）：pet.enabled 时页面鲸鱼休眠——隐藏 + 静默
	 * （台词 uiSay / 音效 playDing 入口拦下），但数据管线照跑（DOM 采集、
	 * 历史与台账继续记录），桌宠关闭后页面鲸鱼无缝回来。宿主 /events 轮询
	 * 响应带 pet.enabled，server-events 消费后调 applyPetDormant；
	 * localStorage 缓存让 client.js 在下一次 boot 时先于任何请求隐藏元素
	 * （防双鲸闪现）。状态放 core：core 的静默门（dings/server-events）与
	 * ui 的静默门（uiSay）都读它，core→ui 方向边不加。
	 * **内存态必须从同一份缓存初始化**（2026-10-31 真机洞）：client.js 开机
	 * 已按缓存 display:none，而内存态若从 false 起步，hello 送来
	 * pet.enabled=false 会撞上幂等闸门早退（false===false）——元素永久隐藏。
	 * 从缓存起步后，缓存"休眠"+内存"休眠"一致，第一次 hello=false 即正常
	 * 走唤醒分支清 display + 改写缓存。 */
	var petDormant = false;
	try { petDormant = localStorage.getItem('dsh-whale:petDormant') === '1'; } catch (e) {}
	/** 11-05 开机防双鲸第二层：是否消费过**权威**桌宠状态（hello/轮询/帧）。
	 * 非桌宠页开机一律先藏（不信任缓存 0——每次关 DSH 都会把它写成 0），
	 * 由权威状态强制应用或 6s 兜底 reveal 唤醒；bootReveal 只在
	 * 「从未见过权威状态且内存态非休眠」时出手（缓存 1 的开机不许被它吵醒）。 */
	var petStateSeen = false;
	function applyPetDormant(v, force) {
		v = !!v;
		petStateSeen = true;
		var changed = v !== petDormant;
		if (!changed && !force) return;
		/* force（11-05）：权威状态每 3s 轮询都会再来一次——值未变时 DOM
		 * 应用必须零抖动，尤其唤醒分支的 resize 会重座菜单锚点。只在
		 * 「真从隐藏翻出来」时派发 resize。 */
		var wasHidden = false;
		try {
			var el0 = whale || document.getElementById('dsh-whale');
			wasHidden = !!(el0 && el0.style.display === 'none');
		} catch (e0) {}
		petDormant = v;
		try { localStorage.setItem('dsh-whale:petDormant', v ? '1' : '0'); } catch (e) {}
		try {
			/* target: uiInit 的 whale 优先（client.js 的 holder 与它同一节点） */
			var el = whale || document.getElementById('dsh-whale');
			if (!el) return;
			if (v) {
				/* 让位（11-01 终版）：ready 握手时桌宠鲸鱼已出现在页鲸正上方
				 * （完全重叠）——瞬间隐藏即不可见，任何下潜/位移动画反而会
				 * 从桌宠鲸鱼底下"剥离"出第二只。桌宠随后从交接位自然游走。 */
				el.style.display = 'none';
			} else {
				/* 唤醒（真机洞 10-31#1）：loadPos 曾在 display:none 下执行，
				 * offsetWidth=0 让 seatFromAnchor 算出垃圾位——醒来后盒子尺寸
				 * 才真实。清除残留变换 + 重派 resize（menu.js 的锚点重座逻辑
				 * 原样复用，零新增 core→ui 依赖边），鲸鱼回到贴角正确位。
				 * 唤醒场景（第九轮常驻版）=桌宠进程死亡/平台不支持/开机先藏
				 * 后被权威状态唤醒的页内兜底。 */
				el.style.transition = 'none';
				el.style.transform = '';
				el.style.display = '';
				if (wasHidden) {
					try { window.dispatchEvent(new Event('resize')); } catch (e2) {}
				}
			}
		} catch (e) {}
	}
	function petStateEverSeen() { return petStateSeen; }
/* ---- module: src/core/reports.js ---- */

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
		/* NOTE: do NOT patchEndSnapshots here — usage for a LATER turn would
		 * rewrite the previous turn's empty history row. Only backfillEndPanel
		 * (armed for the just-ended completion) refreshes the read-back copies. */
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

	/** Patch the unread/read-back snapshots for one session with the latest
	 * ledger numbers. Without this, late usage only upgrades the LIVE panel
	 * (backfillEndPanel) and a red-badge re-read still shows the empty
	 * "此次任务" line missing (用户截图：弹出三行、点读回两行). */
	function patchEndSnapshots(sessionId) {
		if (!sessionId) return;
		var turn = sessionTurnTokens(sessionId);
		var total = sessionTotalTokens(sessionId);
		var pressure = sessionPressure.get(sessionId);
		function patchItem(item) {
			if (!item || item.sessionId !== sessionId) return;
			if (item.turnTokens === null) return; /* snapshot=false: intentionally empty */
			if (typeof turn === 'number' && turn > 0) item.turnTokens = turn;
			if (typeof total === 'number' && total > 0) item.sessionTokens = total;
			if (pressure) item.pressure = pressure;
		}
		for (var i = reportQueue.length - 1; i >= 0; i--) {
			if (reportQueue[i].sessionId === sessionId) { patchItem(reportQueue[i]); break; }
		}
		patchItem(reading);
		patchItem(lastShownReport);
		if (typeof turn === 'number' && turn > 0 && typeof correctHistoryTurnTokens === 'function') {
			correctHistoryTurnTokens(sessionId, turn);
		}
	}

	function backfillEndPanel(sessionId) {
		if (!endPanelBackfill || endPanelBackfill.sessionId !== sessionId) return;
		var now = Date.now();
		if (now >= endPanelBackfill.deadline) { endPanelBackfill = null; return; }
		var rep = statusReport(sessionTurnTokens(sessionId), sessionTotalTokens(sessionId), sessionPressure.get(sessionId));
		if (!rep || rep.lines.length <= endPanelBackfill.lines) {
			/* lines may be unchanged while turnTokens just became non-zero
			 * after a 0-snapshot — still refresh the read-back copies */
			patchEndSnapshots(sessionId);
			return;
		}
		endPanelBackfill.lines = rep.lines.length;
		showStatusPanel(rep, Math.max(1500, endPanelBackfill.deadline - now));
		patchEndSnapshots(sessionId);
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
	 * cumulative burn, and the context pressure. P1 2026-10-27 (K3): carries
	 * structured `rows` (label/value) — the panel renders them as a two-column
	 * grid (applyStatusText), so numbers never wrap mid-figure; `lines` stays
	 * for the line-count bookkeeping (backfillEndPanel compares lengths). */
	function statusReport(turnTokens, sessionTokens, pressure) {
		var lines = [];
		var rows = [];
		if (typeof turnTokens === 'number' && turnTokens > 0) {
			var tv = fmtTokens(turnTokens) + ' tokens';
			lines.push('此次任务消耗 ' + tv);
			rows.push({ label: '此次任务消耗', value: tv });
		}
		if (typeof sessionTokens === 'number' && sessionTokens > 0) {
			var sv = fmtTokens(sessionTokens) + ' tokens';
			lines.push('全对话累计消耗 ' + sv);
			rows.push({ label: '全对话累计消耗', value: sv });
		}
		if (pressure) {
			var pct = pressurePercentOf(pressure); /* null = no honest reading: skip the line */
			if (pct !== null) {
				lines.push('上下文已用 ' + pct + '%');
				rows.push({ label: '上下文已用', value: pct + '%' });
			}
		}
		return lines.length > 0 ? { prefix: '📊 ', lines: lines, rows: rows } : null;
	}

	/** The report currently displayed in the bubble (the latest push, or the
	 * one being replayed from a click). Double-clicking the bubble to jump
	 * marks THIS report read — it leaves the unread queue and the badge
	 * drops by one. */
	var lastShownReport = null;

	/** 通知已读联动·到达侧（11-14 用户实报「我停留在对话页面，通知弹出来
	 * 刚好也看见了——1 弹出来自然就消成 0，这才叫联动」）：报告所属会话=
	 * 本窗口 pin 时的「正在看」判定。**只认 pin 不认全局链回退**——回退链
	 * 会陈旧（别的窗口切走的会话/跳回旧对话的缓存），拿它判定「看见了」
	 * 会错杀真没看过的通知；pin=本窗口自己的 DOM 活动快照，宁漏勿错。 */
	function isViewedSession(sid) {
		if (!sid || typeof sessionStorage === 'undefined') return false;
		try { return sessionStorage.getItem(WINDOW_PIN_KEY) === sid; } catch (e) { return false; }
	}

	/** Record one job report for the unread badge (bubble is shown by the caller).
	 * `snapshot === false` stores NO token/pressure data (used for the
	 * turn/start report — a task that just started has nothing to report).
	 * `endTime` (ms epoch of the moment this report is about) powers the
	 * double-click jump: the bubble jump pages the log back to THAT moment. */
	function pushReport(text, duration, sessionId, snapshot, endTime) {
		/* 通知已读联动（11-14）：报告到达时用户正看着这个会话（本窗口 pin
		 * 命中）=当场已读——未读不入队（气泡照常弹、历史照记、红标不涨），
		 * 并 relay 桌宠端同步清（桌宠的同款通知刚到、红标闪 1 即被
		 * pet/dismiss 帧消成 0=用户描述的「弹出来消成 0」）。 */
		var viewedNow = isViewedSession(sessionId);
		var report = {
			text: text,
			duration: duration,
			sessionId: sessionId,
			at: Date.now(),
			turnTokens: snapshot === false ? null : sessionTurnTokens(sessionId),
			sessionTokens: snapshot === false ? null : sessionTotalTokens(sessionId),
			pressure: snapshot === false ? null : sessionPressure.get(sessionId),
			endTime: typeof endTime === 'number' ? endTime : null
		};
		if (!viewedNow) {
			reportQueue.push(report);
			/* generous bound: the badge must keep accumulating long past 20 */
			if (reportQueue.length > REPORT_QUEUE_CAP) reportQueue.shift();
		}
		/* lastShownReport 语义不变（始终=最新报告）：双击跳转的 endTime
		 * 锚定依赖它，未入队的「已读」报告同样可作跳转锚 */
		lastShownReport = report;
		currentSaySession = sessionId || null;
		renderUnread();
		if (viewedNow && sessionId && !PET_MODE && typeof fetch === 'function') {
			try {
				fetch('/api/whale-assistant/pet/ctrl', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'dismiss', sessionId: sessionId })
				}).catch(function () {});
			} catch (eViewed) { /* 桌宠不在线/桩环境：静默 */ }
		}
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
/* ---- module: src/core/dings.js ---- */
	/* ------------------------------------------------------------------ */
	var audioCtx = null;

	function ensureAudio() {
		if (audioCtx === null) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) {
				audioCtx = false;
				return false;
			}
			try {
				audioCtx = new AC();
			} catch (error) {
				audioCtx = false;
				return false;
			}
		}
		if (audioCtx === false) return false;
		if (audioCtx.state === 'suspended') {
			/*
			 * Autoplay policy: the first playback may hit a suspended context.
			 * resume() is ASYNC — returning false here would silently drop the
			 * ring, so schedule a re-pump once the context actually runs.
			 */
			var p;
			try {
				p = audioCtx.resume();
			} catch (error) {
				return false;
			}
			if (p && typeof p.then === 'function') {
				p.then(function () {
					/* 积压收敛（11-03 用户实报「提示音出现两次」）：autoplay
					 * 挂起期间排队的 ding 在解锁后**连响**——resume 成功后只
					 * 播最新一条（burst 保护同一语义：积压的历史已无时效） */
					if (dingKinds.length > 0) {
						if (dingKinds.length > 1) dingKinds.splice(0, dingKinds.length - 1);
						pumpDings();
					}
					pumpPreview(); /* 试听早于解锁排队：resume 后立即补响 */
				}).catch(function () {
					/* resume 被拒（autoplay 策略、窗口尚无用户激活）——不能就此
					 * 把排队的 ding 静默丢掉（11-11 三轮「第一条通知无声」根因）：
					 * 挂手势重试，首次交互后补响。 */
					armAudioUnlockRetry();
				});
			}
			return false;
		}
		return audioCtx.state === 'running' ? audioCtx : false;
	}

	/**
	 * One synthesized notification. 'done' = bicycle-bell "ding-ding": two
	 * metallic strikes (2400Hz fundamental + 2×/2.76× inharmonic partials)
	 * with a long resonant decay. 'fail' = dull descending minor third
	 * (550 → 415). Back-to-back dings stay clear because the queue gap
	 * (DING_GAP_MS) outlasts the ring's decay.
	 * 'attention' = soft rising three-note chime. Dings are QUEUED: the next
	 * one waits for the previous ring to finish, so rapid notifications never
	 * overlap; a burst collapses to its latest sound.
	 */
	var dingKinds = [];
	var dingPlaying = false;
	var dingGen = 0;
	var DING_GAP_MS = 1900; /* ring tail is ~1.35s: the next ding waits out the full decay */

	function renderDing(kind) {
		/* volume 0 = fully silent. Skip the oscillators entirely: an
		 * exponentialRamp to 0 is ILLEGAL in the Web Audio API (target must
		 * be > 0) and would throw a RangeError on every notification. */
		if (typeof CONFIG === 'object' && CONFIG && CONFIG.volume <= 0) return true;
		var ctx = ensureAudio();
		if (!ctx) return false;
		var t0 = ctx.currentTime;
		var ring = function (startAt, freq, dur, vol) {
			var osc = ctx.createOscillator();
			var gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			/* master volume from CONFIG (0..1); never zero — exponential
			 * ramps require a positive target */
			var v = Math.max(0.0001, vol * CONFIG.volume);
			gain.gain.setValueAtTime(0.0001, startAt);
			gain.gain.exponentialRampToValueAtTime(v, startAt + 0.005);
			gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(startAt);
			osc.stop(startAt + dur + 0.05);
		};
		/* per-notification sound (设置 → 音色: 每种通知单独选) */
		var scheme = kind === 'done' ? CONFIG.soundDone
			: kind === 'fail' ? CONFIG.soundFail
			: kind === 'remind' ? CONFIG.soundRemind
			: CONFIG.soundAttn;
		if (scheme === 'ding') {
			/* single clean strike: E6 + soft octave */
			ring(t0, 1319, 0.6, 0.15);
			ring(t0, 2638, 0.45, 0.045);
			return true;
		}
		if (scheme === 'bell') {
			/* bicycle bell — two strikes, inharmonic partials */
			var strikes = [
				{ t: 0, d: 0.55, g: 0.16 },
				{ t: 0.32, d: 0.7, g: 0.13 }
			];
			var partials = [
				{ mult: 1, rel: 1 },
				{ mult: 2, rel: 0.35 },
				{ mult: 2.76, rel: 0.2 }
			];
			var BASE = 2400;
			for (var s = 0; s < strikes.length; s++) {
				for (var p = 0; p < partials.length; p++) {
					ring(t0 + strikes[s].t, BASE * partials[p].mult, strikes[s].d, strikes[s].g * partials[p].rel);
				}
			}
			return true;
		}
		if (scheme === 'chime') {
			/* soft two-note rise, marimba-ish */
			ring(t0, 784, 0.35, 0.14);
			ring(t0 + 0.14, 1046, 0.5, 0.12);
			return true;
		}
		/* kind-specific built-ins (when not overridden above) and 'none' */
		/* 'none' means SILENT — the kind-specific built-ins below must not
		 * ring either (pre-existing bug: attention 选静音仍会响内置琶音) */
		if (scheme === 'none') return true;
		if (kind === 'remind' && scheme === 'thud') {
			/* gentle low knock-knock: a reminder, not a failure — softer and
			 * slightly higher than the fail thud, two soft thumps */
			ring(t0, 330, 0.18, 0.13);
			ring(t0 + 0.22, 277, 0.22, 0.10);
			return true;
		}
		if (kind === 'fail') {
			/* thud: dull descending minor third */
			ring(t0, 550, 0.22, 0.15);
			ring(t0 + 0.18, 415, 0.3, 0.11);
			return true;
		}
		if (kind === 'attention') {
			var chimes = [523, 659, 784];
			for (var c = 0; c < chimes.length; c++) {
				ring(t0 + c * 0.18, chimes[c], 0.3, 0.13);
			}
			return true;
		}
		return true; /* 'none': counted as played, silence */
	}

	function pumpDings() {
		if (dingPlaying || dingKinds.length === 0) return;
		dingPlaying = true;
		var kind = dingKinds.shift();
		var gen = dingGen;
		if (!renderDing(kind)) {
			/* audio not ready yet (autoplay resume pending): put the ring back
			 * and retry when the context actually runs */
			dingKinds.unshift(kind);
			dingPlaying = false;
			ensureAudio(); /* schedules the resume().then(pumpDings) retry */
			return;
		}
		setTimeout(function () {
			if (gen !== dingGen) return; /* reset invalidated the queue */
			dingPlaying = false;
			pumpDings();
		}, DING_GAP_MS);
	}

	/* 显式试听（11-11 三报延时分析，用户实报「点完要等一两秒」）：根因=
	 * 预览误入通知队列——dingPlaying/DING_GAP_MS(1900ms) 是**通知防叠**
	 * 设计，预览撞上忙队列就要等足间隔。previewDing 开独立直渲通道：
	 * 直接渲染（允许与正在响的通知短暂重叠——用户主动点的，要的是立即
	 * 反馈），不占 dingPlaying、不等 1900ms；AudioContext 挂起时
	 * pendingPreview 暂存，resume 成功后补响（连点=最后一击生效）。 */
	var pendingPreview = null;
	function pumpPreview() {
		if (!pendingPreview) return;
		var kind = pendingPreview;
		if (renderDing(kind)) {
			pendingPreview = null;
			return;
		}
		ensureAudio(); /* resume().then → pumpPreview 重试 */
	}
	function previewDing(kind) {
		if (soundMuted) return; /* 总静音仍是硬闸 */
		pendingPreview = kind;
		pumpPreview();
	}

	/* 自动播放解锁重试（11-11 三轮，用户实报「第一条通知无声，双击红标后
	 * 恢复」）：resume() 被拒（autoplay 策略、窗口尚无用户激活）时旧代码
	 * 就地静默丢弃——排队的 ding 永远不响。挂一次性手势监听：用户第一次
	 * 点/按（sticky activation 之后 resume 必成功）即补 pumpDings/
	 * pumpPreview，排队的首声在首次交互后立即补上。 */
	var audioUnlockArmed = false;
	function armAudioUnlockRetry() {
		if (audioUnlockArmed) return;
		audioUnlockArmed = true;
		var unlock = function () {
			audioUnlockArmed = false;
			['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
				try { window.removeEventListener(t, unlock); } catch (e2) {}
			});
			try { pumpDings(); pumpPreview(); } catch (e3) { /* 桩环境 */ }
		};
		['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
			try { window.addEventListener(t, unlock); } catch (e4) {}
		});
	}

	/** 免打扰窗口：开着且当前本地时间落在 [from, to) 内（支持跨零点）。 */
	function dndActive() {
		if (!CONFIG.dndEnabled) return false;
		var toMin = function (v) {
			var p = /^(\d{1,2}):(\d{2})$/.exec(v || '');
			return p ? (+p[1]) * 60 + (+p[2]) : null;
		};
		var from = toMin(CONFIG.dndFrom);
		var to = toMin(CONFIG.dndTo);
		if (from === null || to === null || from === to) return false;
		var d = new Date();
		var cur = d.getHours() * 60 + d.getMinutes();
		return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
	}

	function playDing(kind, opts) {
		if (soundMuted) return; /* right-click menu: one-tap mute */
		/* 11-11 真机修复轮：opts.force = 显式试听（设置页改音色）——绕过
		 * 桌宠在岗静默与免丢弃（预览是用户主动点的，静默=「设置无效」
		 * 观感）；总静音仍是硬闸（用户明确选了全局无声）。 */
		if (!(opts && opts.force)) {
			if (petDormant) return; /* 桌宠在岗：页面鲸鱼休眠静默（桌宠窗口自己响） */
			/* 免打扰: completion/failure sounds are dropped (attention still
			 * rings — the user must act on those regardless of the hour) */
			if (dndActive() && (kind === 'done' || kind === 'fail')) return;
		}
		if (dingKinds.length >= 6) {
			/* an extreme burst: drop the oldest backlog so the queue stays sane */
			dingKinds.splice(0, dingKinds.length - 5);
		}
		dingKinds.push(kind);
		pumpDings();
	}

	/** Sound on/off for the dings, persisted ("dsh-whale:sound"). */
	var SOUND_KEY = 'dsh-whale:sound';
	var soundMuted = false;
	{
		soundMuted = safeGet(SOUND_KEY, function (v0) {
			/* migrate bare 'off'/'on' -> v1 envelope */
			return typeof v0 === 'string' ? v0 : null;
		}) === 'off';
	}
	function setSoundMuted(muted) {
		soundMuted = !!muted;
		safeSet(SOUND_KEY, soundMuted ? 'off' : 'on');
		/* 11-11 真机修复轮：总静音也要过 relay 到桌宠（桌面响的是桌宠） */
		if (!PET_MODE) pushPetConfig();
	}

	/* ------------------------------------------------------------------ */
	/* Live status: busy-tool bubbles, token/pressure, sleep, gear         */
/* ---- module: src/ui/status-panel.js ---- */
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
		/* 气泡同场夹紧（动态边界 2026-11-04）必须在 statusEl 判定**之前**：
		 * 主框从未显示过时 statusEl=null，整条链在下面就 return 了——拖鲸鱼
		 * 贴顶时开着的通知气泡不会翻面（实机 11-04 右上角实证 top=-58）。
		 * clampBubble 自带 whale/show 守卫，statusEl 与它互不依赖。 */
		try { clampBubble(); } catch (e) { }
		var el = statusEl;
		if (!el || !whale) return;
		var below = window.innerHeight - (whale.offsetTop + whale.offsetHeight);
		var wl = whale.offsetLeft;
		var w = whale.offsetWidth;
		var maxW;
		/* below needs (12px gap + content height) of real estate; a taller
		 * panel than the viewport can take flips ABOVE the whale instead */
		var estH = (statusCache ? statusCache.lines.length : 1) * 17 + 14;
		var above = below >= 80 && whale.offsetTop + whale.offsetHeight + 12 + estH > window.innerHeight;
		el.classList.toggle('dsh-whale-status-above', above);
		el.classList.toggle('dsh-whale-status-below', below >= 80 && !above);
		/* inline anchor reset: the below branch may right-anchor (below),
		 * the side branch is pure CSS-class anchored — stale inline values
		 * from a previous anchored state must never leak across variants */
		el.style.left = '';
		el.style.right = '';
		if (above || below >= 80) {
			/* under/over the whale. 11-05 用户二次实报：贴右缘时右侧只剩
			 * ~86px，报告整列被省略号吃掉（「此... 27.0K t...」）——修=
			 * 哪边宽朝哪边展开：右侧放不下（<190px 满行宽）且左侧更宽时
			 * 右锚定（inline right），面板从鲸鱼右缘向左展开到全宽；右缘
			 * 恒保持 16px 视口边距。省略号只留两端都放不下的极端兜底。 */
			el.classList.remove('dsh-whale-status-leftflip');
			var spaceR = window.innerWidth - wl - 4 - 16;
			var spaceL = window.innerWidth - 24; /* right-anchored: whole row minus margins */
			if (spaceR < 190 && spaceL > spaceR) {
				el.style.left = 'auto';
				el.style.right = Math.max(0, (wl + w) - (window.innerWidth - 16)) + 'px';
				maxW = Math.max(60, Math.min(280, spaceL));
			} else {
				maxW = Math.max(60, Math.min(280, spaceR));
			}
		} else {
			/* side panel: pick the ROOMIER side of the whale（11-05 同修：
			 * 旧判据 wl<140 过糙——wl=150 时左侧只剩 130px 照样截断） */
			var slL = wl - 20;
			var slR = window.innerWidth - (wl + w) - 16;
			var flip = slR > slL;
			el.classList.toggle('dsh-whale-status-leftflip', flip);
			maxW = Math.max(60, Math.min(280, flip ? slR : slL));
		}
		el.style.maxWidth = maxW + 'px';
		applyStatusText();
		/* 主框每看重排（扫秒增长文本/鲸鱼移动翻面），旁路框同步重算位置——
		 * 一次性的 inline 坐标会随主框漂移（P1 2026-10-28 左缘对齐） */
		placeReportBox();
	}

	/** Current panel content: { prefix, lines } — kept so the text can be
	 * re-flowed live while the whale moves. */
	var statusCache = null;

	/** Rough pixel width of a text line at 12px (CJK ≈ 12px, ASCII ≈ 6.5px).
	 * Synced with parts/style.css .dsh-whale-status font-size (P0 2026-10-27:
	 * was 11/6 at 11px — keep these in step with the stylesheet). */
	function estWidth(s) {
		var w = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			w += (c > 255 || (c >= 0x2e80 && c <= 0xffef)) ? 12 : 6.5;
		}
		return w + 20; /* padding + border */
	}

	/** Fit the cached content: one compact line when it fits, otherwise
	 * one line per item (narrow space wraps into more lines). A `_stacked`
	 * cache (multi-session stuck hint) ALWAYS renders one line per row —
	 * 用户拍板 09-12: 多会话并列显示不合并。A `rows` cache (P1 completion
	 * reports) renders a two-column label/value GRID instead of wrapped text —
	 * numbers can never split across lines ("22.9K / tokens" 折行事故). */
	function applyStatusText(el, cache) {
		var box = el || statusEl;
		var data = cache || statusCache;
		if (!box || !data) return;
		var maxW = parseFloat(box.style.maxWidth) || 280;
		if (data._stacked) {
			box.textContent = data.prefix + data.lines.join('\n');
			return;
		}
		if (data.rows) {
			box.textContent = '';
			for (var ri = 0; ri < data.rows.length; ri++) {
				var kv = document.createElement('div');
				kv.className = 'dsh-whale-status-kv';
				var kEl = document.createElement('span');
				kEl.className = 'k';
				/* trailing space: keeps textContent as "label value" (tests and
				 * screen readers read the old one-line format) without becoming
				 * an anonymous flex item */
				kEl.textContent = data.rows[ri].label + ' ';
				var vEl = document.createElement('span');
				vEl.className = 'v';
				vEl.textContent = data.rows[ri].value;
				kv.appendChild(kEl);
				kv.appendChild(vEl);
				box.appendChild(kv);
			}
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

	/** Place the displaced report box relative to the main box: LEFT of it
	 * first; above it when the left edge is hit; its right side as the last
	 * resort. Variant classes mirror the main box so the CSS anchoring stays
	 * coherent. Extracted (P1 2026-10-28 主框/旁路框堆叠左缘对齐): the main
	 * box re-flows LIVE — the stuck hint's seconds grow its text every 2s
	 * sweep and whale moves flip variants — so a one-shot inline position
	 * went stale and the pair drifted apart; updateStatusPos re-places the
	 * box on every main-box reflow. */
	function placeReportBox() {
		var main = statusEl;
		var el = reportEl;
		if (!main || !el || !el.classList.contains('show')) return;
		el.classList.toggle('dsh-whale-status-below', main.classList.contains('dsh-whale-status-below'));
		el.classList.toggle('dsh-whale-status-above', main.classList.contains('dsh-whale-status-above'));
		el.classList.toggle('dsh-whale-status-leftflip', main.classList.contains('dsh-whale-status-leftflip'));
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
		var maxW = parseFloat(main.style.maxWidth) || 280;
		el.style.maxWidth = maxW + 'px';
		applyStatusText(el, reportCache);
		el.classList.add('show');
		placeReportBox();
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

/* ---- module: src/core/sleep.js ---- */
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

/* ---- module: src/core/gear.js ---- */
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

/* ---- module: src/core/affection.js ---- */
	/* affection: earned by petting the whale (right-click twice). Long-term
	 * progression — tiers unlock new reaction lines, future hidden gear. */
	var AFFECTION_KEY = 'dsh-whale:affection';
	var affection = 0;
	var AFFECTION_TIERS = [
		{ min: 0, lines: ['呜…被摸到了 🥹', '唔…舒服，再摸一下？😳', '摸头会变笨的啦！🐋', '干嘛啦，我还在上班呢 😤'] },
		{ min: 10, lines: ['嘿嘿，就喜欢被摸头 🐳💙', '你是我最好的同事啦 🥰', '摸一次，元气 +10！⚡', '好啦好啦，我知道你疼我 😌'] },
		{ min: 50, lines: ['我们已经是好朋友了呀 🐳✨', '这辈子就跟着你混了 🐋❤️', '摸头是暗号，接住了！🫶', '我的心，已经是你的形状了 💙'] }
	];
	function loadAffection() {
		var stored = safeGet(AFFECTION_KEY, function (v0) {
			/* migrate { value: N } -> v1 */
			return (v0 && typeof v0 === 'object' && typeof v0.value === 'number') ? v0 : null;
		});
		if (stored && typeof stored.value === 'number') affection = stored.value;
	}
	function saveAffection() {
		safeSet(AFFECTION_KEY, { value: affection });
	}
	function affectionTier() {
		var tier = AFFECTION_TIERS[0];
		for (var i = 0; i < AFFECTION_TIERS.length; i++) {
			if (affection >= AFFECTION_TIERS[i].min) tier = AFFECTION_TIERS[i];
		}
		return tier;
	}
	function petLine() {
		var lines = affectionTier().lines;
		return lines[Math.floor(Math.random() * lines.length)];
	}

	/* ------------------------------------------------------------------ */
	/* Mux frame handling                                                  */
	/* ------------------------------------------------------------------ */
	/**
	 * Sub-tasks (background jobs) never announce: no bubble, no unread, no
	 * sound — they only move the workload/mood state and feed the click
	 * summary. Only the main task (conversation turns) and attention
	 * requests (approval/question) produce notifications.
	 *
	 * A second kind of sub-task is a spawned SUBAGENT: its session id is a
	 * bare UUID and its turn events (turn/start, turn/end) flow on the same
	 * mux channel. Those turns are sub-task activity too and stay silent —
	 * only sessions whose id starts with `session-` (the user's own
	 * conversations) are treated as the main task.
	 */
/* ---- module: src/core/frames.js ---- */
	function isMainSession(sessionId) {
		return typeof sessionId === 'string' && sessionId.indexOf(SESSION_ID_PREFIX) === 0;
	}

	/** When each session's CURRENT turn started (event.time at turn/start).
	 * The DOM usage chip (alpha-adapter) reads a row's rendered stamp — a chip
	 * whose stamp is OLDER than the current turn's start belongs to the
	 * PREVIOUS turn (back-to-back tasks race the chip render) and must not
	 * write the ledger, or the new turn's report starts pre-inflated by the
	 * whole previous burn. Minute-granular stamps: comparisons keep a +60s
	 * slack so a chip from the same displayed minute is never discarded. */
	var turnStartedAtBySession = new Map();

	function sessionTurnStartedAt(sessionId) {
		return turnStartedAtBySession.get(sessionId) || 0;
	}

	function isFailedJob(job) {
		if (job.status === 'failed') return true;
		if (job.status !== 'completed') return false;
		var detail = job.detail;
		return typeof detail === 'string' && /exit code:\s*[1-9]\d*/.test(detail);
	}

	function handleJobsFrame(frame) {
		var sessionId = frame.sessionId;
		var bAt = baselineSessions.get(sessionId);
		var isBaseline = bAt !== undefined && (Date.now() - bAt) < (baselineTtlOverride || BASELINE_TTL_MS);
		if (bAt !== undefined) baselineSessions.delete(sessionId);
		var jobs = Array.isArray(frame.jobs) ? frame.jobs : [];
		jobs.forEach(function (job) {
			if (!job || typeof job.id !== 'string') return;
			/* terminal keystroke pumps are not user tasks */
			if (job.kind === 'pty-send') return;
			var prev = known.get(job.id);
			var changed = false;
			if (prev === undefined) {
				known.set(job.id, {
					status: job.status,
					label: job.label,
					kind: job.kind,
					sessionId: sessionId,
					startedAt: job.startedAt,
					completedAt: job.status === 'completed' ? Date.now() : undefined
				});
				changed = true;
			} else if (prev.status !== job.status) {
				prev.status = job.status;
				prev.label = job.label;
				prev.kind = job.kind;
				prev.sessionId = sessionId;
				if (prev.startedAt === undefined && job.startedAt !== undefined) prev.startedAt = job.startedAt;
				if (job.status === 'completed') prev.completedAt = Date.now();
				changed = true;
			}
			if (!changed || isBaseline) return;
			touchActivity();
			/* workload only: starting/failing is tiring, completing relieves.
			 * `stopping` is a transient mid-state and must not double-count
			 * the job's start (running already counted it). */
			if (job.status === 'running') bumpWork(1);
			else if (isFailedJob(job)) bumpWork(1);
			else if (job.status === 'completed') bumpWork(-0.5);
			else if (job.status === 'killed') bumpWork(0.5);
		});
		/* memory audit (P2⑨): job ids accumulate over days-long sessions */
		capMap(known, 200);
	}

	/** Completed subtasks for one session since a moment — the run timer's
	 * "已完成 N 个子任务" count (see ui/status-panel.js). */
	function countJobsCompleted(sid, sinceMs) {
		var n = 0;
		known.forEach(function (view) {
			if (view.sessionId === sid && view.status === 'completed' &&
				typeof view.completedAt === 'number' && view.completedAt >= sinceMs) n++;
		});
		return n;
	}

	/** A session (re)subscription resets its job set and marks the next frame as baseline. */
	function handleSubscribedFrame(frame) {
		var sid = frame.sessionId;
		known.forEach(function (view, id) {
			if (view.sessionId === sid) known.delete(id);
		});
		baselineSessions.set(sid, Date.now());
	}

	/**
	 * Subagent tracking: the `subagentTiming` projection exists ONLY on
	 * subagent sessions and is pushed live, so it is the reliable marker.
	 * The display label is fetched once per session from session.history
	 * (the `subagent/descriptor` event lives there; the `subagent` identity
	 * projection is only pushed on change and is usually missed).
	 */
	var subagentSessions = new Map(); /* sessionId -> { label, title, mode, fetching } */
	var labelFetches = new Map(); /* sessionId -> [onDone callbacks] (join in-flight fetches) */
	var sessionTitles = new Map(); /* live title projection per session (any session) */
	var holdMsOverride = null; /* test seam: override the name-hold timeout */

	/* The contact book: every REAL name ever learned, in localStorage and
	 * deliberately OUTSIDE 清空历史's reach (clearing wipes task records,
	 * not names — 09-06 用户报告: clear+reload made the first notification
	 * unnamed because every title source reads back from the cleared
	 * records). LRU by last-seen; hitting the cap only demotes the oldest
	 * name back to the placeholder→self-correct path, never misnames. */
	var TITLE_BOOK_CAP = 500;
	var titleBook = (function () {
		try {
			var raw = localStorage.getItem('dsh-whale:titles');
			var parsed = raw ? JSON.parse(raw) : null;
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch (e) { return {}; }
	})();
	function rememberTitle(sessionId, title) {
		/* 占位名不落通讯录（11-03 桌宠）：「任务 N」是枚举会话的临时显示名，
		 * 固化进 localStorage 会堵死真名的三条路（bookTitle 兜底/info.title
		 * 填充/correctReports 改写）——页鲸占位「未命名任务」本就不落，桌宠
		 * 占位同待遇。 */
		if (!sessionId || !title || title === '未命名任务' || /^任务 \d+$/.test(title)) return;
		titleBook[sessionId] = { t: title, at: Date.now() };
		var keys = Object.keys(titleBook);
		if (keys.length > TITLE_BOOK_CAP) {
			keys.sort(function (a, b) { return (titleBook[a].at || 0) - (titleBook[b].at || 0); });
			for (var i = 0; i < keys.length - TITLE_BOOK_CAP; i++) delete titleBook[keys[i]];
		}
		try { localStorage.setItem('dsh-whale:titles', JSON.stringify(titleBook)); } catch (e) {}
	}
	function bookTitle(sessionId) {
		var entry = titleBook[sessionId];
		return entry && entry.t ? entry.t : null;
	}

	/** Wipe the contact book AND the in-memory names (09-13 用户拍板: the
	 * missing "forget a conversation" entry). History records still carry
	 * name snapshots that re-seed on the next load — truly forgetting one
	 * conversation is two steps (清历史 first, then this), documented in
	 * the manual row. Returns the number of book entries wiped. */
	function clearTitleBook() {
		var n = Object.keys(titleBook).length;
		titleBook = {};
		try { localStorage.removeItem('dsh-whale:titles'); } catch (e) {}
		sessionTitles.clear();
		return n;
	}
	(function seedTitlesFromBook() {
		for (var sid in titleBook) {
			if (titleBook[sid] && titleBook[sid].t && !sessionTitles.get(sid)) {
				sessionTitles.set(sid, titleBook[sid].t);
			}
		}
		capMap(sessionTitles, 150);
	})();

	/** Rewrite queued/visible reports that used the fallback name. */
	function correctReports(sessionId, title) {
		correctHistoryTitle(sessionId, title); /* history rows saved pre-name follow too */
		rememberTitle(sessionId, title); /* and the contact book learns the real name */
		/* 桌宠占位「[任务 N]」同享晚到改写（11-03）：枚举会话的占位名与
		 * 「未命名任务」语义相同——真实标题到达即改写，两者都不许残留。 */
		function isFallback(text) {
			return text.indexOf('未命名任务') !== -1 || /^\[[任务]+ \d+\]/.test(text);
		}
		function applyTitle(text) {
			return /^\[任务 \d+\]/.test(text)
				? text.replace(/^\[任务 \d+\]/, '[' + title + ']')
				: text.split('未命名任务').join(title);
		}
		var changed = false;
		for (var i = 0; i < reportQueue.length; i++) {
			var item = reportQueue[i];
			if (item.sessionId === sessionId && isFallback(item.text)) {
				item.text = applyTitle(item.text);
				changed = true;
			}
		}
		/* rewrite the live bubble ONLY when it is showing THIS session's
		 * report — a late title must never rewrite another session's
		 * text or an unrelated bubble (click summary, idle line, …).
		 * Independent of the queue: the start notification no longer
		 * enters the unread queue (不进红标), so its live bubble is the
		 * only thing a late title can still fix. */
		if (document && document.querySelector) {
			var bubble = document.querySelector('.dsh-whale-bubble');
			if (bubble && currentSaySession === sessionId && isFallback(bubble.textContent)) {
				bubble.textContent = applyTitle(bubble.textContent);
			}
		}
	}
	/* seam: 桌宠 titles 预填（server-events poll）改写已排队的占位通知（11-03） */
	try { window.__dshWhale._correctReports = correctReports; } catch (e) {}

	function fetchSubagentLabel(sessionId, onDone) {
		if (typeof fetch !== 'function') {
			if (onDone) onDone();
			return;
		}
		var callbacks = labelFetches.get(sessionId);
		if (callbacks) {
			/* a fetch is already in flight: join it */
			if (onDone) callbacks.push(onDone);
			return;
		}
		callbacks = onDone ? [onDone] : [];
		labelFetches.set(sessionId, callbacks);
		var finishFetch = function () {
			labelFetches.delete(sessionId);
			for (var i = 0; i < callbacks.length; i++) {
				try {
					callbacks[i]();
				} catch (error) {
					/* ignore */
				}
			}
		};
		try {
			/*
			 * Name resolution: the descriptor label lives at the HEAD of the
			 * log and is unreachable for long sessions (history paginates from
			 * the tail), and some sessions have no descriptor at all — so the
			 * session TITLE (returned in the tail page's projections block)
			 * is the reliable name. Priority: descriptor label > title.
			 */
			fetch('/api/session.history', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: 'client-request',
					rpcId: 'dsh-whale-' + Date.now() + '-' + Math.random().toString(36).slice(2),
					method: 'session.history',
					payload: { sessionId: sessionId, maxMessages: 20 }
				})
			}).then(function (response) {
				return response.json();
			}).then(function (envelope) {
				var value = envelope && envelope.result && envelope.result.value;
				var info = subagentSessions.get(sessionId);
				var events = value && value.events;
				if (info && Array.isArray(events)) {
					for (var i = events.length - 1; i >= 0; i--) {
						var item = events[i];
						var event = item && item.event;
						if (event && event.type === 'subagent/descriptor' &&
							event.data && typeof event.data.label === 'string') {
							info.label = event.data.label;
							return;
						}
					}
				}
			var projections = value && value.projections && value.projections.values;
			if (projections && typeof projections.title === 'string') {
					/* the title is useful for ANY session, not just subagents */
					sessionTitles.set(sessionId, projections.title);
					rememberTitle(sessionId, projections.title);
					if (info) info.title = projections.title;
				}
			}).then(finishFetch, finishFetch);
		} catch (error) {
			finishFetch();
		}
	}

	/** Flush reports held while the session name was still pending, in
	 * EVENT ORDER: a turn/end hold (3s) can expire before the turn/start
	 * hold (8s), so the queue is drained sorted by event seq — otherwise
	 * the "完成" report would surface before its "开工" report. */
	function flushHeld(sessionId) {
		var info = subagentSessions.get(sessionId);
		if (!info || !info._flush) return;
		var held = info._flush;
		info._flush = null;
		held.sort(function (a, b) {
			return (a.seq || 0) - (b.seq || 0);
		});
		for (var i = 0; i < held.length; i++) {
			try {
				held[i].fn();
			} catch (error) {
				/* ignore */
			}
		}
	}

	function handleProjectionFrame(frame) {
		if (frame.key === 'tokenUsage') {
			if (isMainSession(frame.sessionId)) {
				sessionUsage.set(frame.sessionId, frame.value || {});
				capMap(sessionUsage, 150); /* memory audit */
				lastMainSession = frame.sessionId;
			}
			backfillEndPanel(frame.sessionId); /* 用量投影迟到 → 补全完成面板 (用户报告 09-20) */
			touchActivity();
			return;
		}
		if (frame.key === 'contextPressure') {
			if (isMainSession(frame.sessionId)) {
				sessionPressure.set(frame.sessionId, frame.value || {});
				capMap(sessionPressure, 150); /* memory audit */
				lastMainSession = frame.sessionId;
			}
			backfillEndPanel(frame.sessionId); /* 压力投影迟到 → 补全完成面板 */
			maybeWarnPressure();
			/* pressure -> status panel border hue */
			applyPressureHue();
			touchActivity();
			return;
		}
		if (frame.key === 'title') {
			if (typeof frame.value === 'string') {
				sessionTitles.set(frame.sessionId, frame.value);
				rememberTitle(frame.sessionId, frame.value);
				capMap(sessionTitles, 150); /* memory audit: one entry per conversation ever seen */
				var tinfo = subagentSessions.get(frame.sessionId);
				if (tinfo) {
					tinfo.title = frame.value;
					flushHeld(frame.sessionId);
				}
				/* late title: fix reports already spoken with the fallback —
				 * for ANY session, not just registered subagent sessions
				 * (attention reports name themselves 未命名任务 while the LLM
				 * title is still generating, 09-05) */
				correctReports(frame.sessionId, frame.value);
			}
			return;
		}
		if (frame.key === 'subagentTiming') {
			/* spawned subagents (bare-UUID sessions) are sub-tasks: never
			 * track their turns, so they can never announce. Only the user's
			 * own conversations (session- prefix) are the main task. */
			if (!isMainSession(frame.sessionId)) return;
			var info = subagentSessions.get(frame.sessionId);
			if (info === undefined) {
				subagentSessions.set(frame.sessionId, {
					label: '',
					title: sessionTitles.get(frame.sessionId),
					mode: '',
					fetching: false
				});
				fetchSubagentLabel(frame.sessionId);
			}
			return;
		}
		if (frame.key !== 'subagent') return;
		var identity = frame.value;
		if (identity && identity.mode) {
			var existing = subagentSessions.get(frame.sessionId);
			subagentSessions.set(frame.sessionId, {
				label: typeof identity.label === 'string' ? identity.label : (existing ? existing.label : ''),
				title: existing ? existing.title : sessionTitles.get(frame.sessionId),
				mode: identity.mode,
				fetching: existing ? existing.fetching : false
			});
		}
		/* a null identity never unmarks: sessions do not change nature */
	}

	/** Compose and report one turn event for a known subagent session. */
	function reportTurn(frame) {
		var info = subagentSessions.get(frame.sessionId);
		if (!info) return;
		var event = frame.event;
		var title = truncate(
			info.label
			|| (info.title && !/^任务 \d+$/.test(info.title) ? info.title : null)
			/* 桌宠真名（11-03）：sessionTitles 是预填/实时 title 的直接落点，
			 * 优先级高于固化的 info.title 占位（「任务 N」不许压住真名） */
			|| sessionTitles.get(frame.sessionId)
			|| bookTitle(frame.sessionId)
			|| '未命名任务', 40);
		/* 11-03 诊断缝（真名链路排查，收口后移除）：title 各段实值 */
		try { window.__dshWhale._titleProbe = { sid: frame.sessionId, seq: frame.seq, label: info.label, infoTitle: info.title, mem: sessionTitles.get(frame.sessionId), book: bookTitle(frame.sessionId), chosen: title }; } catch (e) {}
		if (event.type === 'turn/start') {
			bumpWork(1);
			/* mark the status panel as busy while this turn runs */
			markStatusBusy(true);
			/* (the task counter was already reset on the live turn/start
			 * event, before the name-hold, so early usage is kept) */
			if (CONFIG.notifyOnStart && !event.replaySuppress) {
				var startMsg = '[' + title + ']开工了 ' + pickTail('running');
				say(startMsg, DURATION_START, frame.sessionId);
				/* 开工通知不计入红标（user request): say only — no
				 * pushReport, so the unread badge counts real outcomes */
			}
		} else if (event.type === 'turn/end') {
			bumpWork(-0.5);
			/* distinguish failure/success from the turn/end reason
			 * (live-verified kinds: "completed" | "aborted"(user stop) |
			 * "error"(LLM-level failure) | "max-tokens") */
			var reason = event.data && event.data.reason && event.data.reason.kind;
			var isError = reason === 'error';
			var isMaxTokens = reason === 'max-tokens';
			var isAborted = reason === 'aborted';
			/* history定位信息: end 事件的宿主时间戳(ms epoch)，供抽屉跳转时
			 * 让目标会话向回翻页覆盖该时刻 */
			var atMs = typeof event.time === 'number' ? event.time : Date.now();
			if (isAborted) {
				/* stopped by the user: not a success — no completion bell, no
				 * gear credit; history keeps a neutral ⏹ entry that still jumps.
				 * 11-14（用户拍板）：中止/截断/失败同族=「任务没正常跑完」，
				 * 统一播任务失败音色（免打扰同失败待遇）。 */
				var stopMsg = '[' + title + ']被中止了 ✋';
				if (!event.replaySuppress) {
					say(stopMsg, DURATION_END, frame.sessionId);
					if (!dndActive()) playDing('fail');
				}
				pushReport(stopMsg, DURATION_END, frame.sessionId, undefined, atMs);
				pushHistory({ title: title, sessionId: frame.sessionId, kind: 'killed', at: Date.now(), endTime: atMs, turnTokens: sessionTurnTokens(frame.sessionId) });
			} else if (isError) {
				var endMsg = '[' + title + ']失败了 ' + pickTail('failed') + '（双击通知可回到该对话）';
				if (!event.replaySuppress && !dndActive()) {
					say(endMsg, DURATION_END, frame.sessionId);
					playDing('fail');
					var repFail = statusReport(sessionTurnTokens(frame.sessionId), sessionTotalTokens(frame.sessionId), sessionPressure.get(frame.sessionId));
					if (repFail) showStatusPanel(repFail, DURATION_END);
					armEndBackfill(frame.sessionId, repFail ? repFail.lines.length : 0);
				}
				pushReport(endMsg, DURATION_END, frame.sessionId, undefined, atMs);
				/* a failed task does not count toward the daily gear */
				pushHistory({ title: title, sessionId: frame.sessionId, kind: 'fail', at: Date.now(), endTime: atMs, turnTokens: sessionTurnTokens(frame.sessionId) });
			} else {
				/* batch-fold contract (see server-events consume pre-scan):
				 * a flood batch's OLDER completed turns carry foldSuppress —
				 * they record history + gear credit silently so the unread
				 * badge never explodes; the NEWEST carries foldCount and
				 * announces once for the whole batch. */
				if (event.replaySuppress) {
					/* 重放批（11-03）：DSH 重启后的历史恢复——完成通知**只静默
					 * 记账**：红标（pushReport）照记（未读不丢）、历史/gear 照
					 * 记，但 say/音效/面板全跳过——否则重启前 60s 内的完成会在
					 * 重启后**再响一次**（用户实报「提示音出现两次」）。 */
					var replayMsg = isMaxTokens
						? '[' + title + ']被截断了 ' + pickTail('killed')
						: '[' + title + ']完成了 ' + completedTail();
					pushReport(replayMsg, DURATION_END, frame.sessionId, undefined, atMs);
					pushHistory({
						title: title,
						sessionId: frame.sessionId,
						kind: isMaxTokens ? 'max-tokens' : 'done',
						at: Date.now(),
						endTime: atMs,
						turnTokens: sessionTurnTokens(frame.sessionId)
					});
					gearStats.tasksDone++;
					saveGearStats();
					return;
				}
				if (event.foldSuppress) {
					gearStats.tasksDone++;
					saveGearStats();
					pushHistory({
						title: title,
						sessionId: frame.sessionId,
						kind: 'done',
						at: Date.now(),
						endTime: atMs,
						turnTokens: sessionTurnTokens(frame.sessionId)
					});
					return;
				}
				var endMsg = event.foldCount >= 2
					? '[' + title + ']完成了 ' + event.foldCount + ' 个任务 📦'
					: isMaxTokens
						? '[' + title + ']被截断了 ' + pickTail('killed')
						: '[' + title + ']完成了 ' + completedTail();
				/* tokens 播报与通知一一对应 (user request, 2026-09-02 定稿):
				 * the bubble on top, THIS turn's token report in the panel
				 * below — they appear together, switch together, and the
				 * panel dies WITH the bubble (uiSay hides it). 免打扰 keeps
				 * the pair silent (badge only), exactly like the bubble. */
				if (!dndActive()) {
					say(endMsg, DURATION_END, frame.sessionId);
					/* 截断与失败同族（11-14 用户拍板）：任务没正常跑完=失败
					 * 音色，不再混用完成「叮」 */
					playDing(isMaxTokens ? 'fail' : 'done');
					var rep = statusReport(sessionTurnTokens(frame.sessionId), sessionTotalTokens(frame.sessionId), sessionPressure.get(frame.sessionId));
					// KNOWN-COUPLING: frames->status-panel — push render (completion report opens the panel; the failure twin is the repFail call above)
					if (rep) showStatusPanel(rep, DURATION_END);
					armEndBackfill(frame.sessionId, rep ? rep.lines.length : 0);
				}
				pushReport(endMsg, DURATION_END, frame.sessionId, undefined, atMs);
				/* gear: each successfully finished main task counts */
				gearStats.tasksDone++;
				saveGearStats();
				unlockCheck();
				pushHistory({
					title: title,
					sessionId: frame.sessionId,
					kind: isMaxTokens ? 'max-tokens' : 'done',
					at: Date.now(),
					endTime: atMs,
					turnTokens: sessionTurnTokens(frame.sessionId)
				});
				/* the polled path announced this end: record it so the DOM
				 * chip (which may render a beat later for the visible turn)
				 * does not announce the same end twice (09-06 B3 mirror) */
				seeEndFire(frame.sessionId, 'success', atMs);
			}
		}
	}

	function handleEventFrame(frame) {
		var event = frame.event;
		if (!event || typeof event.type !== 'string') return;
		/* a user message arrived in any conversation: that is activity */
		if (event.type === 'agent/inbox/spliced') {
			touchActivity();
			return;
		}
		/* subagent (bare-UUID) turns are sub-task activity: silent — no
		 * bubble, no unread, no bell. Only the user's own conversations
		 * (session- prefix) are the main task. */
		if (!isMainSession(frame.sessionId)) return;
		/* live status: tool calls / steps — bubble only, throttled,
		 * never unread, never a bell */
		if (event.type === 'tool/call') {
			touchActivity();
			var tname = event.data && typeof event.data.name === 'string' ? event.data.name : '';
			/* track for the stuck watchdog (single-shot frames; a lib job is
			 * its own liveness proof, so slow jobs never flag) */
			var callKey = (event.data && (event.data.callId || event.data.callbackId)) || ('seq-' + (event.seq || 0));
			trackToolCall(callKey, frame.sessionId);
			showStatus(multiRunTag(frame.sessionId) + (tname ? '🔧 正在跑：' + tname : '🔧 正在跑工具'), 2600);
			return;
		}
		if (event.type === 'tool/result') {
			touchActivity();
			var rKey = event.data && (event.data.callId || event.data.callbackId);
			if (rKey) clearTool(rKey);
			else clearSessionTools(frame.sessionId); /* no key: fall back to all */
			return; /* the status bubble expires by itself */
		}
		if (event.type === 'step/start') {
			touchActivity();
			var step = event.data && event.data.step;
			showStatus(multiRunTag(frame.sessionId) + (step ? '📋 第 ' + step + ' 步' : '📋 新步骤'), 2200);
			return;
		}
		/* each model reply carries its own usage; accumulate it for the
		 * current task's token report. The usage lives on data.usage
		 * (verified live: data keys are turn,step,message,usage). */
		if (event.type === 'assistant/message') {
			touchActivity();
			var d = event.data || {};
			var usage = d.usage || (d.message && d.message.usage) || null;
			debugCounters.assistantMsgs++;
			if (usage) {
				var add = (usage.inputTokens || 0) +
					(usage.outputTokens || 0) +
					(usage.cacheReadTokens || 0);
				turnTokenUsage += add;
				/* per-session ledger: another session's turn/start must not
				 * clobber THIS conversation's burn (用户报告 09-20) */
				addSessionTurnTokens(frame.sessionId, add);
				debugCounters.usageEvents++;
				debugCounters.usageSum += add;
			}
			return;
		}
		if (event.type !== 'turn/start' && event.type !== 'turn/end') return;
		touchActivity(true); /* silent wake: 开工了/完成了 announce themselves */
		/* reset the task counter the moment the turn STARTS — the name-hold
		 * can delay reportTurn by seconds, and assistant/message usage may
		 * already be accumulating in that window; clearing here (not in
		 * reportTurn) keeps that early usage. The session tag rides along:
		 * it says WHOSE burn the counter currently holds. */
		if (event.type === 'turn/start') {
			turnTokenUsage = 0;
			turnTokenSession = frame.sessionId;
			/* per-session ledger reset: this session's next report reads its
			 * OWN burn, not whatever the global counter was left holding.
			 * (No cancel of endPanelBackfill here — another session starting
			 * a turn says nothing about THIS completion's pending backfill.) */
			turnTokensBySession.set(frame.sessionId, 0);
			/* stamp the start so a late PREVIOUS-turn chip can be recognized
			 * and discarded by the DOM chip writer (alpha-adapter) */
			turnStartedAtBySession.set(frame.sessionId, event.time || Date.now());
			if (turnStartedAtBySession.size > 100) {
				turnStartedAtBySession.delete(turnStartedAtBySession.keys().next().value);
			}
			/* long-task run timer (>2min ⇒ "⏳ 已运行" line in the panel) */
			startRunTimer(frame.sessionId);
		}
		if (event.type === 'turn/end') {
			/* a finished turn un-sticks any outstanding tool watchdog — this
			 * MUST run before the info lookup, otherwise a turn from an
			 * untracked session would leave the stuck hint on screen forever */
			clearSessionTools(frame.sessionId);
			markStatusBusy(false);
			stopRunTimer(frame.sessionId);
		}
		var info = subagentSessions.get(frame.sessionId);
		if (!info) return;
		if (info.label === '' && !info.title) {
			/* the name races the first turn event: the LLM-generated session
			 * title arrives seconds later, so start reports may wait up to
			 * 8s for it (end reports only 3s — by then the title exists).
			 * The flush drains the WHOLE pending queue in event order, so a
			 * later 3s hold can never out-run an earlier 8s hold. */
			var sessionId = frame.sessionId;
			var holdMs = holdMsOverride || (event.type === 'turn/start' ? 8000 : 3000);
			var flushed = false;
			var flushHeldReports = function () {
				if (flushed) return;
				flushed = true;
				clearTimeout(holdTimer);
				flushHeld(sessionId);
			};
			var holdTimer = setTimeout(flushHeldReports, holdMs);
			if (!info._flush) info._flush = [];
			info._flush.push({
				seq: frame.seq || 0,
				fn: function () { reportTurn(frame); }
			});
			fetchSubagentLabel(sessionId, flushHeldReports);
			return;
		}
		reportTurn(frame);
	}

	/** Compose and announce one attention request (approval / question). */
	function reportAttention(payload) {
		var sessionId = payload.sessionId;
		var name = '';
		var info = subagentSessions.get(sessionId);
		/* 占位过滤（11-14，用户 rc.3 实机「[任务 36] 需要你选择」而侧栏有真名）：
		 * 注册期快照的 info.title 可能是合成占位（「任务 N」——桌宠首轮
		 * turn/start 的 feedEventFrame 命名早于注册）——与 reportTurn 同款
		 * 语义：占位不许压住真名（sessionTitles 已被投影帧更新为真名）。 */
		if (info && info.label) name = info.label;
		if (!name && info && info.title && !/^任务 \d+$/.test(info.title)) name = info.title;
		if (!name) {
			var stored = sessionTitles.get(sessionId) || bookTitle(sessionId);
			if (stored) name = stored;
		}
		var kind; /* history record kind */
		var message;
		/* title unknown (new conversation whose LLM name is not generated
		 * yet): stay on the neutral 未命名任务 — the approval reason / question
		 * TEXT used to stand in here (09-05 user report), which read as a
		 * lost conversation name AND got saved as the history record title,
		 * re-seeding the polluted name via title prefill after every reload
		 * until the next history clear wiped it */
		if (payload.type === 'approval/requested') {
			message = '⚠️ [' + truncate(name || '未命名任务', 40) + ']需要你审核';
			kind = 'approval';
		} else {
			message = '🤔 [' + truncate(name || '未命名任务', 40) + ']需要你选择';
			kind = 'question';
		}
		var duration = DURATION_ATTN;
		say(message, duration, sessionId);
		/* NO token panel here (user request, 2026-09-05): the task is still
		 * running at an approval/question, so a usage readout is premature —
		 * the panel stays completion/failure-only. snapshot=false stores NO
		 * token/pressure either, so READING the report from the red badge
		 * replays text only (the read path resurrected the panel, 09-06).
		 * Attention requests are never DND-gated (same as the bubble/sound). */
		pushReport(message, duration, sessionId, false, typeof payload.time === 'number' ? payload.time : undefined);
		playDing('attention');
				/* approval/question requests belong to the history too (any session) */
		pushHistory({
			title: name || '未命名任务',
			sessionId: sessionId,
			kind: kind,
			at: Date.now(),
			endTime: typeof payload.time === 'number' ? payload.time : undefined,
			turnTokens: null
		});
	}

	/** A task is waiting for the user: approval or a question. */
	function handleAttentionFrame(payload) {
		touchActivity(true); /* silent wake: the ⚠️/🤔 request announces itself */
		var sessionId = payload.sessionId;
		var info = subagentSessions.get(sessionId);
		var known = (info && (info.label || info.title)) || sessionTitles.get(sessionId) || bookTitle(sessionId);
		if (!known) {
			/* the page may have just loaded: fetch the conversation title on
			 * demand (history returns it in the tail-page projections) */
			var reported = false;
			var report = function () {
				if (reported) return;
				reported = true;
				clearTimeout(attTimer);
				reportAttention(payload);
			};
			var attTimer = setTimeout(report, 1500);
			fetchSubagentLabel(sessionId, report);
			return;
		}
		reportAttention(payload);
	}

	function handleMuxPayload(payload) {
		if (payload.type === 'session/jobs') handleJobsFrame(payload);
		else if (payload.type === 'session/subscribed') handleSubscribedFrame(payload);
		else if (payload.type === 'session/projection') handleProjectionFrame(payload);
		else if (payload.type === 'session/event') handleEventFrame(payload);
		else if (payload.type === 'approval/requested' || payload.type === 'question/requested') handleAttentionFrame(payload);
	}
/* ---- module: src/utils/fmt-title.js ---- */

	function truncate(text, max) {
		var s = String(text == null ? '' : text);
		if (s.length <= max) return s;
		/* cut at a word boundary when possible, never mid-word */
		var cut = s.slice(0, max - 1);
		var space = cut.lastIndexOf(' ');
		if (space > max * 0.5) cut = cut.slice(0, space);
		return cut + '…';
	}

	/** git subcommand -> short Chinese verb. */
	var GIT_VERBS = {
		push: '推送',
		pull: '拉取',
		clone: '克隆',
		commit: '提交',
		status: '状态',
		log: '日志',
		add: '暂存',
		checkout: '切换',
		merge: '合并',
		stash: '暂存',
		fetch: '拉取',
		diff: '差异',
		branch: '分支',
		remote: '远程',
		tag: '标签',
		reset: '重置',
		rebase: '变基'
	};

	/** Common shell commands -> brief semantic titles (first match wins). */
	var COMMAND_TITLES = [
		{ re: /^Start-Sleep\s+-Seconds\s+(\d+)/i, title: function (m) { return '等待 ' + m[1] + ' 秒'; } },
		{ re: /^Start-Sleep\s+-Milliseconds\s+(\d+)/i, title: function (m) { return '等待 ' + m[1] + ' 毫秒'; } },
		{ re: /^git\s+(\S+)/i, title: function (m) { return 'Git ' + (GIT_VERBS[m[1].toLowerCase()] || m[1]); } },
		{ re: /^(npm|pnpm|yarn|bun)\s+(install|i)\b/i, title: '安装依赖' },
		{ re: /^(npm|pnpm|yarn|bun)\s+run\s+(\S+)/i, title: function (m) { return '运行脚本 ' + m[2]; } },
		{ re: /^(npm|pnpm|yarn|bun)\s+build\b/i, title: '构建项目' },
		{ re: /^node\s+/i, title: '运行 Node 脚本' },
		{ re: /^python3?\s+/i, title: '运行 Python 脚本' },
		{ re: /^pip3?\s+install\b/i, title: '安装 Python 包' },
		{ re: /^(cd|Set-Location)\b/i, title: '切换目录' },
		{ re: /^(ls|dir|Get-ChildItem)\b/i, title: '查看目录' },
		{ re: /^(echo|Write-Output)\b/i, title: '输出文本' },
		{ re: /^Start-Process\b/i, title: '启动进程' },
		{ re: /^(Invoke-WebRequest|curl)\b/i, title: '网络请求' }
	];

	/**
	 * Derive a short, human-friendly task title from a raw job label.
	 * - non-shell jobs (subagent, …) keep their description verbatim
	 * - shell jobs get a semantic title from COMMAND_TITLES, falling back to
	 *   the first statement (word-boundary truncated) of the cleaned command
	 */
	function taskTitle(job) {
		var label = String(job.label == null ? '' : job.label).trim();
		label = label.replace(/^\[Console\]::OutputEncoding[\s\S]*?\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\);\s*/i, '');
		var quoted = label.match(/^(['"])([\s\S]*)\1$/);
		if (quoted) label = quoted[2].trim();
		var kind = job.kind;
		if (kind === 'bash' || kind === 'pwsh' || kind === 'pty-send') {
			var first = label.split(';')[0].trim();
			for (var i = 0; i < COMMAND_TITLES.length; i++) {
				var m = first.match(COMMAND_TITLES[i].re);
				if (m) {
					var t = COMMAND_TITLES[i].title;
					return typeof t === 'function' ? t(m) : t;
				}
			}
			return truncate(first, 20);
		}
		return label;
	}

/* ---- module: src/core/mux.js ---- */
	/* ------------------------------------------------------------------ */
	/* Own mux WebSocket (independent of the app's connection)             */
	/* ------------------------------------------------------------------ */
	var reconnectDelay = 1000;
	var reconnectTimer = null;
	var connectedOnce = false;

	function startMux() {
		var socket;
		try {
			socket = new WebSocket(MUX_URL);
		} catch (error) {
			scheduleReconnect();
			return;
		}
		window.__dshWhale.sockets.push(socket);
		/* ring-cap the diagnostic socket list: dead sockets from past
		 * reconnects (sleep/wake cycles churn dozens over a long session)
		 * would otherwise accumulate for the page's whole life */
		while (window.__dshWhale.sockets.length > 4) window.__dshWhale.sockets.shift();

		socket.addEventListener('open', function () {
			reconnectDelay = 1000;
			if (!connectedOnce) {
				connectedOnce = true;
				/* one-time notice that the task channel is live */
				say('任务通道已连接，随时汇报 🐋✨', 3500);
			}
		});
		socket.addEventListener('message', function (event) {
			if (typeof event.data !== 'string') return;
			var envelope;
			try {
				envelope = JSON.parse(event.data);
			} catch (error) {
				return;
			}
			var payload = envelope && envelope.payload;
			if (!payload || typeof payload.type !== 'string') return;
			try {
				handleMuxPayload(payload);
			} catch (error) {
				/* never break the channel loop */
			}
		});
		socket.addEventListener('close', scheduleReconnect);
		socket.addEventListener('error', function () {
			/* close follows; nothing to do here */
		});
	}

	function scheduleReconnect() {
		if (reconnectTimer !== null) return;
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			startMux();
		}, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 15000);
	}

	startMux();
	loadConfig();
	loadGearStats();
	loadAffection();
	loadHistory();

	/* ------------------------------------------------------------------ */
/* ---- module: src/ui/swim-effects.js ---- */
	/* Swim helpers (pure; no DOM state)                                   */
	/* ------------------------------------------------------------------ */
	function easeInOutCubic(t) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function bezierPoint(s, t) {
		var u = 1 - t;
		return {
			x: u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1,
			y: u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1
		};
	}

	/** Heading (degrees, clockwise from east) of the path tangent at t. */
	function bezierHeading(s, t) {
		var a = bezierPoint(s, t);
		var b = bezierPoint(s, Math.min(1, t + 0.02));
		return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
	}

	function reducedMotion() {
		var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		return !!(mq && mq.matches);
	}

	/* ------------------------------------------------------------------ */
	/* Ripple layer (fixed overlay, independent of the whale element)      */
	/* ------------------------------------------------------------------ */
	var rippleLayer = null;

	function ensureRippleLayer() {
		if (rippleLayer !== null) return rippleLayer;
		if (!document.body) return null;
		rippleLayer = document.createElement('div');
		rippleLayer.className = 'dsh-whale-ripple-layer';
		document.body.appendChild(rippleLayer);
		return rippleLayer;
	}

	/** One expanding, fading ring at viewport (x, y); self-removes. */
	function spawnRipple(x, y, size) {
		var layer = ensureRippleLayer();
		if (!layer) return;
		var ripple = document.createElement('div');
		ripple.className = 'dsh-whale-ripple';
		var s = size || 10;
		ripple.style.left = x + 'px';
		ripple.style.top = y + 'px';
		ripple.style.width = s + 'px';
		ripple.style.height = s + 'px';
		ripple.style.marginLeft = (-s / 2) + 'px';
		ripple.style.marginTop = (-s / 2) + 'px';
		layer.appendChild(ripple);
		setTimeout(function () {
			if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
		}, 900);
	}

	/**
	 * Water-like arrival splash, fully JS-driven (no CSS custom properties or
	 * keyframes — every transform/opacity is computed inline per frame, so it
	 * renders identically everywhere): elliptical water-surface rings, a fan
	 * of radiating water jets, and gravity-arc spray droplets.
	 * @param x - impact x (viewport px)
	 * @param y - impact y (viewport px)
	 * @param ringCount - elliptical rings (default 4)
	 * @param jetCount - radiating jets (default 8)
	 * @param sprayCount - gravity droplets (default 10)
	 */
	function spawnWaterSplash(x, y, ringCount, jetCount, sprayCount) {
		var layer = ensureRippleLayer();
		if (!layer) return;
		var rings = ringCount === undefined ? 4 : ringCount;
		var jets = jetCount === undefined ? 8 : jetCount;
		var sprays = sprayCount === undefined ? 10 : sprayCount;
		var parts = [];
		var i;

		/* elliptical water-surface rings (wider than tall) */
		for (i = 0; i < rings; i++) {
			var size = 18 + i * 8;
			var ring = document.createElement('div');
			ring.className = 'dsh-whale-waterring';
			ring.style.left = x + 'px';
			ring.style.top = y + 'px';
			ring.style.width = size + 'px';
			ring.style.height = Math.round(size * 0.45) + 'px';
			ring.style.marginLeft = (-size / 2) + 'px';
			ring.style.marginTop = (-size * 0.45 / 2) + 'px';
			layer.appendChild(ring);
			parts.push({ el: ring, delay: i * 70, kind: 'ring' });
		}
		/* radiating water jets (upward fan) */
		for (i = 0; i < jets; i++) {
			var jet = document.createElement('div');
			jet.className = 'dsh-whale-jet';
			jet.style.left = x + 'px';
			jet.style.top = y + 'px';
			layer.appendChild(jet);
			parts.push({
				el: jet,
				delay: i * 40,
				kind: 'jet',
				angle: -160 + i * (140 / Math.max(1, jets - 1)) + (Math.random() * 14 - 7)
			});
		}
		/* gravity spray droplets (arc up, then fall) */
		for (i = 0; i < sprays; i++) {
			var drop = document.createElement('div');
			drop.className = 'dsh-whale-spray';
			drop.style.left = x + 'px';
			drop.style.top = y + 'px';
			layer.appendChild(drop);
			parts.push({
				el: drop,
				delay: i * 30,
				kind: 'spray',
				dx: Math.random() * 90 - 45,
				up: -(14 + Math.random() * 22)
			});
		}

		/* animation clock is relative to the first frame, so it works with any
		 * rAF source (browser or test driver) */
		var epoch = null;
		var total = 900;
		function splashTick(now) {
			if (epoch === null) epoch = now;
			var t = now - epoch;
			var alive = false;
			for (var p = 0; p < parts.length; p++) {
				var part = parts[p];
				var local = t - part.delay;
				if (local < 0) continue;
				var u = local / total;
				if (u >= 1) {
					part.el.style.opacity = '0';
					continue;
				}
				alive = true;
				var ease = 1 - Math.pow(1 - u, 2); /* ease-out */
				if (part.kind === 'ring') {
					var s = 0.3 + ease * 3.4;
					part.el.style.opacity = String(0.9 * (1 - u));
					part.el.style.transform = 'scaleX(' + (s * 2.2).toFixed(2) + ') scaleY(' + s.toFixed(2) + ')';
				} else if (part.kind === 'jet') {
					part.el.style.opacity = String(0.95 * (1 - u));
					part.el.style.transform = 'rotate(' + part.angle.toFixed(1) + 'deg) translateX(' + (ease * 42).toFixed(1) + 'px)';
				} else {
					/* spray: sideways drift + sine arc up and back down */
					var px = part.dx * Math.sin(Math.PI * Math.min(1, u * 1.15));
					var py = part.up * Math.sin(Math.PI * Math.min(1, u));
					part.el.style.opacity = String(Math.max(0, 1 - u));
					part.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
				}
			}
			if (alive) {
				requestAnimationFrame(splashTick);
			} else {
				for (var q = 0; q < parts.length; q++) {
					if (parts[q].el.parentNode) parts[q].el.parentNode.removeChild(parts[q].el);
				}
			}
		}
		requestAnimationFrame(splashTick);
	}

/* ---- module: src/ui/messages.js ---- */
	/* ------------------------------------------------------------------ */
	/* UI: speech bubble, badge, drag, click, swim-back                    */
	/* ------------------------------------------------------------------ */
	var POS_KEY = 'dsh-whale:pos';
	var DEFAULT_RIGHT = 18;
	var DEFAULT_BOTTOM = 18;
	var IDLE_LINES = [
		'我在旁边待命，一切顺利 🐋✨',
		'海面风平浪静～ 🌊😌',
		'任务都清空了，随时可以开工 💪',
		'别看我，我只是一只勤劳的小鲸鱼 🐳💦',
		'点击我，随时汇报进度哦 👀',
		'好无聊呀，给我找点活干吧 🥱',
		'今天也是元气满满的一天！🌟',
		'我在看海，也在看你 😊'
	];
	/** Said when the whale is grabbed mid-swim. */
	var CATCH_LINES = [
		'哎呀！被你抓住了！😱',
		'哇——别抓我！🫣',
		'咕噜咕噜…被抓到了 💦',
		'我游得还不够快呀 😤',
		'好吧好吧，你赢了 😝',
		'呜呜，放开我！🥺',
		'你这是偷袭！🐋💢'
	];
	/** Said when the whale finishes swimming back to its corner. */
	var ARRIVAL_LINES = [
		'我游回角落啦～ 🌊',
		'我游回角落啦！💦🐋',
		'我游回角落啦～ 🐳',
		'我游回角落啦，呼～ 😮‍💨'
	];
	/** Random emotional tail per report kind. */
	var VERB_TAILS = {
		running: ['🐋', '🐋💪', '🚀', '冲鸭！🐳', '走起！✨'],
		completed: ['✅', '🎉', '✨', '🎊', '完美！🌟', '漂亮！👏'],
		failed: ['⚠️', '😢', '💔', '翻车了 😿', '唔…😖'],
		killed: ['⏹️', '🫡', '好吧 🕊️'],
		stopping: ['🛑', '⏳'],
		remind: ['⏳', '🐳💦', '💪', '⏰'],
		busy: ['💪', '🔥', '冲呀！🚀']
	};

	function pickTail(key) {
		var list = VERB_TAILS[key];
		if (!list || list.length === 0) return '';
		/* a burnt-out whale lets its weariness leak into report tails */
		if (moodKey === 'burnt' && WEARY_TAILS[key] && Math.random() < 0.5) {
			return WEARY_TAILS[key][Math.floor(Math.random() * WEARY_TAILS[key].length)];
		}
		return list[Math.floor(Math.random() * list.length)];
	}

/* ---- module: src/core/mood.js ---- */
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
		/* day rollover: a page that lives across midnight must re-arm the
		 * daily cap (gear.js checkDayRollover pattern) — otherwise the
		 * "3/day" guide cap silently becomes a lifetime cap */
		if (petHintDay !== todayKey()) {
			petHintDay = todayKey();
			petHintCount = 0;
		}
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

/* ---- module: src/ui/bubble.js ---- */
	function uiSay(text, duration, sessionId) {
		/* 休眠期静默（桌宠在岗，页面鲸鱼只剩数据管线）——状态机在 core/state.js */
		if (petDormant) return;
		/* who owns the current bubble text — late-title rewrites must match */
		currentSaySession = sessionId || null;
		var bubble = document.querySelector('.dsh-whale-bubble');
		if (!bubble) return;
		bubble.textContent = text;
		bindBubbleHover(bubble);
		/* 1:1 lifecycle (user request): whenever the bubble switches or
		 * hides, the token/pressure panel below switches or hides WITH it —
		 * a stale usage panel must never outlive its notification and be
		 * mistaken for the next task's numbers. Report callers re-show the
		 * paired panel right after this call (same tick, no flicker). */
		hideStatusPanel();
		/* restart the pop-in animation on every message */
		bubble.classList.remove('show');
		void bubble.offsetWidth;
		bubble.classList.add('show');
		uiSay.visible = true;
		uiSay.remainMs = duration || 5000;
		uiSay.shownAt = Date.now();
		armBubbleHide(bubble, uiSay.remainMs);
		/* 动态边界（2026-11-04）：气泡原生只向上弹，鲸鱼贴顶时 2/3 出屏
		 * （实机 rect.top=-67）。show 前同步夹紧——offset 布局盒不受 pop
		 * 动画 transform 影响，判定无时序问题。 */
		clampBubble(true);
	}

	/** Keep the bubble inside the viewport (动态边界 2026-11-04): flip
	 * BELOW the whale when it would clip off the top (the
	 * `.dsh-whale-bubble-flip` variant mirrors the arrow and the pop
	 * animation), nudge horizontally with a margin when an edge clips it.
	 * Measured from the LAYOUT boxes (whale.offset* + bubble.offset*) which
	 * are immune to the pop animation's transform, so the call is safe both
	 * synchronously (uiSay, before .show) and live (updateStatusPos while
	 * the whale is dragged with a bubble open). Idempotent: clears the
	 * previous margin/flip first, then measures — flip can never oscillate
	 * because the measurement always happens in the un-flipped anchor. */
	function clampBubble(force) {
		var bubble = document.querySelector('.dsh-whale-bubble');
		if (!bubble || !whale) return;
		if (!force && !bubble.classList.contains('show')) return;
		bubble.style.marginLeft = '0px';
		bubble.classList.remove('dsh-whale-bubble-flip');
		if (!bubble.offsetWidth && !bubble.offsetHeight) return; /* vm stub */
		/* horizontal: the bubble is RIGHT-anchored (right:-8px), so for the
		 * over-constrained solve left = CBw - right - width - margin-left —
		 * a POSITIVE margin-left moves the box LEFT. To pull the box RIGHT
		 * (clipped at the left edge) the margin goes negative; to push it
		 * LEFT (clipped at the right edge) positive. 实机 11-04：两分支初版
		 * 写反，贴左气泡 left=-2 出屏 2px 实证后修正。 */
		var left = whale.offsetLeft + bubble.offsetLeft;
		var right = left + bubble.offsetWidth;
		if (left < 4) {
			bubble.style.marginLeft = (left - 4) + 'px';
		} else if (right > window.innerWidth - 4) {
			bubble.style.marginLeft = (right - (window.innerWidth - 4)) + 'px';
		}
		if (whale.offsetTop + bubble.offsetTop < 2) bubble.classList.add('dsh-whale-bubble-flip');
	}

	function armBubbleHide(bubble, ms) {
		clearTimeout(uiSay.timer);
		uiSay.timer = setTimeout(function () {
			uiSay.timer = null;
			uiSay.visible = false;
			bubble.classList.remove('show');
			hideStatusPanel();
		}, ms);
	}

	/* Hover pause (#9): mouse on the bubble freezes the countdown; leaving
	 * resumes the REMAINING time, floored at 1.5s so a bubble never vanishes
	 * the instant the cursor leaves. The paired panel below pauses with it
	 * (same 1:1 lifecycle). Bound once on the persistent bubble element. */
	function bubbleResumeMs(remainMs) {
		return Math.max(remainMs, 1500);
	}

	function bindBubbleHover(bubble) {
		if (uiSay.hoverBound) return;
		uiSay.hoverBound = true;
		bubble.addEventListener('mouseenter', function () {
			if (!uiSay.visible || !uiSay.timer) return;
			clearTimeout(uiSay.timer);
			uiSay.timer = null;
			uiSay.remainMs = Math.max(0, uiSay.remainMs - (Date.now() - uiSay.shownAt));
		});
		bubble.addEventListener('mouseleave', function () {
			if (!uiSay.visible || uiSay.timer) return;
			armBubbleHide(bubble, bubbleResumeMs(uiSay.remainMs));
		});
	}

	/** Faint transient note above the whale (clear-all feedback #10): never
	 * a bubble, never unread, never a sound — auto-fades, then removes. */
	function showWhaleNote(text, ms) {
		var host = document.getElementById('dsh-whale');
		if (!host) return;
		var note = document.createElement('div');
		note.className = 'dsh-whale-note';
		note.textContent = text;
		host.appendChild(note);
		setTimeout(function () {
			note.classList.add('out');
			setTimeout(function () {
				if (note.parentNode) note.parentNode.removeChild(note);
			}, 400);
		}, ms || 3000);
	}
/* ---- module: src/ui/bootstrap.js ---- */
	function uiInit() {
		var whaleEl = document.getElementById('dsh-whale');
		if (!whaleEl) return;
		whale = whaleEl;
		/* 开机防双鲸（11-05 第三层，用户实报「一打开 DSH 就两只小金鱼，DSH
		 * 的闪一下才消失」）：非桌宠页**元素创建即隐藏**——不信任缓存 0
		 * （每次关 DSH 桌宠跟随死亡都会把缓存写成 0，冷开必踩 spawn 窗口
		 * =这不是罕见路径，是每次冷开的必经路径）。唤醒只走两条正路：
		 * ①权威状态（hello/轮询/pet/state 帧，force 破幂等）——宿主活着
		 * 时 <1s；②6s 兜底 reveal（仅「从未见过权威状态且内存态非休眠」
		 * ——宿主死/无桌宠宿主的降级场景）。缓存 1 的开机不踩兜底。 */
		if (!PET_MODE) {
			whaleEl.style.display = 'none';
			setTimeout(function () {
				if (!petStateEverSeen() && !petDormant) applyPetDormant(false, true);
			}, 6000);
		}
		uiReady = true;

		var bubble = document.createElement('div');
		bubble.className = 'dsh-whale-bubble';
		whale.appendChild(bubble);

		/** Mark the report currently shown in the bubble as READ: remove it
		 * from the unread queue (or resolve an in-flight replay), so the
		 * badge drops by one. Called after a double-click jump — the report
		 * the user just acted on must not still be waiting in the queue. */
		function markBubbleRead() {
			if (reading) {
				clearTimeout(readTimer);
				reading = null;
			} else if (lastShownReport) {
				var idx = reportQueue.indexOf(lastShownReport);
				if (idx >= 0) reportQueue.splice(idx, 1);
			}
			lastShownReport = null;
			renderUnread();
		}

		/* 通知已读联动（11-14 用户实报）：用户不点气泡/红标、直接在 DSH 里
		 * 打开对话看状态时，那条（些）未读要对应清掉——不然一段时间没看，
		 * 红标堆一串旧通知，点读回时顺序全乱。pin=「正在看」漏斗（本地 DOM
		 * 活动 + 跳转双信号），同会话去重（DOM 活动是高频信号，不能每次都
		 * 清/发）；清完红标照 renderUnread 重算。 */
		var lastViewedSid = null;
		/** Drop every unread of ONE session (queue entries + the in-flight
		 * click-replay + the bubble's read-back copy) — the session-wide
		 * counterpart of markBubbleRead, which only clears the single report
		 * the user acted on. Returns the number of queue entries removed
		 * (diagnostics/tests). */
		function clearUnreadBySession(matchSid) {
			var removed = 0;
			for (var qi = reportQueue.length - 1; qi >= 0; qi--) {
				if (reportQueue[qi].sessionId === matchSid) {
					reportQueue.splice(qi, 1);
					removed++;
				}
			}
			if (reading && reading.sessionId === matchSid) {
				clearTimeout(readTimer);
				reading = null;
			}
			/* 气泡推进（11-14 用户实报「红标消了，但气泡还挂着 B 的通知，
			 * 双击跳回的还是已读的 B」）：被清会话的内容正占着气泡时，气泡
			 * 必须跟进——切到最新一条**剩余未读**当预览（不算读：红标不动，
			 * 双击气泡跳的就是它，跳转即 markBubbleRead 正常消费）；没有
			 * 剩余未读就收气泡——不许停在已读内容的残影上。 */
			var bubbleHoldsIt = currentSaySession === matchSid;
			if (lastShownReport && lastShownReport.sessionId === matchSid) lastShownReport = null;
			renderUnread();
			if (bubbleHoldsIt) {
				var next = reportQueue.length ? reportQueue[reportQueue.length - 1] : null;
				if (next) {
					lastShownReport = next;
					currentSaySession = next.sessionId || null; /* 双击跳转认它 */
					uiSay(next.text, Math.min(next.duration || 5000, 3500), next.sessionId);
				} else {
					lastShownReport = null;
					currentSaySession = null;
					var bEl = document.querySelector('.dsh-whale-bubble');
					if (bEl) {
						if (uiSay.timer) { clearTimeout(uiSay.timer); uiSay.timer = null; }
						uiSay.visible = false;
						bEl.classList.remove('show');
					}
					hideStatusPanel(); /* 气泡收，配对面板 1:1 同收 */
				}
			}
			return removed;
		}

		/* 监听端逐个 try/catch 包裹=vm 桩兼容（armAudioUnlockRetry 先例）：
		 * 桩环境 window 事件注册表缺席也不许炸启动。 */
		try {
			window.addEventListener('dsh-whale:session-viewed', function (ev) {
				var sid = ev && ev.detail && ev.detail.sessionId;
				/* 桌宠合成会话守卫：isRealSessionId 只挡 FALLBACK 占位，而
				 * session-pet-sN 以 'session-' 开头会被放行——桌宠页一旦 pin
				 * 了合成会话，就会清掉自己的通知队列、还对宿主 POST 一轮
				 * dismiss 回环。session-viewed 的语义=「用户看了真实 DSH 对
				 * 话」，所以守卫放监听端（源头一处挡住两个受害者：队列清除
				 * + relay 回环；桌宠通知的清除只认宿主 pet/dismiss 帧）。 */
				if (!sid || /^session-pet-s\d+$/.test(sid) || sid === lastViewedSid) return;
				lastViewedSid = sid;
				clearUnreadBySession(sid);
				if (!PET_MODE && typeof fetch === 'function') {
					/* 桌宠中继：页鲸的队列清了，桌宠窗口的同款未读也要清——
					 * 宿主把真实会话反查成任务码再广播 pet/dismiss（fire-and-
					 * forget：桌宠不在线/未知会话宿主侧 delivered:false 无害）。 */
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'dismiss', sessionId: sid })
						}).catch(function () { /* 桌宠离线：静默 */ });
					} catch (eRelay) {}
				}
			});
		} catch (eL1) {}
		try {
			window.addEventListener('dsh-whale:pet-dismiss', function (ev) {
				var code = ev && ev.detail && ev.detail.code;
				if (typeof code !== 'number' || !(code > 0)) return;
				/* 宿主广播的任务码（detail.code=N）反查回该任务的合成会话，
				 * 清桌宠页自己的未读队列（与 session-viewed 同一条清理缝）。 */
				clearUnreadBySession(PET_SID_PREFIX + code);
			});
		} catch (eL2) {}

		/* 已读联动诊断缝（11-14）：真机「红标没消」先看这里——pin=本窗口
		 * 认定的正在看会话（session-key 漏斗）、lastViewedSid=去重游标、
		 * queue=当前未读队列的会话清单。三者对不上号即可定位是哪一环。 */
		window.__dshWhale._viewedState = function () {
			try {
				return {
					pin: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('dsh-whale:window-session') : null,
					lastViewedSid: lastViewedSid,
					queue: reportQueue.map(function (r) { return r.sessionId; })
				};
			} catch (eV) { return null; }
		};

		/** Jump to the conversation behind the CURRENT bubble (double-click
		 * on the bubble, or on a spot that overlaps it). Idle summaries
		 * carry no session and only get a hint. */
		function jumpToBubbleSession() {
			/* 桌宠（11-03 真跳转）：通知挂着枚举化合成会话（session-pet-sN），
			 * 桌宠页没有跳转桥也没有 DSH DOM——但宿主持有 编号→真实会话 的
			 * 反查表。POST /pet/ctrl jump 让宿主广播 pet/jump（页鲸用自己的
			 * 跳转桥执行切换），同时请桌宠宿主把 DSH 窗口拉到前台——用户在
			 * 桌宠上双击通知，落地就是「DSH 到眼前+停在目标对话」。 */
			if (PET_MODE) {
				var sid = currentSaySession || '';
				var m = sid.match(/^session-pet-s(\d+)$/);
				if (!m) {
					uiSay('这条消息没有对应的对话哦 🐳', 2000);
					return;
				}
				var code = parseInt(m[1], 10);
				/* 时间锚点（11-06，用户实报「跳的是对话不是任务节点」）：与页鲸
				 * 分支同源——当前通知报告的 endTime（这条报告所指的那次任务完
				 * 成时刻）。宿主原样回传 pet/jump，页鲸 openSessionAt(sid, atMs)
				 * 的翻页回溯把那条消息滚进视野。 */
				var repAt = reading || lastShownReport;
				var atMs = repAt && typeof repAt.endTime === 'number' ? repAt.endTime : undefined;
				uiSay('正在打开对话… 🐳', 1800);
				try {
					if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
						/* the pet shell raises the DSH window (jump 落点必须可见） */
						window.chrome.webview.postMessage({ c: 'jump' });
					}
				} catch (e) { /* non-pet shell: window switch is best-effort */ }
				fetch('/api/whale-assistant/pet/ctrl', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'jump', code: code, atMs: atMs })
				}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
					/* v2（11-12）：无论 delivered 都唤回窗口——delivered=true 也可能
					 * 只是「退出挂起的僵尸渲染层」在场（跳转在看不见的窗口里执行
					 * 了）。c:'revive' 由 ps1 分流：有窗=前台化；无窗=杀僵尸壳+重
					 * 拉，ledger pendingJump 在新页鲸接入时 hello 补投自动兑现。
					 * delivered=false 时通知保留未读（红标不掉）。 */
					try {
						if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
							window.chrome.webview.postMessage({ c: 'revive' });
						}
					} catch (e2) { }
					if (out && out.ok === true && out.delivered === false) {
						uiSay('DSH 窗口已关——正在重开并自动跳转，稍等 🐳', 3500);
					} else if (out && out.ok === true) {
						/* jumping counts as reading the report (same contract as
						 * the page whale): the badge drops and the notification
						 * leaves the queue */
						markBubbleRead();
					} else {
						uiSay('通知已过期，回 DSH 看看吧 🐳', 2500);
					}
				}).catch(function () { /* network hiccup: the revive already fired */ });
				return;
			}
			var sessionId = currentSaySession;
			if (!sessionId) {
				uiSay('这条消息没有对应的对话哦 🐳', 2000);
				return;
			}
			/* the report's endTime (the moment THIS report is about) lets the
			 * jump page back to that message — on a SAME-session jump (the
			 * alpha adapter only tracks the current conversation) open() alone
			 * would be a no-op with zero visible feedback */
			var rep = reading || lastShownReport;
			var atMs = rep && typeof rep.endTime === 'number' ? rep.endTime : undefined;
			/* 0.4.0: in-house jump (client-module bridge) with the sidebar as
			 * fallback tail — the bridge carries no title, so the sidebar
			 * tail looks the name up in the address book */
			var jumped = false;
			if (jumpReady()) {
				jumped = openSessionAt(sessionId, atMs);
				if (!jumped) {
					/* the bridge jumped but the session is gone: the report
					 * stays unread (same contract as the old hook) */
					uiSay('找不到对应的对话 🥲', 2000, sessionId);
					return;
				}
			} else if (openViaSidebarById(sessionId) || openViaSidebarByTitle(sessionTitles.get(sessionId) || bookTitle(sessionId) || '')) {
				jumped = true;
			}
			if (!jumped) {
				uiSay('跳转功能需要刷新页面（插件未加载）', 2500);
				return;
			}
			/* jumping to the conversation counts as reading the report:
			 * the badge drops by one and the notification leaves the
			 * queue (it must NOT still pop up from the red badge later) */
			markBubbleRead();
			/* keep the session attached to the bubble — the feedback
			 * must not clear currentSaySession or the NEXT double-click
			 * would lose the conversation */
			uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
		}

		/** Is viewport (x, y) inside the bubble's rendered rectangle?
		 * getBoundingClientRect when available, otherwise an estimate (the
		 * bubble floats above the whale, right-aligned with an 8px overhang).
		 * Used so a double-click whose second press drifts a few pixels off
		 * the bubble onto the whale still counts as a bubble double-click —
		 * the bubble must NEVER behave like the whale's own body. */
		function inBubbleRect(x, y) {
			var b = document.querySelector('.dsh-whale-bubble');
			if (!b) return false;
			var r = null;
			if (typeof b.getBoundingClientRect === 'function') {
				r = b.getBoundingClientRect();
			}
			if (r) {
				return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
			}
			var w = b.offsetWidth || 0;
			var h = b.offsetHeight || 0;
			var left = whale.offsetLeft + whale.offsetWidth - w + 8;
			var top = whale.offsetTop - h - 12;
			return x >= left && x <= left + w && y >= top && y <= top + h;
		}

		/** Double-click the notification bubble: jump to the conversation it
		 * belongs to (task reports and attention requests carry a session;
		 * idle summaries do not). Stops propagation so the whale's own
		 * double-click (swim home) never sees it. */
		bubble.addEventListener('dblclick', function (event) {
			event.stopPropagation();
			jumpToBubbleSession();
		});

		var badge = document.createElement('div');
		badge.className = 'dsh-whale-badge';
		whale.appendChild(badge);

		/* gear groups live inside the whale SVG (whale-logo.svg); the zzz
		 * nap indicator is a plain HTML element on top */
		var zzz = document.createElement('div');
		zzz.className = 'dsh-whale-zzz';
		zzz.textContent = '💤';
		whale.appendChild(zzz);

		var figure = whale.querySelector('svg');
		/* reveal any gear already unlocked from a previous visit */
		unlockCheck();

		onUnreadChange = function (count) {
			if (count > 0) {
				badge.textContent = count > UNREAD_CAP ? UNREAD_CAP + '+' : String(count);
				badge.style.display = 'block';
				/* pop animation on every count change */
				badge.classList.remove('pop');
				void badge.offsetWidth;
				badge.classList.add('pop');
			} else {
				badge.style.display = 'none';
			}
		};

		/* badge: single click reads one report, double-click clears everything */
		var badgeClickTimer = null;
		badge.addEventListener('pointerdown', function (event) {
			event.stopPropagation();
		});
		badge.addEventListener('pointerup', function (event) {
			event.stopPropagation();
			if (event.pointerType === 'mouse' && event.button !== 0) return; /* right-click = menu only, left reads */
			if (badgeClickTimer) {
				clearTimeout(badgeClickTimer);
				badgeClickTimer = null;
				return;
			}
			badgeClickTimer = setTimeout(function () {
				badgeClickTimer = null;
				if (!readNext()) uiSay(clickSummary());
			}, 260);
		});
		badge.addEventListener('dblclick', function (event) {
			event.stopPropagation();
			if (badgeClickTimer) {
				clearTimeout(badgeClickTimer);
				badgeClickTimer = null;
			}
			clearAllUnread();
		});

		/** Clear every unread report at once. */
		function clearAllUnread() {
			if (reportQueue.length === 0 && !reading) {
				wiggle();
				uiSay('没有未读通知哦 🐋', 2000);
				return;
			}
			var cleared = reportQueue.length + (reading ? 1 : 0);
			reportQueue.length = 0;
			if (typeof readTimer === 'number') clearTimeout(readTimer);
			reading = null;
			renderUnread();
			clearTimeout(uiSay.timer);
			var bub = document.querySelector('.dsh-whale-bubble');
			if (bub) bub.classList.remove('show');
			wiggle();
			/* faint count feedback (#10): the number answers "清了多少条" —
			 * no bubble, no bell, no unread, auto-fades */
			showWhaleNote('已清空 ' + cleared + ' 条通知', 3000);
		}

/* ---- module: src/ui/menu.js ---- */
		/* --- right-click: single click opens the menu, double right-click
		 * pets the whale (affection +1). --- */
		var ctxMenu = null;
		var ctxPanel = null;
		var lastCtxAt = 0;
		var CTX_DBL_MS = 400;
		var CTX_MENU_W = 180;

		function closeCtxMenu() {
			if (ctxMenu) ctxMenu.classList.remove('show');
		}
		function closeCtxPanel() {
			if (ctxPanel) ctxPanel.classList.remove('show');
		}
		function closeCtxFloats() {
			closeCtxMenu();
			closeCtxPanel();
			closeCtxHistory();
		}

		/* ---- 内联 SVG 图标集（P1 2026-10-28）----
		 * P0 用 20px 定宽槽解决了对齐，但 emoji 本体在各平台字形/配色仍不可控
		 * （Segoe UI Emoji vs Apple Color Emoji）。P1 把字形换成 16×16 stroke
		 * 风格的内联 SVG：stroke=currentColor 跟随面板文字色，跨平台一致。
		 * emoji 原文保留在 0 尺寸 ghost span 里——textContent 逐字节不变，
		 * 测试与读屏口径同 P0；未收录字形回落 P0 emoji 槽（新菜单项零成本）。 */
		var ICON_SVG_NS = 'http://www.w3.org/2000/svg';
		var ICON_PATHS = {
			'⏰': [['circle', { cx: 8, cy: 8.7, r: 5.1 }], ['path', { d: 'M8 6.3v2.6l1.9 1.1' }], ['path', { d: 'M2.8 3.2l1.8-1.2M13.2 3.2l-1.8-1.2' }]],
			'⏱️': [['circle', { cx: 8, cy: 9, r: 5 }], ['path', { d: 'M6.7 2.4h2.6M8 2.4v1.7M8 9l1.8-1.8' }]],
			'⏳': [['path', { d: 'M4.7 2.5h6.6M4.7 13.5h6.6M5.7 2.5v1.8c0 1.3 2.3 2.2 2.3 3.7s-2.3 2.4-2.3 3.7v1.8M10.3 2.5v1.8c0 1.3-2.3 2.2-2.3 3.7s2.3 2.4 2.3 3.7v1.8' }]],
			'➕': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M8 5.4v5.2M5.4 8h5.2' }]],
			'❌': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2' }]],
			'✅': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M5.3 8.3l1.9 1.9 3.5-4.3' }]],
			'❓': [['circle', { cx: 8, cy: 8, r: 5.7 }], ['path', { d: 'M6.3 6.4c.2-.9 1-1.5 1.8-1.5.9 0 1.6.6 1.6 1.5 0 1.1-1.6 1.3-1.6 2.4' }], ['circle', { cx: 8, cy: 11.1, r: 0.8, fill: 'currentColor' }]],
			'🔔': [['path', { d: 'M8 2.4c-2.5 0-4 1.9-4 4.1v2.7L2.8 11.6h10.4L12 9.2V6.5c0-2.2-1.5-4.1-4-4.1z' }], ['path', { d: 'M6.7 13.5a1.3 1.3 0 0 0 2.6 0' }]],
			'🔊': [['path', { d: 'M3.1 6.2h2.2L8.9 3.2v9.6L5.3 9.8H3.1z' }], ['path', { d: 'M11 5.9a3.2 3.2 0 0 1 0 4.2M13 3.9a6.1 6.1 0 0 1 0 8.2' }]],
			'🔇': [['path', { d: 'M3.1 6.2h2.2L8.9 3.2v9.6L5.3 9.8H3.1z' }], ['path', { d: 'M10.9 6.3l3.3 3.3M14.2 6.3l-3.3 3.3' }]],
			'📖': [['path', { d: 'M8 4.4C7.1 3.5 5.3 3.1 2.9 3.3v9.3c2.4-.2 4.2.2 5.1 1.1.9-.9 2.7-1.3 5.1-1.1V3.3C10.7 3.1 8.9 3.5 8 4.4z' }], ['path', { d: 'M8 4.4v9.3' }]],
			'🎨': [['path', { d: 'M8 2.7a5.3 5.3 0 1 0 0 10.6c.9 0 1.4-.5 1.2-1.2-.3-.9.3-1.6 1.3-1.6h1.1c1.2 0 1.9-.9 1.9-2.3A5.6 5.6 0 0 0 8 2.7z' }], ['circle', { cx: 5.6, cy: 6, r: 0.9, fill: 'currentColor' }], ['circle', { cx: 8.4, cy: 4.9, r: 0.9, fill: 'currentColor' }], ['circle', { cx: 10.9, cy: 7, r: 0.9, fill: 'currentColor' }]],
			'📜': [['rect', { x: 4.1, y: 2.7, width: 7.8, height: 10.6, rx: 1 }], ['path', { d: 'M6.3 5.7h3.4M6.3 8.1h3.4M6.3 10.5h2.3' }]],
			'⚙️': [['circle', { cx: 8, cy: 8, r: 4.2 }], ['circle', { cx: 8, cy: 8, r: 1.6 }], ['path', { d: 'M8 1.9v1.7M8 12.4v1.7M1.9 8h1.7M12.4 8h1.7M3.7 3.7l1.2 1.2M11.1 11.1l1.2 1.2M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2' }]],
			'🔄': [['path', { d: 'M13.2 8A5.2 5.2 0 1 1 11.6 4.2' }], ['path', { d: 'M13.5 1.8v2.6h-2.6' }]],
			'❤️': [['path', { d: 'M8 13.1S2.9 9.9 2.9 6.4c0-1.7 1.3-2.9 2.8-2.9 1 0 1.9.5 2.3 1.4.4-.9 1.3-1.4 2.3-1.4 1.5 0 2.8 1.2 2.8 2.9 0 3.5-5.1 6.7-5.1 6.7z', fill: 'currentColor' }]],
			'🌙': [['path', { d: 'M13 9.7A5.4 5.4 0 0 1 6.3 3a5.4 5.4 0 1 0 6.7 6.7z' }]],
			'🚨': [['path', { d: 'M8 3.1L2.7 12.4h10.6L8 3.1z' }], ['path', { d: 'M8 6.8v2.6' }], ['circle', { cx: 8, cy: 11.2, r: 0.8, fill: 'currentColor' }]],
			'📊': [['path', { d: 'M3.2 12.8h9.6M5.2 12.8V8.8M8 12.8V5.2M10.8 12.8V7.2' }]],
			'📤': [['path', { d: 'M3.1 9.4v3.2h9.8V9.4' }], ['path', { d: 'M8 2.8v6.3M5.9 7L8 9.1 10.1 7' }]],
			'🩺': [['path', { d: 'M2.2 8.3h2.9l1.5-3.9 2.7 6.9 1.5-3h3' }]],
			'🎵': [['path', { d: 'M6.3 11.9V4.3l5.1-1.1v7.5' }], ['circle', { cx: 4.8, cy: 11.9, r: 1.4, fill: 'currentColor' }], ['circle', { cx: 9.9, cy: 10.7, r: 1.4, fill: 'currentColor' }]],
			'☕': [['path', { d: 'M3.5 5.9h8v3.4a3.1 3.1 0 0 1-3.1 3.1H6.6a3.1 3.1 0 0 1-3.1-3.1z' }], ['path', { d: 'M11.5 6.7h.8a1.6 1.6 0 0 1 0 3.2h-.9' }]],
			'⛑️': [['path', { d: 'M3.6 10.3a4.4 4.4 0 0 1 8.8 0' }], ['path', { d: 'M2.4 10.3h11.2M8 5.9v4.4' }]]
		};
		/** Build the inline SVG for one icon spec: stroke defaults come from
		 * here so specs carry geometry only (fill:'currentColor' opts in). */
		function buildIconSvg(spec) {
			var svg = document.createElementNS(ICON_SVG_NS, 'svg');
			svg.setAttribute('viewBox', '0 0 16 16');
			svg.setAttribute('class', 'dsh-whale-ico-svg');
			svg.setAttribute('aria-hidden', 'true');
			for (var i = 0; i < spec.length; i++) {
				var node = document.createElementNS(ICON_SVG_NS, spec[i][0]);
				var attrs = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
				var over = spec[i][1];
				for (var k in over) attrs[k] = over[k];
				for (var k2 in attrs) node.setAttribute(k2, attrs[k2]);
				svg.appendChild(node);
			}
			return svg;
		}

		/** Leading-icon wrapper (P0 UI polish 2026-10-27 / P1 SVG 2026-10-28):
		 * emoji glyph width AND look vary by platform (Segoe UI Emoji vs Apple
		 * Color Emoji), so the leading glyph is rendered as a 16×16 stroke SVG
		 * inside the fixed 20px slot (.dsh-whale-ico) — all labels on one
		 * straight left edge, identical glyphs everywhere. The emoji text
		 * itself survives in a 0-size ghost span: textContent stays
		 * byte-identical (tests and screen readers see no change). Glyphs not
		 * in the icon table fall back to the P0 emoji slot. */
		function setIconLabel(el, text) {
			var sp = text.indexOf(' ');
			var glyph = sp >= 1 && sp <= 4 ? text.slice(0, sp) : '';
			var spec = glyph ? ICON_PATHS[glyph] : null;
			el.textContent = '';
			if (spec) {
				var ic = document.createElement('span');
				ic.className = 'dsh-whale-ico';
				ic.appendChild(buildIconSvg(spec));
				var ghost = document.createElement('span');
				ghost.className = 'dsh-whale-ico-ghost';
				ghost.textContent = glyph;
				ic.appendChild(ghost);
				el.appendChild(ic);
				el.appendChild(document.createTextNode(text.slice(sp)));
				return;
			}
			if (!glyph) { el.textContent = text; return; }
			var ic0 = document.createElement('span');
			ic0.className = 'dsh-whale-ico';
			ic0.textContent = glyph;
			el.appendChild(ic0);
			el.appendChild(document.createTextNode(text.slice(sp)));
		}

		/** Sub-panel footer. Back follows the navigation hierarchy
		 * 菜单 → 设置 → 子面板 (user request): panels entered from the
		 * right-click menu (提醒我) return TO THE MENU; panels entered from
		 * settings (音色/周报/运行状态) return to settings. */
		function mkPanelFoot(panel, onClose, backToMenu) {
			var foot = document.createElement('div');
			foot.className = 'dsh-whale-panel-foot';
			var backBtn = document.createElement('div');
			backBtn.className = 'dsh-whale-wardrobe-close dsh-whale-panel-back';
			if (backToMenu) {
				backBtn.textContent = '← 返回菜单';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxPanel();
					openCtxMenu(whale.offsetLeft + 6, Math.max(8, whale.offsetTop - 12));
				});
			} else {
				/* 设置抽屉退役（11-08 侧边栏页）：falsy 返回键=单纯收起浮层
				 * （音色/周报/运行状态现在从侧边栏页打开，收起即回到页面）；
				 * 两个浮层家族都关（ctxPanel=音色选择器 / ctxHistory=周报） */
				backBtn.textContent = '← 返回';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxPanel();
					closeCtxHistory();
				});
			}
			foot.appendChild(backBtn);
			var closeBtn = document.createElement('div');
			closeBtn.className = 'dsh-whale-wardrobe-close';
			closeBtn.textContent = '✕ 关闭';
			closeBtn.addEventListener('click', function (event) {
				event.stopPropagation();
				if (onClose) onClose();
				else closeCtxPanel();
			});
			foot.appendChild(closeBtn);
			panel.appendChild(foot);
		}

		/** Hearts float up from the whale's head (pet reaction, milestone
		 * celebration, idle affection — count defaults to the full burst). */
		function spawnHearts(count) {
			var layer = ensureRippleLayer();
			if (!layer) return;
			var x = whale.offsetLeft + whale.offsetWidth / 2;
			var y = whale.offsetTop + whale.offsetHeight * 0.3;
			var parts = [];
			var i;
			var total = count || 7;
			for (i = 0; i < total; i++) {
				var h = document.createElement('div');
				h.className = 'dsh-whale-heart';
				/* U+2764 + U+FE0E: force the TEXT variant so the CSS color
				 * (pink) applies — without the variation selector most
				 * platforms render the emoji face and ignore the color */
				h.textContent = '\u2764\uFE0E';
				h.style.left = x + 'px';
				h.style.top = y + 'px';
				layer.appendChild(h);
				parts.push({ el: h, delay: i * 60, dx: Math.random() * 70 - 35, up: -(26 + Math.random() * 22) });
			}
			var epoch = null;
			var total = 900;
			function heartsTick(now) {
				if (epoch === null) epoch = now;
				var t = now - epoch;
				var alive = false;
				for (var p = 0; p < parts.length; p++) {
					var part = parts[p];
					var local = t - part.delay;
					if (local < 0) continue;
					var u = local / total;
					if (u >= 1) {
						part.el.style.opacity = '0';
						continue;
					}
					alive = true;
					var ease = 1 - Math.pow(1 - u, 2);
					part.el.style.opacity = String(Math.max(0, 1 - u));
					part.el.style.transform = 'translate(' + (part.dx * ease).toFixed(1) + 'px,' +
						(part.up * Math.sin(Math.PI * Math.min(1, u))).toFixed(1) + 'px)';
				}
				if (alive) {
					requestAnimationFrame(heartsTick);
				} else {
					for (var q = 0; q < parts.length; q++) {
						if (parts[q].el.parentNode) parts[q].el.parentNode.removeChild(parts[q].el);
					}
				}
			}
			requestAnimationFrame(heartsTick);
		}

		/** Right-click double: pet the whale — reaction line + hearts + a
		 * happy bounce, and +1 affection (long-term progression). */
		function petWhale() {
			closeCtxFloats();
			touchActivity(); /* an explicit interaction wakes the whale */
			affection++;
			saveAffection();
			uiSay(petLine(), 3200);
			whale.classList.remove('dsh-whale-pet');
			void whale.offsetWidth;
			whale.classList.add('dsh-whale-pet');
			setTimeout(function () {
				whale.classList.remove('dsh-whale-pet');
			}, 720);
			spawnHearts();
			maybeCelebrateMilestone();
		}

		/** Affection milestones (#12'): crossing 10/50/100 fires a ONE-TIME
		 * bigger heart burst + a dedicated line. Remembered across reloads
		 * via localStorage; the celebration waits ~1.2s so it never tramples
		 * the pet reaction line (achievement-line lesson). */
		var AFF_MILESTONES = [
			{ at: 10, line: '好感度 10！我们熟起来了 🐳💙' },
			{ at: 50, line: '好感度 50！已经是最好的同事了吧 🥰' },
			{ at: 100, line: '好感度 100！这辈子就跟着你混了 🐋❤️✨' }
		];

		function maybeCelebrateMilestone() {
			var done = {};
			try {
				(localStorage.getItem('dsh-whale:affMs') || '').split(',').forEach(function (k) { if (k) done[k] = 1; });
			} catch (e) {}
			for (var i = 0; i < AFF_MILESTONES.length; i++) {
				var m = AFF_MILESTONES[i];
				var key = String(m.at);
				if (affection < m.at || done[key]) continue;
				done[key] = 1;
				try {
					localStorage.setItem('dsh-whale:affMs', Object.keys(done).join(','));
				} catch (e) {}
				setTimeout(function (mm) {
					return function () {
						uiSay(mm.line, 4200);
						spawnHearts(12);
					};
				}(m), 1200);
				return;
			}
		}

		/** Refresh + show the context menu near (clientX, clientY), flipping
		 * at the viewport edges. Content is rebuilt on every open so the
		 * sound label and mood header are always current. */
		function openCtxMenu(clientX, clientY) {
			closeCtxPanel();
			closeCtxHistory();
			var menu = ctxMenu || document.createElement('div');
			menu.className = 'dsh-whale-menu';
			menu.textContent = '';
			/* header: mood + live jobs */
			var head = document.createElement('div');
			head.className = 'dsh-whale-menu-head';
			var liveN = liveJobs().length;
			var moodName = MOOD_STAGES[moodStageIndex()].name;
			head.textContent = '🐳 ' + moodName + (liveN > 0 ? ' · ' + liveN + ' 个任务进行中' : ' · 待命中');
			menu.appendChild(head);
			/* reminder — 快捷操作 group first (#4) */
			var remindItem = document.createElement('div');
			remindItem.className = 'dsh-whale-menu-item';
			var pendingReminders = 0;
			try { pendingReminders = JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]').length; } catch (e) {}
			setIconLabel(remindItem, '⏰ 提醒我' + (pendingReminders > 0 ? '（' + pendingReminders + ' 个待响）' : ''));
			remindItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openReminders();
			});
			menu.appendChild(remindItem);
			/* sound toggle */
			var soundItem = document.createElement('div');
			soundItem.className = 'dsh-whale-menu-item';
			setIconLabel(soundItem, soundMuted ? '🔇 声音：关' : '🔊 声音：开');
			soundItem.addEventListener('click', function (event) {
				event.stopPropagation();
				setSoundMuted(!soundMuted);
				uiSay(soundMuted ? '已静音 🔇' : '声音已开启 🔊', 1800);
				closeCtxMenu();
			});
			menu.appendChild(soundItem);
			/* group separator (#4): 快捷操作 above, 信息与设置 below */
			var menuSep = document.createElement('div');
			menuSep.className = 'dsh-whale-menu-sep';
			menu.appendChild(menuSep);
			/* help */
			/* wardrobe */
			var dressItem = document.createElement('div');
			dressItem.className = 'dsh-whale-menu-item';
			setIconLabel(dressItem, '🎨 我的装扮');
			dressItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openWardrobe();
			});
			menu.appendChild(dressItem);
			/* history */
			var historyItem = document.createElement('div');
			historyItem.className = 'dsh-whale-menu-item';
			setIconLabel(historyItem, '📜 历史任务');
			historyItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHistory();
			});
			menu.appendChild(historyItem);
			/* ⚙️ 设置（11-11 真机修复轮，用户要求恢复）：跳转 DSH 侧边栏
			 * 「小鲸鱼助手」页——layout.selectPanel 桥（client.js inject
			 * stash），桥缺席（0.1.x web 老引擎/桌宠页无 layout 服务）时
			 * uiSay 指路兜底。注意：11-08 收口删项时这里的旧注释声称「桌宠
			 * 共享同一份配置」是**错误假设**（桌宠 WebView2 独立分区，页面
			 * 设置根本到不了桌宠——正是用户实报的音色不生效根因），已由设置
			 * relay（/pet/config → state 轮询）纠正。 */
			var settingsItem = document.createElement('div');
			settingsItem.className = 'dsh-whale-menu-item';
			setIconLabel(settingsItem, '⚙️ 设置');
			settingsItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				if (PET_MODE) {
					/* 桌宠页没有 layout 桥也没有 DSH DOM——走宿主广播（与「刷新
					 * DSH 页面」同通道）：POST open-settings → pet/open-settings
					 * 帧 → 页鲸 selectPanel 打开侧边栏设置页；delivered 后再用
					 * c:'jump' 让 ps1 把 DSH 拉前台（ps1 该分支只做前台化，无
					 * 会话语义，11-03 机制复用）。页鲸不在场（DSH 关着）=
					 * delivered:false → 提示，不假装成功。 */
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'open-settings' })
						}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
							/* v2（11-12）：无论 delivered 都唤回窗口——delivered=true
							 * 也可能只是退出挂起的僵尸渲染层在场；c:'revive' 由 ps1
							 * 分流（有窗=前台化，无窗=杀僵尸壳+重拉，pendingSettings
							 * 在新页鲸接入时 hello 补投自动打开设置页） */
							try {
								if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
									window.chrome.webview.postMessage({ c: 'revive' });
								}
							} catch (e2) { }
							if (out && out.ok === true && out.delivered === false) {
								uiSay('DSH 窗口已关——正在重开并进入设置页，稍等 🐳', 3500);
							} else if (out && out.ok === true) {
								uiSay('已打开小鲸鱼助手设置 ✓', 1800);
							} else {
								uiSay('跳转指令没有送达，稍后再试 🥲', 2500);
							}
						}).catch(function () { uiSay('跳转指令没有送达，稍后再试 🥲', 2500); });
					} catch (e) { uiSay('设置住在 DSH 侧边栏的「小鲸鱼助手」页面里', 2600); }
					return;
				}
				/* 页鲸：layout 桥直达（client.js inject stash）；桥缺席=0.1.x
				 * web 老引擎 → 气泡指路兜底 */
				var jumped = false;
				try {
					if (typeof window.__dshWhaleSelectPanel === 'function') {
						window.__dshWhaleSelectPanel('whale-assistant');
						jumped = true;
					}
				} catch (e) { jumped = false; }
				if (!jumped) uiSay('设置住在 DSH 侧边栏的「小鲸鱼助手」页面里', 2600);
			});
			menu.appendChild(settingsItem);
			/* refresh (B-2 desktop): the official desktop binds NO F5/Ctrl+R —
			 * plugin updates and recovery both need a page reload, and the
			 * whale menu is the reachable way to get one.
			 * 11-07 语义拆分（用户实报「桌宠的刷新页面失效」）：页鲸菜单的刷新
			 * =刷 DSH 页（location.reload，本页就是 DSH 页 ✓）；桌宠菜单的刷新
			 * 旧实现刷的是**桌宠自己的页面**（桌宠鲸闪一下重载，DSH 页原封不动
			 * =用户眼中的「失效」）。现桌宠分支改走宿主广播：POST /pet/ctrl
			 * reload-page → pet/reload-page 帧 → 页鲸执行真正的 reload；页鲸
			 * 不在场（DSH 窗口关着）时宿主回 delivered=false，桌宠提示而不是
			 * 假装刷新成功。 */
			var refreshItem = document.createElement('div');
			refreshItem.className = 'dsh-whale-menu-item';
			setIconLabel(refreshItem, PET_MODE ? '🔄 刷新 DSH 页面' : '🔄 刷新页面');
			refreshItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				if (PET_MODE) {
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'reload-page' })
						}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
							if (out && out.ok === true && out.delivered === false) {
								uiSay('DSH 窗口已关闭——打开 DSH 后页面会自动加载新版 🐳', 3500);
							} else if (out && out.ok === true) {
								uiSay('已让 DSH 页面刷新 🐳', 2000);
							} else {
								uiSay('刷新指令没有送达，稍后再试 🥲', 2500);
							}
						}).catch(function () { uiSay('刷新指令没有送达，稍后再试 🥲', 2500); });
					} catch (e) { uiSay('刷新失败，稍后再试 🥲', 2500); }
					return;
				}
				setTimeout(function () { location.reload(); }, 80);
			});
			menu.appendChild(refreshItem);
			/* 桌宠常驻（第九轮用户定稿）：页面侧不再有「桌宠模式」开关——小鲸鱼
			 * 默认活动范围=整个桌面，开机即常驻（不支持平台由页内鲸鱼兜底）。
			 * 桌宠窗口里由 __dshPetHost 缝追加三态形态组 */
			/* pet seam: the screen-pet window injects 形态组 (完整/气泡/隐藏)
			 * into every rebuilt menu via __dshPetHost — a no-op everywhere else */
			try {
				if (window.__dshPetHost && typeof window.__dshPetHost.appendMenuItems === 'function') {
					window.__dshPetHost.appendMenuItems(menu);
				}
			} catch (e) { }
			if (!ctxMenu) document.body.appendChild(menu);
			ctxMenu = menu;
			/* position near the cursor, flipping at the viewport edges — the
			 * menu's REAL height is measured (the old fixed 170px guess grew
			 * to ~240px with 7 items and clipped the bottom rows off-screen:
			 * 设置 was literally unreachable when the whale sat low) */
			var mw = CTX_MENU_W;
			var mh = menu.offsetHeight || 170;
			var left = clientX;
			var top = clientY;
			if (left + mw > window.innerWidth - 8) left = clientX - mw;
			if (top + mh > window.innerHeight - 8) top = clientY - mh;
			/* 11-05 用户实报「右键菜单会挡住小鲸鱼」：菜单锚在光标上，而右键的
			 * 光标就在鲸鱼身上——视口翻转后整块压在鲸鱼上（真机截图：菜单
			 * 右下角=光标=鲸鱼身）。翻转后与鲸鱼布局盒求交，相交就从
			 * 右/左/上/下四个候选位挑第一个**完整入屏且零重叠**的（各留
			 * 10px 缝）；全放不下取夹紧后重叠最小的。布局盒 offset* 免疫
			 * bob 动画 transform（同 clampBubble 原理）。 */
			if (whale && whale.offsetWidth > 0) {
				var wx = whale.offsetLeft, wy = whale.offsetTop;
				var ww = whale.offsetWidth, wh = whale.offsetHeight;
				function menuHitsWhale(ml, mt) {
					return ml < wx + ww && ml + mw > wx && mt < wy + wh && mt + mh > wy;
				}
				if (menuHitsWhale(left, top)) {
					var GAP = 10, MARG = 8;
					var cands = [
						{ l: wx + ww + GAP, t: top },
						{ l: wx - mw - GAP, t: top },
						{ l: left, t: wy - mh - GAP },
						{ l: left, t: wy + wh + GAP }
					];
					var bestL = left, bestT = top, bestOv = Infinity;
					for (var ci = 0; ci < cands.length; ci++) {
						var cl = Math.min(Math.max(cands[ci].l, MARG), window.innerWidth - mw - MARG);
						var ct = Math.min(Math.max(cands[ci].t, MARG), window.innerHeight - mh - MARG);
						if (!menuHitsWhale(cl, ct)) { bestL = cl; bestT = ct; bestOv = 0; break; }
						var ox = Math.max(0, Math.min(cl + mw, wx + ww) - Math.max(cl, wx));
						var oy = Math.max(0, Math.min(ct + mh, wy + wh) - Math.max(ct, wy));
						if (ox * oy < bestOv) { bestOv = ox * oy; bestL = cl; bestT = ct; }
					}
					left = bestL;
					top = bestT;
				}
			}
			menu.style.left = Math.max(8, left) + 'px';
			menu.style.top = Math.max(8, top) + 'px';
			menu.classList.remove('show');
			void menu.offsetWidth;
			menu.classList.add('show');
		}

		/** Clamp a floating panel near the whale (never off-screen) and show it.
		 * The panel is MEASURED while still invisible (opacity:0 keeps layout)
		 * — fixed size guesses broke as soon as a panel grew (the sound picker
		 * is ~2× the old estimate), pushing its rows off-screen: user-reported
		 * "设置显示不全/点了没反应". Below the whale first; flips above when
		 * there is no room; CSS caps height at the viewport and the panel
		 * scrolls internally. */
		function showFloatingPanel(panel, pw, ph) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || ph;
			var left = Math.round(whale.offsetLeft + whale.offsetWidth / 2 - w / 2);
			var top = whale.offsetTop + whale.offsetHeight + 10; /* prefer below */
			if (top + h > window.innerHeight - 8) top = whale.offsetTop - h - 10; /* flip above */
			if (top < 8) top = Math.max(8, whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			/* hard clamp: even a max-height-tall panel centered on a
			 * mid-screen whale must stay inside the viewport (bottom first,
			 * then top) — the panel scrolls internally beyond this */
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			if (left < 8) left = 8;
			panel.style.left = left + 'px';
			panel.style.top = Math.max(8, top) + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wide drawers (history/weekly report): anchored LEFT of the whale,
		 * flipping to its right when the wall is closer — same measured,
		 * viewport-clamped placement as showFloatingPanel. */
		function showSidePanel(panel, pw) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || Math.min(window.innerHeight - 16, 460);
			var left = whale.offsetLeft - w - 12;
			if (left < 8) left = whale.offsetLeft + whale.offsetWidth + 12;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			var top = Math.round(whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			panel.style.left = Math.max(8, left) + 'px';
			panel.style.top = top + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wardrobe panel: gear progress + affection (dark, same language as
		 * the menu; opens near the whale, clamped to the viewport). */
		function openWardrobe() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-wardrobe';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎨 我的装扮';
			panel.appendChild(title);
			var i;
			for (i = 0; i < GEAR_DEFS.length; i++) {
				var def = GEAR_DEFS[i];
				var row = document.createElement('div');
				row.className = 'dsh-whale-wardrobe-row';
				var unlocked = unlockedGear.has(def.id);
				var leftTxt = document.createElement('span');
				setIconLabel(leftTxt, def.emoji + ' ' + def.name);
				var rightTxt = document.createElement('span');
				if (unlocked) {
					rightTxt.textContent = '✅ 已解锁';
				} else {
					var need = Math.max(0, def.at - gearStats.tasksDone);
					rightTxt.textContent = '还差 ' + need + ' 个任务';
					row.classList.add('dsh-whale-wardrobe-locked');
				}
				row.appendChild(leftTxt);
				row.appendChild(rightTxt);
				panel.appendChild(row);
			}
			var affRow = document.createElement('div');
			affRow.className = 'dsh-whale-wardrobe-row dsh-whale-wardrobe-aff';
			var affL = document.createElement('span');
			setIconLabel(affL, '❤️ 好感度');
			var affR = document.createElement('span');
			affR.textContent = '× ' + affection;
			affRow.appendChild(affL);
			affRow.appendChild(affR);
			panel.appendChild(affRow);
			mkPanelFoot(panel, null, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 210, 200);
		}

		/* 11-11 菜单收口：使用说明/音色/设置三块已迁至侧边栏页
		 * src/ui/panel-page.js（音色随设置页行内化），对应函数已删除；
		 * 历史抽屉群早已拆至 ui/drawers.js（2026-10-27 K3）。 */

		/** 🩺 Health detail panel (core/health.js detects, THIS side renders:
		 * the panel slots live in uiInit's closure so the health module —
		 * an IIFE-scope inline module — delegates here). */
		function openHealthPanel() {
			closeCtxPanel();
			closeCtxHistory();
			var health = window.__dshWhale && window.__dshWhale._health;
			var rep = (health && health.state().lastReport) || (health && health.run()) || { server: 'ok', dom: 'ok', jump: 'warn' };
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🩺 运行状态';
			panel.appendChild(title);
			var rows = [
				['后台通知通道', rep.server === 'fail' ? '❌ 失效（收不到后台/失败通知）' : '✅ 正常'],
				['用量读取', rep.dom === 'fail' ? '❌ 异常（tokens 面板可能为空）' : '✅ 正常'],
				/* 桌宠页的跳转走宿主通道（与通知 feed 同路由同 token），健康
				 * 判据不同——别把页鲸的「侧栏兜底」文案搬到桌宠上误导用户
				 * （11-03 实机：桌宠跳转修好了，面板还在报「不可用」） */
				['气泡跳转', PET_MODE
					? (rep.jump === 'ok' ? '✅ 可用（双击通知直达）' : '⚠️ 不可用（宿主通道异常）')
					: (rep.jump === 'ok' ? '✅ 可用' : '⚠️ 不可用（走侧栏兜底）')]
			];
			for (var i = 0; i < rows.length; i++) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = rows[i][0];
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = rows[i][1];
				row.appendChild(l);
				row.appendChild(v);
				panel.appendChild(row);
			}
			var hint = document.createElement('div');
			hint.className = 'dsh-whale-settings-section';
			hint.textContent = '多数失效是页面过期：右键菜单 🔄 刷新页面（或浏览器 Ctrl+F5）即可恢复；仍失效请看控制台 [🐋] 日志';
			panel.appendChild(hint);
			/* footer via shared helper: ← 返回设置 / ✕ 关闭 */
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 260, 190);
		}

		whale.addEventListener('contextmenu', function (event) {
			event.preventDefault();
			event.stopPropagation();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				/* double right-click: pet the whale */
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			openCtxMenu(event.clientX, event.clientY);
		});

		/* clicking anywhere else closes the floats (right button excluded —
		 * it is handled by the contextmenu path above). The history drawer is
		 * exempt too: its rows act on the CLICK event, and hiding the panel on
		 * pointerdown detaches them before that click ever arrives. */
		document.addEventListener('pointerdown', function (event) {
			if (event.button === 2) return;
			var t = event.target;
			if (ctxMenu && ctxMenu.contains(t)) return;
			if (ctxPanel && ctxPanel.contains(t)) return;
			if (ctxHistory && ctxHistory.contains(t)) return;
			closeCtxFloats();
		});

		/* right-click outside the whale: close the floats; a double
		 * right-click anywhere in the window still pets the whale */
		document.addEventListener('contextmenu', function (event) {
			var floatsOpen = (ctxMenu && ctxMenu.classList.contains('show')) ||
				(ctxPanel && ctxPanel.classList.contains('show')) ||
				(ctxHistory && ctxHistory.classList.contains('show'));
			if (!floatsOpen) return; /* outside the whale: browser menu as usual */
			event.preventDefault();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			closeCtxFloats();
		});

		function applyPos(x, y) {
			var width = whale.offsetWidth;
			var height = whale.offsetHeight;
			x = Math.max(0, Math.min(x, window.innerWidth - width));
			y = Math.max(0, Math.min(y, window.innerHeight - height));
			whale.style.left = x + 'px';
			whale.style.top = y + 'px';
			whale.style.right = 'auto';
			whale.style.bottom = 'auto';
		}

		function savePos() {
			/* v2 ANCHOR store: keep the whale anchored to the RIGHT-BOTTOM
			 * corner as pixel offsets, so a window resize re-seats it at the
			 * same corner offset instead of stranding it at a stale absolute
			 * x/y (user report 09-14: fullscreen -> windowed left the whale
			 * off-screen). x/y kept for downgrade readability. */
			var rx = Math.round(window.innerWidth - whale.offsetLeft - whale.offsetWidth);
			var by = Math.round(window.innerHeight - whale.offsetTop - whale.offsetHeight);
			safeSet(POS_KEY, {
				v: 2,
				rx: rx,
				by: by,
				x: whale.offsetLeft,
				y: whale.offsetTop
			});
		}

		/* v2 anchor re-seat with symmetric clamp: offsets are kept verbatim
		 * while they fit the current viewport; when the window shrank past
		 * the stored offset the whale clamps to the nearest edge instead of
		 * stranding off-screen (and the original offset survives for when
		 * the window grows back). */
		function seatFromAnchor(rx, by) {
			rx = Math.max(0, Math.min(rx, window.innerWidth - whale.offsetWidth));
			by = Math.max(0, Math.min(by, window.innerHeight - whale.offsetHeight));
			applyPos(
				window.innerWidth - whale.offsetWidth - rx,
				window.innerHeight - whale.offsetHeight - by
			);
		}

		function anchorFromStorage() {
			return safeGet(POS_KEY, function (v0) {
				return (v0 && typeof v0 === 'object' && typeof v0.x === 'number' && typeof v0.y === 'number') ? v0 : null;
			});
		}

		function loadPos() {
			var pos = anchorFromStorage();
			if (pos && typeof pos.rx === 'number' && typeof pos.by === 'number') {
				seatFromAnchor(pos.rx, pos.by);
				return true;
			}
			if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y);
				return true;
			}
			return false;
		}

		/* window resize: keep the whale in view. v2 anchors re-seat from the
		 * right-bottom offsets (corner semantics survive any window shape —
		 * user report 09-14: fullscreen -> windowed left the whale stranded
		 * at a stale absolute x/y); v1/legacy absolute positions are clamped
		 * back into the viewport. No stored pos = CSS right/bottom default,
		 * which already tracks the window by itself. */
		window.addEventListener('resize', function () {
			var pos = anchorFromStorage();
			if (!pos) return;
			if (typeof pos.rx === 'number' && typeof pos.by === 'number') {
				seatFromAnchor(pos.rx, pos.by);
			} else if (typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y); /* clamp happens inside applyPos */
			}
			updateStatusPos();
		});

		var wiggleTimer = null;

		function wiggle() {
			whale.classList.remove('dsh-whale-wiggle');
			void whale.offsetWidth; /* restart the animation */
			whale.classList.add('dsh-whale-wiggle');
			/* the one-shot wiggle must be dropped after it finishes,
			 * otherwise the finished animation keeps overriding the idle
			 * bob (dsh-whale-bob) and the whale freezes until reload. */
			if (wiggleTimer) clearTimeout(wiggleTimer);
			wiggleTimer = setTimeout(function () {
				wiggleTimer = null;
				whale.classList.remove('dsh-whale-wiggle');
				void whale.offsetWidth; /* let the bob restart cleanly */
			}, 500);
		}

		function liveJobs() {
			var out = [];
			known.forEach(function (view) {
				if (view.status === 'running' || view.status === 'stopping') out.push(view);
			});
			return out;
		}

		/** The click summary stays pure interaction: task status or an idle
		 * line. Token/pressure lives in the status panel on task completion. */
		function clickSummary() {
			if (asleep) return '呼… Zzz 💤';
			var live = liveJobs();
			var summary;
			if (live.length > 0) {
				var names = live.slice(0, 3)
					.map(function (view) { return '「' + truncate(taskTitle(view), live.length > 1 ? 22 : 30) + '」'; })
					.join('、');
				summary = live.length + ' 个子任务进行中：' + names + (live.length > 3 ? ' 等' : '') + ' ' + pickTail('busy');
				if (moodStageIndex() >= 3 && Math.random() < 0.4) {
					summary += ' ……还在跑，我盯着呢 🫠';
				}
			} else {
				summary = pickIdleLine();
			}
			/* recent failure: give a gentle recall hint (window from config) */
			var failAt = recentFailAt();
			if (failAt !== null && (Date.now() - failAt) < CONFIG.recentFailWindowMs) {
				summary += '\n上次任务失败了哦，双击红色通知回去看看 🥲';
			}
			return summary;
		}

/* ---- module: src/ui/drawers.js ---- */
/* ---- ui/drawers.js —— 历史抽屉群（architecture.md §7，2026-10-27 从 menu.js 拆出） ----
 * 内容仍拼接在 uiInit 闭包体内（bootstrap.js 开、drag.js 合），本文件全部
 * var/function 声明与 menu.js 共享同一函数作用域，跨文件引用靠提升，无 import。
 * 成员：历史抽屉基建（ctxHistory/historyIcon/indexOfCI/setHighlightText/
 *       fillHistoryList/historySearch）+ 提醒（loadReminders/saveReminders/
 *       openReminders/20s 触发环）+ 周报 openReport + 导出 exportHistory +
 *       历史抽屉 openHistory/closeCtxHistory。 */
		/** History drawer: recent finished tasks (newest first), each row can
		 * jump back to its conversation via the session-opening hook. Uses a
		 * separate panel slot so it can be wider and left-anchored. */
		var ctxHistory = null;
		/** 11-05 用户实报「历史任务不能实时同步」：数据链（页面记账→共享账本
		 * →桌宠 /pet/history 枚举路由）实测秒级通畅，真正的缺口=**打开着的
		 * 抽屉是静态快照**——任务完成不重开就看不见。开着期间 5s re-pull+
		 * 重渲染（关抽屉即停；每次 open 重置，绝不叠加）。 */
		var ctxHistoryLiveTimer = null;
		/** icon glyph for a history record kind */
		function historyIcon(kind) {
			if (kind === 'done') return { text: '✓', cls: 'dsh-whale-history-icon-done' };
			if (kind === 'fail') return { text: '✗', cls: 'dsh-whale-history-icon-fail' };
			if (kind === 'approval') return { text: '?', cls: 'dsh-whale-history-icon-approval' };
			if (kind === 'question') return { text: '?', cls: 'dsh-whale-history-icon-question' };
			if (kind === 'killed') return { text: '⏹', cls: 'dsh-whale-history-icon-killed' }; /* blue: user-stopped, not a truncation */
			return { text: '⏹', cls: 'dsh-whale-history-icon-cut' };
		}
		/** Case-insensitive indexOf（用户反馈）: 搜 step 必须命中 Step/STEP。 */
		function indexOfCI(hay, needle) {
			var n = (needle || '').toLowerCase();
			if (!n) return -1;
			return (hay || '').toLowerCase().indexOf(n);
		}
		/** Render `text` into `el` with the first `q` occurrence highlighted
		 * (#7), windowed around the match so long titles stay compact. The
		 * match is case-insensitive but the marked text keeps its ORIGINAL
		 * casing (copied from `text`, not from `q`). */
		function setHighlightText(el, text, q) {
			var idx = indexOfCI(text, q);
			if (idx < 0) { el.textContent = truncate(text, 16); return; }
			var start = Math.max(0, idx - 4);
			var end = Math.max(start + 24, idx + q.length + 8);
			var frag = (start > 0 ? '…' : '') + text.slice(start, end);
			var rel = idx - start;
			el.textContent = '';
			el.appendChild(document.createTextNode(frag.slice(0, rel)));
			var hit = document.createElement('mark');
			hit.textContent = frag.substr(rel, q.length);
			el.appendChild(hit);
			el.appendChild(document.createTextNode(frag.slice(rel + q.length)));
		}

		/* search result count line (#7) — created by openHistory, updated here */
		var historyCountEl = null;

		/** (Re)fill the history list element from the current `history`.
		 * Called by openHistory AND after each cloud pull — the server merge
		 * can bring records saved by other windows while the drawer is open. */
		function fillHistoryList(list) {
			list.textContent = '';
			if (history.length === 0) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '还没有任务记录哦 🐳';
				list.appendChild(empty);
				if (historyCountEl) historyCountEl.textContent = '';
				return;
			}
			var shown = 0;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				if (historySearch &&
					indexOfCI(rec.title, historySearch) < 0 &&
					indexOfCI(rec.sessionId, historySearch) < 0) continue;
				shown++;
				var row = document.createElement('div');
				row.className = 'dsh-whale-history-row';
				var icon = document.createElement('span');
				var ic = historyIcon(rec.kind);
				icon.className = 'dsh-whale-history-icon ' + ic.cls;
				icon.textContent = ic.text;
				var text = document.createElement('span');
				text.className = 'dsh-whale-history-text';
				var titleFull = rec.title || '（未命名）';
				if (historySearch && indexOfCI(titleFull, historySearch) >= 0) setHighlightText(text, titleFull, historySearch);
				else text.textContent = truncate(titleFull, 16);
				var time = document.createElement('span');
				time.className = 'dsh-whale-history-time';
				var d = new Date(rec.at || 0);
				/* date + time: tasks pile up across days, HH:MM alone is ambiguous */
				time.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
					(d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
					(d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
				row.appendChild(icon);
				row.appendChild(text);
				row.appendChild(time);
				row.addEventListener('click', (function (sessionId, endTime, title) {
					/* 0.4.0: in-house jump (client-module bridge, with moment
					 * positioning) — the sidebar row click stays as the fallback
					 * chain tail; the conversation-client hook is retired */
					return function (event) {
						event.stopPropagation();
						closeCtxHistory();
						if (PET_MODE) {
							/* 桌宠跳转（11-05）：合成 id 反解任务码 → /pet/ctrl
							 * jump（宿主反查真实会话广播 pet/jump，DSH 页跳转+
							 * 桌宠拉前台）——与通知双击同一条链。
							 * 时间锚点（11-06）：这条记录的 endTime（任务完成时
							 * 刻）随载荷走——页鲸 openSessionAt(sid, atMs) 的翻页
							 * 回溯把该任务的消息滚进视野，跳的就是任务节点。 */
							var m = /^session-pet-s(\d+)$/.exec(String(sessionId));
							var code = m ? Number(m[1]) : 0;
							if (code > 0) {
								try {
									fetch('/api/whale-assistant/pet/ctrl', {
										method: 'POST',
										headers: { 'content-type': 'application/json' },
											body: JSON.stringify({ action: 'jump', code: code, atMs: typeof endTime === 'number' ? endTime : undefined })
									}).then(function (r) { return r.ok ? r.json() : { ok: false }; }).then(function (out) {
										/* v2（11-12）：无论 delivered 都唤回窗口（同 bootstrap
										 * 注释——delivered=true 也可能是僵尸渲染层在场） */
										try {
											if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
												window.chrome.webview.postMessage({ c: 'revive' });
											}
										} catch (e2) { }
										if (out && out.ok === true && out.delivered === false) {
											uiSay('DSH 窗口已关——正在重开并自动跳转，稍等 🐳', 3500, sessionId);
										}
									}).catch(function () {
										/* v8（11-13）：引擎不可达时 fetch 秒拒、.then 不跑，
										 * 唤窗消息就丢了——catch 里也要尝试唤回（壳真死由
										 * CIM 重拉），别让「点了没反应」连窗口都不弹。 */
										try {
											if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
												window.chrome.webview.postMessage({ c: 'revive' });
											}
										} catch (e3) { }
									});
									uiSay('正在打开对话… 🐳', 1500, sessionId);
								} catch (e) {
									uiSay('跳转失败，稍后再试 🥲', 2000, sessionId);
								}
							} else {
								uiSay('这条记录的跳转凭证已失效 🥲', 2000, sessionId);
							}
							return;
						}
						if (openSessionAt(sessionId, endTime) || openViaSidebarById(sessionId) || openViaSidebarByTitle(title)) {
							uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
							return;
						}
						uiSay('跳转失败：右键菜单 🔄 刷新页面后重试（浏览器可按 Ctrl+F5）🥲', 3000, sessionId);
					};
				})(rec.sessionId, rec.endTime || rec.at, rec.title));
				list.appendChild(row);
			}
			if (historyCountEl) {
				historyCountEl.textContent = historySearch ? ('找到 ' + shown + ' 条记录') : '';
			}
			if (shown === 0) {
				var noMatch = document.createElement('div');
				noMatch.className = 'dsh-whale-history-empty';
				noMatch.textContent = '没有匹配的记录 🔍';
				list.appendChild(noMatch);
			}
		}
		/** History search text (drawer-local, not persisted). */
		var historySearch = '';

		/** ⏰ 提醒: presets in the right-click menu; persisted in
		 * localStorage so they survive reloads; the precise fire timer
		 * (armReminderTimer) rings due ones as bubble + chime ×3 + badge. */
		function loadReminders() {
			try { return JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]'); } catch (e) { return []; }
		}
		function saveReminders(list) {
			try { localStorage.setItem('dsh-whale:reminders', JSON.stringify(list)); } catch (e) {}
			armReminderTimer(); /* 增删后重臂：新增的更早提醒立刻接管定时（函数声明提升） */
		}
		function openReminders() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '⏰ 提醒我';
			panel.appendChild(title);
			var PRESETS = [5, 10, 25, 60];
			var rmId = function () { return 'rm-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); };
			PRESETS.forEach(function (min) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				setIconLabel(row, '➕ ' + min + ' 分钟后提醒');
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var list = loadReminders();
					list.push({ id: rmId(), at: Date.now() + min * 60000, text: min + ' 分钟时间到了' });
					saveReminders(list);
					uiSay('好，' + min + ' 分钟后提醒你 ⏰', 2000);
					openReminders();
				});
				panel.appendChild(row);
			});
			/* 指定时间提醒（用户需求）：时/分/秒三个紧凑步进器一行排开，
			 * −/+ 点按加减、也可直接键入数字，越界环绕/夹紧；已过今天的
			 * 时刻自动顺延到明天。存绝对时间戳，触发器零改动。 */
			var absSec = document.createElement('div');
			absSec.className = 'dsh-whale-settings-section';
			absSec.textContent = '指定时间（时 / 分 / 秒）';
			panel.appendChild(absSec);
			var absRow = document.createElement('div');
			absRow.className = 'dsh-whale-settings-row dsh-whale-remind-row';
			/* 时/分/秒三个步进器（用户反馈：原生 select 展开一大列太占页面；
			 * −/+ 点按加减、也可直接键入数字，越界环绕/夹紧） */
			var mkStep = function (max, def, step) {
				var wrap = document.createElement('span');
				wrap.className = 'dsh-whale-step';
				var inp = document.createElement('input');
				inp.className = 'dsh-whale-step-val';
				var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
				inp.value = pad(def);
				var mkBtn = function (txt, delta) {
					var b = document.createElement('span');
					b.className = 'dsh-whale-step-btn';
					b.textContent = txt;
					b.addEventListener('click', function (event) {
						event.stopPropagation();
						var v = (parseInt(inp.value, 10) || 0) + delta;
						if (v < 0) v = max; /* wrap around */
						if (v > max) v = 0;
						inp.value = pad(v);
					});
					return b;
				};
				wrap.appendChild(mkBtn('−', -step));
				wrap.appendChild(inp);
				wrap.appendChild(mkBtn('+', step));
				inp.addEventListener('click', function (event) { event.stopPropagation(); });
				inp.addEventListener('change', function () {
					/* typed input: clamp into range, garbage falls back to 0 */
					var v = parseInt(inp.value, 10);
					if (isNaN(v) || v < 0) v = 0;
					if (v > max) v = max;
					inp.value = pad(v);
				});
				wrap._val = function () {
					return Math.min(max, Math.max(0, parseInt(inp.value, 10) || 0));
				};
				return wrap;
			};
			/* sensible default: one hour from now, on the hour */
			var stH = mkStep(23, (new Date(Date.now() + 3600000)).getHours(), 1);
			var stM = mkStep(59, 0, 5);
			var stS = mkStep(59, 0, 5);
			absRow.appendChild(stH);
			absRow.appendChild(stM);
			absRow.appendChild(stS);
			panel.appendChild(absRow);
			/* 文字添加行（用户反馈：一个孤零零的 ➕ 图标没人看得懂） */
			var addRow = document.createElement('div');
			addRow.className = 'dsh-whale-settings-row dsh-whale-remind-addrow';
			setIconLabel(addRow, '➕ 添加提醒');
			addRow.addEventListener('click', function (event) {
				event.stopPropagation();
				addAbsoluteReminder();
			});
			panel.appendChild(addRow);
			var addAbsoluteReminder = function () {
				var h = stH._val(), mi = stM._val(), s = stS._val();
				var target = new Date();
				target.setHours(h, mi, s, 0);
				if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1); /* 已过 → 明天 */
				var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
				var label = pad(h) + ':' + pad(mi) + ':' + pad(s);
				var list = loadReminders();
				list.push({ id: rmId(), at: target.getTime(), text: '定时提醒 ' + label });
				saveReminders(list);
				uiSay('好，' + (target.getDate() === new Date().getDate() ? '今天' : '明天') + ' ' + label + ' 提醒你 ⏰', 2600);
				openReminders();
			};
			var list = loadReminders();
			list.sort(function (a, b) { return a.at - b.at; });
			/* hydrate ids onto legacy (pre-id) entries so cancel-by-id below
			 * never has to fall back to a positional index */
			var rmDirty = false;
			for (var hi = 0; hi < list.length; hi++) {
				if (!list[hi].id) { list[hi].id = 'rm-' + list[hi].at + '-' + hi + '-' + Math.floor(Math.random() * 1e6); rmDirty = true; }
			}
			if (rmDirty) saveReminders(list);
			list.forEach(function (r, idx) {
				var left = Math.max(0, Math.round((r.at - Date.now()) / 60000));
				var d = new Date(r.at);
				var pad2 = function (v) { return v < 10 ? '0' + v : '' + v; };
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				setIconLabel(row, '⏳ ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
					pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
					'（还剩约 ' + left + ' 分钟，点按取消）');
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var rest = loadReminders();
					/* cancel by id, never by the render-time index: the 20s
					 * trigger interval rewrites the list while the drawer is
					 * open (due reminders drop out) and another window can
					 * shrink it too — a stale index deletes the WRONG row */
					var killAt = -1;
					for (var ki = 0; ki < rest.length; ki++) {
						if (rest[ki].id === r.id) { killAt = ki; break; }
					}
					if (killAt >= 0) rest.splice(killAt, 1);
					saveReminders(rest);
					openReminders();
				});
				panel.appendChild(row);
			});
			/* 提醒我 is entered from the RIGHT-CLICK MENU (no settings row):
			 * back goes to the menu, not settings (user request) */
			mkPanelFoot(panel, null, true);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 230, 200);
		}
		/** 触发环（11-14 重做）：旧 20s 轮询的颗粒度就是延时上界——用户实报
		 * 「20:33:10 的提醒 15 秒左右才响」。改为精确定时：对最近一条到点
		 * 时刻 setTimeout 直响（可见窗零节流，误差 ≤1 拍）；saveReminders 后
		 * 重臂（新增更早的提醒立刻接管）、storage 事件接管同 profile 其他
		 * 窗口的增删；5s 轮询只做病态兜底（漏 storage 事件/时钟跳变）。 */
		var remindTimer = null;
		function fireDueReminders() {
			var list = loadReminders();
			var nowT = Date.now();
			var due = [];
			var keep = [];
			for (var ri = 0; ri < list.length; ri++) {
				if (list[ri].at <= nowT) due.push(list[ri]);
				else keep.push(list[ri]);
			}
			if (due.length === 0) return;
			saveReminders(keep);
			for (var di = 0; di < due.length; di++) {
				var msg = '⏰ ' + due[di].text;
				say(msg, 6000);
				/* snapshot=false: a reminder is NOT a task outcome — reading it
				 * later must never resurrect a "此次任务消耗 X tokens" panel
				 * from whatever turn happened to be last (user-reported bug) */
				pushReport(msg, 6000, undefined, false);
				/* 连响三声（11-14 用户拍板）：单声与完成通知难以区分，三声
				 * 顺次入队（DING_GAP_MS 间隔连发，绝不重叠）——一听就是
				 * 「提醒在叫你」，不是又一个任务完成。音色面板可选
				 * （soundRemind，默认铃铛）。 */
				playDing('remind');
				playDing('remind');
				playDing('remind');
			}
		}
		function armReminderTimer() {
			if (remindTimer) { clearTimeout(remindTimer); remindTimer = null; }
			var list = loadReminders();
			var next = Infinity;
			for (var ai = 0; ai < list.length; ai++) { if (list[ai].at < next) next = list[ai].at; }
			if (next === Infinity) return;
			remindTimer = setTimeout(function () {
				remindTimer = null;
				fireDueReminders(); /* 时钟回拨等导致的空响无害 */
				armReminderTimer();
			}, Math.max(0, next - Date.now()));
		}
		try {
			window.addEventListener('storage', function (ev) {
				if (ev && ev.key === 'dsh-whale:reminders') { fireDueReminders(); armReminderTimer(); }
			});
		} catch (eS) { /* 桩环境 */ }
		setInterval(fireDueReminders, 5000); /* 兜底环：只防病态，正常路径不靠它 */
		armReminderTimer();

		/** 📊 任务周报: last-7-day buckets from the history records, drawn in
		 * the same drawer style as the history list (fixed height, list
		 * scrolls). Lives in the side-drawer slot: opening it CLOSES the
		 * settings panel — both float next to the whale, and stacked they
		 * hide each other (the drawer rendered "empty" for its whole life
		 * because its list div was never appended to the panel — only the
		 * title + close ever made it into the DOM). */

		/** 📤 导出历史: Markdown → clipboard; CSV → file download.
		 * onDone(ok) 可选——侧边栏页（ui/panel-page.js）用它驱动行内闪现：
		 * 剪贴板写入是异步的，且失败气泡在桌宠在岗时打进隐藏元素零可见。 */
		function exportHistory(fmt, onDone) {
			if (!history.length) { uiSay('还没有历史可导出哦 🐳', 2000); if (onDone) onDone(false); return; }
			if (fmt === 'csv') {
				var rows = ['time,kind,title,session,tokens'];
				for (var i = history.length - 1; i >= 0; i--) {
					var r = history[i];
					var d = new Date(r.at || 0);
					var ts = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.toTimeString().slice(0, 8);
					rows.push([ts, r.kind || '', '"' + String(r.title || '').replace(/"/g, '""') + '"', r.sessionId || '', r.turnTokens == null ? '' : r.turnTokens].join(','));
				}
				var blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
				var a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = 'whale-history.csv';
				a.click();
				setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { /* 桩环境 */ } }, 1500); /* blob URL 用完即收（11-11 审计 P3-9） */
				uiSay('CSV 已下载 📤', 2000);
				if (onDone) onDone(true);
				return;
			}
			var lines = ['# 小鲸鱼任务历史', ''];
			for (var j = 0; j < history.length; j++) {
				var rr = history[j];
				var dd = new Date(rr.at || 0);
				var icon = rr.kind === 'done' ? '✅' : rr.kind === 'fail' ? '❌' : rr.kind === 'killed' ? '⏹' : '❓';
				lines.push('- ' + icon + ' ' + (rr.title || '（未命名）') + ' — ' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日 ' + dd.toTimeString().slice(0, 5) + (rr.turnTokens ? ' · ' + rr.turnTokens + ' tok' : ''));
			}
			var md = lines.join('\n');
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(md).then(function () { uiSay('Markdown 已复制 📋', 2200); if (onDone) onDone(true); }, function () { uiSay('复制失败 🥲', 2000); if (onDone) onDone(false); });
			} else {
				uiSay('剪贴板不可用 🥲', 2000);
				if (onDone) onDone(false);
			}
		}

		function openHistory() {
			closeCtxPanel(); /* drawers and floating panels never stack */
			var refillLive = function () {
				/* the server merge may have brought records from other windows:
				 * re-fill the list body when the pull settles (children walk —
				 * NOT querySelector: the class form must work in the DOM stub
				 * too, whose querySelector matches by tag) */
				if (ctxHistory && ctxHistory.isConnected) {
					var liveList = null;
					for (var li = 0; li < ctxHistory.children.length; li++) {
						if (ctxHistory.children[li].className === 'dsh-whale-history-list') { liveList = ctxHistory.children[li]; break; }
					}
					if (liveList) fillHistoryList(liveList);
				}
			};
			pullCloudHistory(refillLive);
			/* 打开期间实时跟随（5s）：桌宠页 re-pull /pet/history，页内 re-pull
			 * /state 合并其他窗口——两条路都落在 refillLive 重渲染上 */
			if (ctxHistoryLiveTimer) clearInterval(ctxHistoryLiveTimer);
			ctxHistoryLiveTimer = setInterval(function () { pullCloudHistory(refillLive); }, 5000);
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📜 历史任务';
			panel.appendChild(title);
			var search = document.createElement('input');
			search.className = 'dsh-whale-history-search';
			search.placeholder = '🔍 搜标题 / 会话…';
			search.value = historySearch;
			search.addEventListener('input', function () {
				historySearch = search.value;
				fillHistoryList(list);
			});
			search.addEventListener('click', function (event) { event.stopPropagation(); });
			panel.appendChild(search);
			/* #7: "找到 N 条记录" line under the search box */
			historyCountEl = document.createElement('div');
			historyCountEl.className = 'dsh-whale-history-count';
			panel.appendChild(historyCountEl);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			fillHistoryList(list);
			panel.appendChild(list);
			var clearRow = document.createElement('div');
			clearRow.className = 'dsh-whale-history-clear';
			clearRow.textContent = '🗑 清空历史';
			/* #8: ranged clear — clearAt compares `at < clearAt`, so a
			 * back-dated generation marker drops only old records, both
			 * locally and in the cloud merge (host needs no changes). */
			var clearOpts = document.createElement('div');
			clearOpts.className = 'dsh-whale-history-clear-opts';
			var doClear = function (cutoff, label) {
				var before = history.length;
				if (cutoff === null) {
					history.length = 0;
				} else {
					for (var i = history.length - 1; i >= 0; i--) {
						if ((history[i].at || 0) < cutoff) history.splice(i, 1);
					}
				}
				bumpClearAt(cutoff === null ? undefined : cutoff);
				if (PET_MODE) {
					/* 桌宠（11-05）：本地磁盘零历史——清空直达共享账本（宿主
					 * clearAt 世代标记，页内/其他窗口下次合并时同步消失） */
					try {
						fetch('/api/whale-assistant/pet/ctrl', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ action: 'clear-history', cutoff: cutoff === null ? null : cutoff })
						}).catch(function () {});
					} catch (e) {}
				} else {
					try { safeSet(HISTORY_KEY, history); } catch (e) {}
					pushCloudHistory();
				}
				historySearch = '';
				fillHistoryList(list);
				clearRow.dataset.armed = '0';
				clearOpts.classList.remove('show');
				clearRow.textContent = '🗑 清空历史';
				showSidePanel(panel, 280); /* drawer shrank: re-clamp */
				uiSay(label + '，共 ' + (before - history.length) + ' 条 🧹', 2400);
			};
			var mkClearOpt = function (text, cutoff) {
				var opt = document.createElement('div');
				opt.className = 'dsh-whale-history-clear-opt';
				opt.textContent = text;
				opt.addEventListener('click', function (event) {
					event.stopPropagation();
					doClear(cutoff, text);
				});
				clearOpts.appendChild(opt);
			};
			mkClearOpt('清空全部', null);
			mkClearOpt('仅清空 7 天前', Date.now() - 7 * 86400000);
			mkClearOpt('仅清空 30 天前', Date.now() - 30 * 86400000);
			clearRow.addEventListener('click', function (event) {
				event.stopPropagation();
				if (clearRow.dataset.armed !== '1') {
					clearRow.dataset.armed = '1';
					clearRow.textContent = '⚠️ 选择要清空的范围';
					clearOpts.classList.add('show');
					/* the drawer just grew: re-measure + re-clamp so the
					 * options never run past the screen edge (same fix as
					 * the settings (?) hints) */
					showSidePanel(panel, 280);
					return;
				}
				/* tapping the title row again = cancel */
				clearRow.dataset.armed = '0';
				clearOpts.classList.remove('show');
				clearRow.textContent = '🗑 清空历史';
				showSidePanel(panel, 280);
			});
			panel.appendChild(clearRow);
			panel.appendChild(clearOpts);
			/* 09-13 用户拍板: the missing "forget a conversation" entry.
			 * Truly forgetting one conversation is TWO steps — 清历史 first
			 * (drops the record snapshots), then this row (wipes the book +
			 * the in-memory names); history snapshots re-seed names on the
			 * next load otherwise. Semantics live in the manual row. */
			var bookClearRow = document.createElement('div');
			bookClearRow.className = 'dsh-whale-history-clear';
			bookClearRow.textContent = '📇 清空通讯录';
			bookClearRow.addEventListener('click', function (event) {
				event.stopPropagation();
				if (bookClearRow.dataset.armed !== '1') {
					bookClearRow.dataset.armed = '1';
					bookClearRow.textContent = '⚠️ 再点一次确认清空';
					return;
				}
				bookClearRow.dataset.armed = '0';
				bookClearRow.textContent = '📇 清空通讯录';
				var wiped = clearTitleBook();
				uiSay(wiped > 0 ? '通讯录已清空（' + wiped + ' 条），名字会重新学习 🧹' : '通讯录本来就是空的 🧹', 2400);
			});
			panel.appendChild(bookClearRow);
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			/* fixed-height drawer with a scrollable list: long histories never
			 * grow past the viewport — the LIST scrolls, not the drawer */
			showSidePanel(panel, 280);
		}
		function closeCtxHistory() {
			/* 11-05：实时刷新定时器随抽屉关闭停止（开着才轮询） */
			if (ctxHistoryLiveTimer) { clearInterval(ctxHistoryLiveTimer); ctxHistoryLiveTimer = null; }
			if (ctxHistory) ctxHistory.classList.remove('show');
		}
/* ---- module: src/ui/panel-page.js ---- */
		/* ———— 小鲸鱼助手侧边栏页（2026-11-08，方案见对话） ————
		 * 官方 slots API（client.js 注册 sidebar.panellist id=whale-assistant +
		 * main key=whale-assistant，order 30）的页面半区挂载面：React 包装经
		 * window.__dshWhalePanel.mount(root) 调进来。UI 住在页面半区——
		 * CONFIG/saveConfig/applyConfig 与抽屉打开函数（音色/周报/运行状态）
		 * 都在 uiInit 闭包里，client 半部零依赖原则不破。
		 * 桌宠页（PET_MODE）没有 ModuleLoader=没有侧边栏：本文件在桌宠页
		 * 只定义不触发，桌宠右键设置保留抽屉形态（方案边界）。
		 * Tab：⚙️ 设置（健康条+全项迁移）/ 🐋 桌宠（三态控制，POST /pet/ctrl
		 * form —— 该路由仅栅栏无 token，页内鲸历史同款通道）。 */
		var __whalePanelCss = false;
		var __ppToneOpen = false; /* 音色展开态跨 re-render 存活（主观痛点 7） */
		function mountWhalePanelPage(root) {
			if (!__whalePanelCss) {
				__whalePanelCss = true;
				var css = document.createElement('style');
				css.textContent = [
					/* 11-11 真机修复轮（用户实报「展开后没法往下滑」+「关于全屏才
					 * 看得见」）：页面此前从未自带滚动——宿主 main 面板容器定高
					 * 裁切，官方页全是 pageBody 自滚。结构分层：root（pp-host）=
					 * 全宽自滚容器，page（pp）=860px 居中栏。**pp 与 pp-host 从此
					 * 不同元素**——11-11 的双类源序冲突坑永久消失 */
					'.dsh-whale-pp-host{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
					/* 页面底/文字直读 --wh-* token（DSH alias），亮暗主题自动跟随：
					 * 面板底=bg-layer-1 实底，卡片/行=bg-layer-2+card-stroke 描边，
					 * tint 一律走 interactive-bg-hover/active，不再自带深夜蓝硬编码 */
					'.dsh-whale-pp{width:min(100%,860px);margin:0 auto;padding:20px 26px;font-size:13px;color:var(--wh-panel-text);background:var(--wh-panel-bg)}',
					'.dsh-whale-pp-tabs{display:flex;gap:8px;margin:6px 0 18px}',
					'.dsh-whale-pp-tab{padding:7px 20px;border-radius:var(--wh-radius-full);cursor:pointer;border:1px solid var(--wh-panel-border);color:var(--wh-panel-muted);background:transparent;font-size:13px}',
					'.dsh-whale-pp-tab.on{background:var(--wh-panel-active);color:var(--wh-panel-text)}',
					'.dsh-whale-pp-sec{margin:20px 0 8px;font-weight:600;color:var(--wh-panel-head);font-size:12px}',
					'.dsh-whale-pp-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--wh-radius-s);cursor:pointer;background:var(--wh-card-bg);border:1px solid var(--wh-card-border);margin:5px 0}',
					'.dsh-whale-pp-row:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-pp-val{color:var(--wh-panel-muted)}',
					'.dsh-whale-pp-health{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-radius:var(--wh-radius-s);background:var(--wh-card-bg);border:1px solid var(--wh-card-border);margin:14px 0 0}',
					'.dsh-whale-pp select{background:var(--wh-panel-bg);color:var(--wh-panel-text);border:1px solid var(--wh-panel-border);border-radius:var(--wh-radius-s);padding:4px 8px;font-size:12px}',
					'.dsh-whale-pp-petbtns{display:flex;gap:10px;margin:10px 0}',
					'.dsh-whale-pp-petbtn{flex:1;padding:12px 10px;border-radius:var(--wh-radius-s);border:1px solid var(--wh-card-border);cursor:pointer;background:var(--wh-card-bg);color:var(--wh-panel-text);text-align:center;font-size:13px}',
					'.dsh-whale-pp-petbtn.on{background:var(--wh-panel-active);border-color:var(--wh-accent)}',
					'.dsh-whale-pp-status{color:var(--wh-panel-muted);margin:8px 0 4px;font-size:12px}',
					'.dsh-whale-pp-content .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-content .dsh-whale-manual-search{width:100%;margin:0 0 8px;padding:8px 12px;font-size:13px}',
					/* 使用说明 Tab：高度实测自适应窗口（用户反馈固定 calc 边界
					 * 悬空/局促——「直接适应窗口范围」）：底边=视口底-24px */
					'.dsh-whale-pp-manual{overflow-y:auto;padding-right:4px;overscroll-behavior:contain}',
					/* 周报 Tab：报告列表卡片化（旧抽屉壳的观感由这里补齐） */
					'.dsh-whale-pp-report{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m);padding:14px 16px;margin:14px 0 6px}',
					'.dsh-whale-pp-report .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-report .dsh-whale-report-summary{font-weight:600;color:var(--wh-panel-head);padding:8px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin-bottom:8px}',
					'.dsh-whale-pp-report .dsh-whale-history-row{display:flex;justify-content:space-between;padding:10px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin:5px 0}',
					/* 日期行假可点（主观痛点 9）：手型与 hover 高亮继承自旧抽屉
					 * 样式而页面无点击行为——指针与 hover 都收掉，tooltip 保留 */
					'.dsh-whale-pp-report .dsh-whale-history-row{cursor:default}',
					'.dsh-whale-pp-report .dsh-whale-history-row:hover{background:var(--wh-panel-hover)}',
					/* 页头（官方页 h1 20px/500 + 13px 描述行） */
					'.dsh-whale-pp-title{font-size:20px;font-weight:500;line-height:28px;color:var(--wh-panel-head);margin-top:2px}',
					'.dsh-whale-pp-desc{font-size:13px;line-height:20px;color:var(--wh-panel-muted);margin:4px 0 0}',
					/* 音色子行从属感（主观痛点 7）：左缩进一档 */
					'.dsh-whale-pp-tone-detail{margin-left:18px}',
					/* 试听按钮（11-11 三报）：select 重选同值不触发 change——
					 * 显式试听按钮兜住「想听已选中声音」的场景 */
					'.dsh-whale-tone-right{display:flex;align-items:center;gap:8px}',
					'.dsh-whale-tone-play{background:var(--wh-panel-bg);color:var(--wh-panel-text);border:1px solid var(--wh-panel-border);border-radius:var(--wh-radius-s);padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit}',
					'.dsh-whale-tone-play:hover{background:var(--wh-panel-hover)}',
					/* 桌宠未启用：按钮置灰（主观痛点 10） */
					'.dsh-whale-pp-petbtn.off{opacity:.45;cursor:default}',
					/* —— 周报新版式（11-13）：今日汇总置顶 + 按天折叠展开当日会话
					 * 明细 + token 占比条 + 会话行点击跳回。旧的「日期行假可点」
					 * 规则（.dsh-whale-history-row cursor:default，上方 51-54 行）
					 * 只匹配旧类名，新类名不受影响；全部走 --wh-* token 体系，
					 * 亮暗主题自动跟随 */
					/* 日期折叠头：可点（真可点了——旧评审的假可点收指针行为有意
					 * 变更），hover 抬到 panel-active 给出可点反馈 */
					'.dsh-whale-pp-report .dsh-whale-rep-day{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin:5px 0;cursor:pointer}',
					'.dsh-whale-pp-report .dsh-whale-rep-day:hover{background:var(--wh-panel-active)}',
					/* 空日：无展开行为——指针与 hover 反馈都收掉（与 .rep-day:hover
					 * 同特异性、源序在后=胜出） */
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty{cursor:default}',
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-rep-day-left{color:var(--wh-panel-text)}',
					'.dsh-whale-rep-day-right{color:var(--wh-panel-muted);font-size:12px}',
					/* 展开后的会话明细行：cursor:pointer 只给折叠头与会话行 */
					'.dsh-whale-pp-report .dsh-whale-rep-srow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 12px 8px 24px;border-radius:var(--wh-radius-s);margin:3px 0;cursor:pointer}',
					'.dsh-whale-pp-report .dsh-whale-rep-srow:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-rep-smain{display:flex;flex-direction:column;min-width:0}',
					'.dsh-whale-rep-stitle{color:var(--wh-panel-text)}',
					'.dsh-whale-rep-smeta{color:var(--wh-panel-muted);font-size:12px;margin-top:2px}',
					'.dsh-whale-rep-sright{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}',
					'.dsh-whale-rep-stok{color:var(--wh-panel-muted);font-size:12px}',
					/* 占比条：4px 纯 CSS 条，底槽=panel-hover（token 体系下即宿主
					 * interactive-bg-hover），填充=accent */
					'.dsh-whale-rep-share{display:flex;align-items:center;gap:6px}',
					'.dsh-whale-rep-bar{width:90px;height:4px;border-radius:2px;background:var(--wh-panel-hover);overflow:hidden}',
					'.dsh-whale-rep-fill{height:100%;background:var(--wh-accent);border-radius:2px}',
					'.dsh-whale-rep-pct{color:var(--wh-panel-muted);font-size:11px}',
					/* —— 使用说明卡片化重构（11-14，用户批「分区主层级小、子层级
					 * 大」的层级倒挂 + 「内容挤成一行」）：每个分区=一张完整融合
					 * 卡片（44px 可点卡头 + 与卡头同底同描边的体行，行间细分隔线，
					 * 末行收底圆角）——子内容被明确「包」在分区里；条目从独立重
					 * 卡片降级为卡体内行（14px 标题 / 13px 正文 / 20px 小徽章）。
					 * 颜色全部 --wh-* token（唯一例外=搜索命中底色沿用 style.css
					 * 既有 rgba 命中值）；选择器钉死 .dsh-whale-pp-manual 作用域，
					 * 历史抽屉/设置页零波及；特异性 (0,2,0) 起步压过 style.css
					 * 的 (0,1,0) 基类规则。扁平 DOM 不动：行仍是 list 直接子元素，
					 * 搜索 children 遍历 / data-folded 折叠记忆 / _m* 挂点契约全保 */
					/* ① 分区头=卡片头行：15px/600 主层级立起来，sticky 吸顶；
					 * 展开态与折叠态头行完全一致，chevron 圆片旋转指示状态；
					 * 展开时下角变方与体行融合、折叠时四角全圆自成一张卡 */
					'.dsh-whale-pp-manual .dsh-whale-manual-sec{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 10px 0 14px;margin:12px 0 0;background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m) var(--wh-radius-m) 0 0;font-size:15px;font-weight:600;color:var(--wh-panel-text);top:0}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec[data-folded="1"]{border-radius:var(--wh-radius-m)}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec:hover{background-color:var(--wh-card-bg);background-image:linear-gradient(var(--wh-panel-hover),var(--wh-panel-hover))}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec-t{flex:none;line-height:22px}',
					/* 头行右侧：徽标/摘要退为 muted 小圆片/小字（原 accent 描边
					 * 徽章比主标题还抢眼——子层级压过父级的一大来源） */
					'.dsh-whale-pp-manual .dsh-whale-manual-badge{flex:none;margin-left:auto;font-size:11px;font-weight:500;line-height:20px;padding:0 9px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-panel-muted);white-space:nowrap}',
					'.dsh-whale-pp-manual .dsh-whale-manual-hint{margin-left:auto;font-size:11.5px;font-weight:400;color:var(--wh-panel-muted);white-space:nowrap}',
					/* 头行 chevron：22px 圆片（style.css 的裸字符 ::after 覆写），
					 * 展开 ▸ 旋转 90° 朝下、折叠复位朝右，0.18s 过渡 */
					'.dsh-whale-pp-manual .dsh-whale-manual-sec::after{content:"▸";float:none;flex:none;width:22px;height:22px;line-height:22px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-panel-muted);font-size:10px;text-align:center;transform:rotate(90deg);transition:transform .18s ease;margin-left:2px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec[data-folded="1"]::after{transform:rotate(0deg)}',
					/* ② 卡片体=条目行：与卡头同底同描边、上下边裁掉，相邻行由
					 * (0,3,0) 内分隔线衔接——头行+体行融为一张完整卡片。类名
					 * dsh-whale-help-row / dsh-whale-manual-item 保持严格相等
					 * （测试/搜索契约），只动样式不动结构 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-top:0;border-bottom:0;border-radius:0;padding:10px 14px;margin:0}',
					'.dsh-whale-pp-manual .dsh-whale-help-row{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-top:0;border-bottom:0;border-radius:0;padding:10px 14px;margin:0;flex-wrap:wrap;align-items:flex-start}',
					'.dsh-whale-pp-manual .dsh-whale-help-row+.dsh-whale-help-row,.dsh-whale-pp-manual .dsh-whale-help-row+.dsh-whale-manual-item,.dsh-whale-pp-manual .dsh-whale-manual-item+.dsh-whale-help-row,.dsh-whale-pp-manual .dsh-whale-manual-item+.dsh-whale-manual-item{border-top:1px solid var(--wh-panel-divider)}',
					/* ③ 卡片收底：分区最后一行（下一头行前 / 列表末尾）补下边+
					 * 下圆角（:has 相邻预测，WebView2/Chrome 105+；不支持的环境
					 * 退化为方角无下边，仅影响收尾观感，不影响功能） */
					'.dsh-whale-pp-manual .dsh-whale-history-list>*:has(+.dsh-whale-manual-sec),.dsh-whale-pp-manual .dsh-whale-history-list>*:last-child:not(.dsh-whale-manual-sec){border-bottom:1px solid var(--wh-card-border);border-radius:0 0 var(--wh-radius-m) var(--wh-radius-m)}',
					/* ④ 条目文字：标题 14px/600、正文 13px/1.6 muted——正文支持
					 * 数据内 \n 双行（主句+补充分行，pre-line 渲染），_mDesc 整串
					 * 高亮/恢复契约不变；编号徽章做小做精：20px accent-on-tint
					 * 圆片（原 18px 实心蓝抢过分区头——层级倒挂的另一来源） */
					'.dsh-whale-pp-manual .dsh-whale-manual-t{font-size:14px;font-weight:600;color:var(--wh-panel-text);line-height:20px;white-space:normal;word-break:keep-all}',
					'.dsh-whale-pp-manual .dsh-whale-help-text{font-size:14px;font-weight:600;color:var(--wh-panel-text);line-height:20px;white-space:normal}',
					'.dsh-whale-pp-manual .dsh-whale-help-num{box-sizing:border-box;flex:none;width:20px;height:20px;line-height:20px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-accent);font-size:11px;font-weight:600;text-align:center;display:inline-flex;align-items:center;justify-content:center}',
					'.dsh-whale-pp-manual .dsh-whale-manual-d{margin-top:4px;font-size:13px;line-height:1.6;color:var(--wh-panel-muted);white-space:pre-line;word-break:keep-all}',
					/* 编号手势行说明行：flex-basis:100% 强制换行，左缩进对齐正文
					 * （编号 20px + gap 10px = 30px） */
					'.dsh-whale-pp-manual .dsh-whale-help-row .dsh-whale-manual-d{flex:1 1 100%;margin:4px 0 0 30px;padding:0}',
					/* ⑤ 通知矩阵（「通知响了=该做什么」）：卡体内 4 行两列短语，
					 * 逐格 _mCells 搜索契约不变 */
					'.dsh-whale-pp-manual .dsh-whale-manual-matrix{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin-top:8px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-s{font-size:13px;line-height:1.6;color:var(--wh-panel-text);white-space:nowrap}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-a{font-size:13px;line-height:1.6;color:var(--wh-panel-muted)}',
					/* ⑤b 末尾参考面板（11-14，用户批「1-8 编号节奏之后突然一堆
					 * 东西堆在那里」）：通知矩阵/常用设置两块参考内容不再与编号
					 * 条目同层平铺——外层保持卡片片段链（className 严格不变=
					 * 测试/搜索契约，样式走 :has 定向），内层软底内嵌盒+图标圆片，
					 * 与编号条目刻意「另起一格」 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item:has(> .dsh-whale-manual-panel){padding:4px 10px 10px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel{background:var(--wh-panel-bg);border:1px solid var(--wh-panel-divider);border-radius:var(--wh-radius-s);padding:10px 12px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-h{display:flex;align-items:center;gap:8px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-ico{box-sizing:border-box;flex:none;width:20px;height:20px;line-height:20px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);font-size:11px;text-align:center}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-h .dsh-whale-manual-t{font-size:13.5px;line-height:20px}',
					/* ⑥ 搜索命中底色：style.css 的 (0,1,0) .help-hit 规则压不过上面的
					 * (0,2,0) 卡片底色——同值复写提特异性（色值沿用 style.css
					 * 既有命中底色，非新增） */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-help-hit,.dsh-whale-pp-manual .dsh-whale-help-row.dsh-whale-help-hit{background:rgba(255,199,0,0.12)}',
					/* 手册内 mark 高亮统一兜底（含手势行说明行），全部走 token */
					'.dsh-whale-pp-manual mark{background:var(--wh-highlight);color:var(--wh-panel-text);border-radius:2px;padding:0 1px}',
					/* ⑦ 机制内幕区（ℹ️ 更多细节）：无卡片——行与卡体同底色融合，
					 * 词条行内 600 + 说明行内 muted，行间 divider，7px 紧凑内边距
					 * （次级层级比主区条目更轻：字号 12.5px < 主区 14px） */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-manual-detail{padding:7px 14px;margin:0;font-size:12.5px;line-height:1.6}',
					/* 标题与说明同行：inline 化 + 8px 间隔（标题 600/panel-text，
					 * 说明 muted——词条色 token 由上面共享规则带下来） */
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-t{display:inline;font-size:12.5px;font-weight:600;line-height:inherit}',
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-d{display:inline;margin:0 0 0 8px;font-size:12.5px;line-height:inherit}',
					/* ⑧ 节奏（4/8 倍数）：首区贴搜索框 4px，状态行收边去大留白 */
					'.dsh-whale-pp-manual .dsh-whale-history-list>.dsh-whale-manual-sec:first-child{margin-top:4px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-status{padding:0 2px 2px;font-size:12px}'
				].join('');
				(document.head || document.body).appendChild(css); /* vm mock 无 head */
			}
			root.textContent = '';
			/* 11-11 真机修复轮：滚动分层（见 CSS 注释）——root 只当滚动容器，
			 * 860px 栏挪进内层 page */
			var page = document.createElement('div');
			page.className = 'dsh-whale-pp';
			root.appendChild(page);
			var tabBar = document.createElement('div');
			tabBar.className = 'dsh-whale-pp-tabs';
			var content = document.createElement('div');
			content.className = 'dsh-whale-pp-content';
			/* 页头（11-11 基线②/主观痛点 1：官方页 h1 20px/500 + 13px 描述行是
			 * 新人定位的第一锚点——此前直接进 Tab 条，页面没有身份） */
			var ppTitle = document.createElement('div');
			ppTitle.className = 'dsh-whale-pp-title';
			ppTitle.textContent = '小鲸鱼助手';
			var ppDesc = document.createElement('div');
			ppDesc.className = 'dsh-whale-pp-desc';
			ppDesc.textContent = '任务播报与记录——设置、周报、使用说明都在这里。';
			page.appendChild(ppTitle);
			page.appendChild(ppDesc);
			page.appendChild(tabBar);
			page.appendChild(content);
			var TABS = [['settings', '⚙️ 设置'], ['pet', '🐋 小鲸鱼形态'], ['report', '📊 周报'], ['help', '📖 使用说明']];
			var curTab = 'settings';
			var tabBtns = {};
			TABS.forEach(function (t) {
				var b = document.createElement('button');
				b.className = 'dsh-whale-pp-tab';
				b.textContent = t[1];
				b.addEventListener('click', function (event) {
					event.stopPropagation();
					curTab = t[0];
					render();
				});
				tabBtns[t[0]] = b;
				tabBar.appendChild(b);
			});
			function render() {
				TABS.forEach(function (t) { tabBtns[t[0]].classList.toggle('on', curTab === t[0]); });
				content.textContent = '';
				if (curTab === 'settings') renderSettings(content);
				else if (curTab === 'pet') renderPet(content);
				else if (curTab === 'report') mountWhaleReportTab(content);
				else mountWhaleManualTab(content);
			}
			function ppSection(host, label) {
				var sec = document.createElement('div');
				sec.className = 'dsh-whale-pp-sec';
				sec.textContent = label;
				host.appendChild(sec);
			}
			/* 行语义与 openSettings 逐条同源（同一份 CONFIG/applyConfig）——
			 * 改动即生效，整页重渲（页面区重渲不波及鲸鱼浮层） */
			function ppRow(host, label, valueText, onChange) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onChange();
				});
				host.appendChild(row);
			}
			function renderSettings(host) {
				/* 健康条（常驻）：数据源=health.js 自检状态（openHealthPanel 同源）。
				 * 小节标题「运行状态」（主观痛点 8：老用户拿旧地图找不到它） */
				ppSection(host, '🩺 运行状态');
				var health = window.__dshWhale && window.__dshWhale._health;
				var rep = null;
				try {
					rep = (health && health.state().lastReport) || (health && health.run()) || null;
				} catch (e) { rep = null; }
				if (!rep) rep = { server: 'ok', dom: 'ok', jump: 'warn' };
				var strip = document.createElement('div');
				strip.className = 'dsh-whale-pp-health';
				var healthItems = [
					['后台通知', rep.server === 'fail' ? '❌' : '✅'],
					['用量读取', rep.dom === 'fail' ? '❌' : '✅'],
					/* 跳转恒 warn 级（health.js 只产 ok|warn）；详情=鲸鱼头顶 ⚠️
					 * 的 openHealthPanel 浮层（menu.js 同源三行） */
					['气泡跳转', rep.jump === 'ok' ? '✅' : '⚠️']
				];
				healthItems.forEach(function (it) {
					var s = document.createElement('span');
					s.textContent = it[0] + ' ' + it[1];
					strip.appendChild(s);
				});
				host.appendChild(strip);
				/* 恢复提示常驻在三个状态下面（11-09 用户拍板：详细自查展开区
				 * 与状态条内容重复，砍掉；链路异常时鲸鱼头顶 ⚠️ chip 仍可点
				 * 旧浮层看详情——鲸鱼锚定场景不违和） */
				var hint = document.createElement('div');
				hint.className = 'dsh-whale-pp-status';
				hint.textContent = '多数失效是页面过期：右键菜单 🔄 刷新页面（或浏览器 Ctrl+F5）即可恢复；「气泡跳转 ⚠️」在浏览器窗口属常态（走侧栏兜底）；仍失效请看控制台 [🐋] 日志';
				host.appendChild(hint);
				ppSection(host, '通知');
				ppRow(host, '🔔 开工通知', CONFIG.notifyOnStart ? '开' : '关', function () {
					if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
					render();
				});
				var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
				var dndCur = CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : '关';
				var dndIdx = -1;
				DND_PRESETS.forEach(function (pr, i) {
					if (pr && pr[0] + '-' + pr[1] === dndCur) dndIdx = i;
				});
				/* 免打扰循环修复（11-09 用户实报「只有关没有开」）：关态下
				 * dndIdx=-1，(−1+1)%5=0 命中 null 档=仍是关——从关永远点不开。
				 * 关态视为站在 0 档上，下一步跳 1 档（首个时段）；开态未匹配
				 * （自定义时段）→ 下一档回关，语义不变。 */
				if (!CONFIG.dndEnabled) dndIdx = 0;
				ppRow(host, '🌙 免打扰', dndCur, function () {
					var next = DND_PRESETS[(dndIdx + 1) % DND_PRESETS.length];
					if (next) applyConfig({ dndEnabled: true, dndFrom: next[0], dndTo: next[1] });
					else applyConfig({ dndEnabled: false });
					saveConfig();
					render();
				});
				ppSection(host, '声音');
				/* 总静音（主观痛点 4）：菜单 🔇 的页面镜像——菜单里静音着时
				 * 页内调音量依然无声，此前页面无法解释这个现象 */
				ppRow(host, '🔊 声音总开关', window.__dshWhale.soundMuted && window.__dshWhale.soundMuted() ? '关（静音中）' : '开', function () {
					if (window.__dshWhale.setSoundMuted) window.__dshWhale.setSoundMuted(!window.__dshWhale.soundMuted());
					render();
				});
				var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
				ppRow(host, '🔊 音量', Math.round(CONFIG.volume * 100) + '%', function () {
					var i = VOL_STEPS.indexOf(CONFIG.volume);
					if (applyConfig({ volume: VOL_STEPS[(i + 1) % VOL_STEPS.length] })) saveConfig();
					render();
				});
				/* 🎵 音色：四个下拉行内展开（11-09 用户反馈浮层盖 DSH 侧边栏）
				 * ——语义与旧浮层选择器同源：改选即应用+持久化+现场试听 */
				var toneOpen = __ppToneOpen;
				var toneDetail = document.createElement('div');
				toneDetail.className = 'dsh-whale-pp-tone-detail';
				toneDetail.style.display = toneOpen ? 'block' : 'none';
				var KINDS = [
					{ key: 'soundDone', kind: 'done', label: '✅ 完成通知', opts: ['ding', 'bell', 'chime', 'none'] },
					{ key: 'soundFail', kind: 'fail', label: '❌ 失败通知', opts: ['thud', 'ding', 'bell', 'chime', 'none'] },
					{ key: 'soundAttn', kind: 'attention', label: '❓ 提问回答', opts: ['chime', 'ding', 'bell', 'none'] },
					{ key: 'soundRemind', kind: 'remind', label: '⏰ 定时提醒', opts: ['bell', 'ding', 'chime', 'thud', 'none'] }
				];
				var LABELS = { ding: '单声叮', bell: '叮叮（两连击）', chime: '清脆上行', thud: '低沉下行', none: '静音' };
				KINDS.forEach(function (k) {
					var row = document.createElement('div');
					row.className = 'dsh-whale-pp-row';
					var l = document.createElement('span');
					l.textContent = k.label;
					var sel = document.createElement('select');
					sel.className = 'dsh-whale-sound-sel';
					k.opts.forEach(function (opt) {
						var opt2 = document.createElement('option');
						opt2.value = opt;
						opt2.textContent = LABELS[opt];
						sel.appendChild(opt2);
					});
					/* 存量脏值（不在该类 opts）回落显示到第一项（11-11 审计 P3-7：
					 * sel.value 赋未知值=静默空白），CONFIG 不动 */
					if (k.opts.indexOf(CONFIG[k.key]) >= 0) sel.value = CONFIG[k.key];
					else sel.selectedIndex = 0;
					sel.addEventListener('click', function (event) { event.stopPropagation(); });
					/* 试听（11-11 三报：用户实报「选择音色没声音」）。显式「▶
					 * 试听」按钮兜住全部场景——原生 select **重选同值不触发
					 * change**（想听已选中的声音只能靠按钮），change 只覆盖
					 * 换值场景。previewDing=独立直渲通道（不进通知队列，点了
					 * 就响——11-11 三报延时修），总静音仍尊重 */
					var audition = function () {
						var mutedNow = false;
						try { mutedNow = !!(window.__dshWhale.soundMuted && window.__dshWhale.soundMuted()); } catch (e) { }
						if (!mutedNow) previewDing(k.kind);
						l.textContent = k.label + (mutedNow ? ' 🔇（总开关静音）' : ' ♪');
						setTimeout(function () { l.textContent = k.label; }, 1800);
					};
					sel.addEventListener('change', function () {
						var pa = {}; pa[k.key] = sel.value;
						if (applyConfig(pa)) saveConfig();
						audition();
					});
					var playBtn = document.createElement('button');
					playBtn.type = 'button';
					playBtn.className = 'dsh-whale-tone-play';
					playBtn.textContent = '▶ 试听';
					playBtn.addEventListener('click', function (event) {
						event.stopPropagation();
						audition();
					});
					var right = document.createElement('span');
					right.className = 'dsh-whale-tone-right';
					right.appendChild(sel);
					right.appendChild(playBtn);
					row.appendChild(l);
					row.appendChild(right);
					toneDetail.appendChild(row);
				});
				ppRow(host, '🎵 音色', toneOpen ? '收起 ↑' : '按通知设置 →', function () {
					toneOpen = !toneOpen;
					__ppToneOpen = toneOpen; /* 模块级记忆：别的行触发重渲也不收走展开态 */
					toneDetail.style.display = toneOpen ? 'block' : 'none';
				});
				host.appendChild(toneDetail);
				ppSection(host, '监控');
				var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
				ppRow(host, '⏱️ 工具超时', Math.round(CONFIG.toolStuckMs / 1000) + 's', function () {
					var i = TOOL_PRESETS.indexOf(CONFIG.toolStuckMs);
					if (applyConfig({ toolStuckMs: TOOL_PRESETS[(i + 1) % TOOL_PRESETS.length] })) saveConfig();
					render();
				});
				var P_PRESETS = [50, 60, 70, 80, 90];
				ppRow(host, '🚨 压力提醒', (CONFIG.pressureWarnPct || 70) + '%', function () {
					var i = P_PRESETS.indexOf(CONFIG.pressureWarnPct || 70);
					if (applyConfig({ pressureWarnPct: P_PRESETS[(i + 1) % P_PRESETS.length] })) saveConfig();
					render();
				});
			/* 行内闪现反馈（11-11 用户实报「点了没动静」）：exportHistory 的
			 * 反馈走 uiSay 鲸鱼气泡——桌宠运行时页鲸休眠=打在隐藏元素里零可
			 * 见反馈。页面行自带 ✓ 闪现，不依赖鲸鱼可见性 */
			function ppFlashRow(host, label, valueText, onDo) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				var flashTimer = null;
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onDo(function (okText) {
						v.textContent = okText;
						/* 连点先清旧定时器（11-11 审计 P3-2）：否则第一次的回落
						 * 会截断第二次的闪现 */
						if (flashTimer) clearTimeout(flashTimer);
						flashTimer = setTimeout(function () { v.textContent = valueText; }, 2000);
					});
				});
				host.appendChild(row);
			}
			ppSection(host, '数据');
			/* 📊 任务周报升格为独立 Tab（11-09）——本区只留导出动作；双行拆分
			 * 恢复 CSV 路径（合并单行时只有 Markdown 能触发） */
			ppFlashRow(host, '📤 导出历史', 'Markdown → 复制到剪贴板', function (flash) {
				if (!history.length) { flash('还没有记录可导出 🐳'); return; }
				/* 剪贴板写入是异步的：闪现必须由真实结果驱动（11-11 审计 P2-3
				 * ——无条件闪「已复制」会在写失败时假成功，而失败气泡在桌宠
				 * 在岗时打进隐藏元素零可见） */
				exportHistory('md', function (ok) { flash(ok ? '✓ Markdown 已复制 📋' : '复制失败 🥲'); });
			});
			ppFlashRow(host, '📤 导出历史', 'CSV → 下载文件', function (flash) {
				if (!history.length) { flash('还没有记录可导出 🐳'); return; }
				exportHistory('csv', function (ok) { if (ok) flash('✓ CSV 已下载 📤'); });
			});
			ppSection(host, '诊断');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			ppRow(host, '🩺 调试模式', debugNow ? '开（取证中）' : '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
				render();
			});
			ppSection(host, '关于');
			/* 版本行（11-11 基线⑫：官方设置页同款「当前版本」；取共享 IIFE
			 * 作用域的 PATCH_VERSION（core/constants.js，build 可覆写）） */
			var about = document.createElement('div');
			about.className = 'dsh-whale-pp-row';
			about.style.cursor = 'default';
			var al = document.createElement('span');
			setIconLabel(al, 'ℹ️ 当前版本');
			var av = document.createElement('span');
			av.className = 'dsh-whale-pp-val';
			av.textContent = '小鲸鱼助手 v' + PATCH_VERSION;
			about.appendChild(al);
			about.appendChild(av);
			host.appendChild(about);
		}
			function renderPet(host) {
				var status = document.createElement('div');
				status.className = 'dsh-whale-pp-status';
				status.textContent = '形态状态读取中…';
				host.appendChild(status);
				var btns = document.createElement('div');
				btns.className = 'dsh-whale-pp-petbtns';
				var FORMS = [['full', '🐋 完整形态'], ['bubble', '🫧 缩成气泡'], ['hidden', '🙈 躲猫猫']];
				var btnMap = {};
				var petEnabled = true; /* /state 返回未启用时按钮置灰+忽略点击 */
				function markForm(form) {
					FORMS.forEach(function (f) {
						if (btnMap[f[0]]) btnMap[f[0]].classList.toggle('on', f[0] === form);
					});
				}
				FORMS.forEach(function (f) {
					var b = document.createElement('button');
					b.className = 'dsh-whale-pp-petbtn';
					b.textContent = f[1];
					b.addEventListener('click', function (event) {
						event.stopPropagation();
						if (!petEnabled) return; /* 未启用：点击无效（主观痛点 10：注定失败的按钮=困惑发生器） */
						try {
							fetch('/api/whale-assistant/pet/ctrl', {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ action: 'form', value: f[0] })
							}).then(function (r) { return r.json(); }).then(function (j) {
								if (j && j.ok && j.pet) {
									markForm(j.pet.form);
									status.textContent = '已切换 ✓（当前形态：' + f[1] + '）';
								} else {
									status.textContent = '切换失败：' + (j && j.error || '未知错误');
								}
							}).catch(function (e) {
								status.textContent = '切换失败：' + (e && e.message || e);
							});
						} catch (e) {
							status.textContent = '切换失败：' + (e && e.message || e);
						}
					});
					btnMap[f[0]] = b;
					btns.appendChild(b);
				});
				host.appendChild(btns);
				var note = document.createElement('div');
				note.className = 'dsh-whale-pp-status';
				note.textContent = '躲猫猫＝游到右下角收成一颗小气泡，点一下气泡随时召回；小鲸鱼跟着 DSH 宿主住，关掉 DSH 才真正退出。';
				host.appendChild(note);
				/* 初始状态：/state 已暴露 pet（enabled/form/up/spawning，lib/index.js） */
				try {
					fetch('/api/whale-assistant/state').then(function (r) {
						return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status));
						}).then(function (j) {
							var pet = j && j.pet;
							markForm(pet && pet.form || 'full');
							if (!pet || !pet.enabled) {
								petEnabled = false;
								FORMS.forEach(function (f) { if (btnMap[f[0]]) btnMap[f[0]].classList.add('off'); });
								status.textContent = '桌面形态未启用（平台不支持）——页内鲸鱼顶班中，形态控制不可用';
							}
							else status.textContent = pet.up ? '小鲸鱼在岗 ✓' : '小鲸鱼暂离——页内鲸鱼顶班中，自愈心跳约 1 分钟内拉回';
						}).catch(function (e) {
						status.textContent = '形态状态读取失败：' + (e && e.message || e);
					});
				} catch (e) {
					status.textContent = '形态状态读取失败：' + (e && e.message || e);
				}
			}
			render();
		}
		/* 📖 使用说明 Tab（11-08 自 openHelp 抽屉迁入；11-13 三层重构——设计者
		 * 视角 9 区 49 条全量平铺 → 纯用户视角「🚀 三步上手 / 🎮 日常操作 /
		 * 🔧 问题排障 / ℹ️ 更多细节」四区 36 条，机制内幕 19 条收进默认折叠
		 * 区）。搜索/折叠/命中高亮/孤头隐藏/折叠记忆/sticky 吸顶全保留；内容
		 * 抽成 PP_MANUAL_DATA 数据数组，渲染器只认数据（解释单源化）。 */
		var ppManualFoldMemo = {};
		var __ppManualResize = null; /* 手册滚动区的 resize 处理器——重复 mount 只留一个存活 */
		/* 手册内容=纯数据（11-13 抽取 / 11-14 文案两行制）。g=编号行（三步
		 * 上手 1-3 / 日常操作手势 1-8，编号两行式），t=词条，d=说明——d 可含
		 * 一个 \n：第一行=主句（一句话说清这件事），第二行=补充说明（次要
		 * 信息），渲染层 pre-line 出两行，搜索高亮/恢复按整串契约不动；
		 * badge/hint=分区头右侧徽标与摘要。
		 * 入口描述与真实入口逐一核对：右键菜单 6 项（⏰ 提醒我 / 声音 /
		 * 🎨 我的装扮 / 📜 历史任务 / ⚙️ 设置 / 🔄 刷新页面，menu.js 11-11
		 * 收口后现状）+ 桌宠窗口缝入的形态三项；侧边栏 4 Tab（TABS 表）。 */
		var PP_MANUAL_DATA = [
			{ sec: '🚀 三步上手', badge: '默认展开', items: [
				{ g: 1, t: '打开菜单', d: '右键小鲸鱼即可打开菜单：提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 刷新页面。\n完整配置页在 DSH 左侧栏「小鲸鱼助手」：设置 / 小鲸鱼形态 / 周报 / 使用说明 四个 Tab。' },
				{ g: 2, t: '看通知、点跳转', d: '任务开始 / 完成 / 需要你操作时，小鲸鱼会响铃 + 冒气泡，双击气泡或通知直接跳到对应对话。\n气泡上的红标数字 = 未读条数：单击读一条，双击全部清空。' },
				{ g: 3, t: '移动与形态', d: '按住鲸鱼拖到喜欢的位置，位置会自动记住。\n侧边栏「🐋 小鲸鱼形态」Tab 或小鲸鱼右键菜单可切换：🐋 完整形态 / 🫧 缩成气泡 / 🙈 躲猫猫。' }
			] },
			{ sec: '🎮 日常操作', hint: '手势 · 通知 · 常用设置', items: [
				{ g: 1, t: '按住拖动：移动我', d: '拖到喜欢的角落，位置会记住。' },
				{ g: 2, t: '左键单击：读通知 / 互动', d: '有未读就逐条读给你，没有未读就陪我聊一句。' },
				{ g: 3, t: '左键双击：游回角落', d: '游回右下角待命，中途可以抓住它。' },
				{ g: 4, t: '双击通知气泡：跳回对话', d: '直达对应对话，并把 DSH 窗口拉到前台。' },
				{ g: 5, t: '单击红标数字：读一条', d: '读过的自动消失，红标 -1。' },
				{ g: 6, t: '双击红标数字：清空全部', d: '所有未读一键清零。' },
				{ g: 7, t: '右键：打开菜单', d: '提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 刷新页面。' },
				{ g: 8, t: '右键双击：摸摸头', d: '好感 +1，还有小心心飘出。' },
				{ t: '通知响了 = 该做什么', d: '✅ 完成 → 双击看结果；❌ 失败 / 截断 → 双击去看原因；❓ 需要你选择 / 🛡 需要你审核 → 只有等你点，双击直达决策处；🌡 上下文压力高 → 该收尾了（/compact）。' },
				{ t: '常用设置在哪', d: '声音 / 音量 / 音色 / 免打扰 / 开工通知 / 导出历史，都在侧边栏「⚙️ 设置」页。\n音色每行 ▶ 试听即点即听、免打扰时段点击循环切换；任务周报有专门的「📊 周报」Tab。' }
			] },
			{ sec: '🔧 问题排障', hint: '4 个常见问题', items: [
				{ t: '没声音？', d: '先查三处：右键菜单 🔊 声音是否开、设置页音量是否拉起、是否正处免打扰时段。\n还不行就点音色行的 ▶ 试听——试听也不响 = 系统音量 / 输出设备问题。' },
				{ t: '通知突然不来了？', d: '多半是页面放久了过期：右键菜单 🔄 刷新页面（浏览器按 Ctrl+F5）即可恢复。\n桌面形态在岗时页内静默是正常的，铃在小鲸鱼那头响。' },
				{ t: '装了新版没变化？', d: '刷新页面就会加载新代码：右键菜单 🔄 或 Ctrl+F5。\n侧边栏页整个消失 = 管理页里插件被停用了，去管理页重新启用。' },
				{ t: '点历史任务没反应？', d: 'DSH 关着时会自动重开窗口并跳转（约几秒）。\n刚重开 DSH 的几十秒内桌面小鲸鱼正在换代，稍等再点。' }
			] },
			{ sec: 'ℹ️ 更多细节（机制内幕）', badge: '默认折叠', hint: '5 组 19 条', items: [
				{ cat: '🐳 它与宿主', t: '我是什么', d: '只读任务事件做播报和记录的打工小鲸鱼——不拦截、不修改任何任务行为，随便折腾不影响工作。' },
				{ t: '常驻与自愈', d: '桌面小鲸鱼跟着 DSH 走，开 DSH 就在（关窗≠退出）；宿主每 30 秒体检，意外消失约 1 分钟内自动重生。' },
				{ t: '设置同步', d: '侧边栏页里改的音色 / 音量 / 免打扰等，约 2 秒内自动下发到桌面的小鲸鱼，不用两边各设。' },
				{ t: '状态与情绪', d: '任务越多越累、会打瞌睡（拖一拖或双击就醒）；右键菜单标题看得到当前心情和进行中任务数。' },
				{ cat: '🔔 通知与红标', t: '红标计数规则', d: '完成 / 失败 / 截断 / 中止 / 提问 / 审核 / 定时提醒计入未读；开工、压力提醒、工具提示不计入，99+ 封顶。' },
				{ t: '定时提醒', d: '右键菜单设的闹钟到点播报；免打扰时段也照常响——自己定的闹钟不受免打扰约束。' },
				{ t: '中止与开工', d: '任务开始只播报、不算未读；手动中止不算失败，但也计入红标。' },
				{ t: '用量面板', d: '完成通知下方同时弹出本次消耗 / 全对话累计 / 上下文占用，与气泡同生同灭。' },
				{ cat: '🛠 盯活与健康', t: '工具超时', d: '工具跑超过设定时长，状态面板逐秒显示「⚠️ 工具已运行 Ns」——只是提醒，不打断任务。' },
				{ t: '压力阈值', d: '上下文占用达到设定百分比提醒 /compact，回降到 50% 以下重新武装。' },
				{ t: '运行状态', d: '鲸鱼自查后台通知 / 用量读取 / 跳转三条链路；出问题头顶亮 ⚠️，点它看是哪条失效。' },
				{ t: '调试模式', d: '排障用：控制台输出调试信息 + 写 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。' },
				{ cat: '📜 历史与数据', t: '历史双存储', d: '历史保留最近 50 条，本地 + 服务器双存储；支持搜索、清空、导出。' },
				{ t: '换浏览器历史还在吗', d: '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份，跨机器不同步。' },
				{ t: '想彻底遗忘某个对话', d: '两步：先清历史、再「清空通讯录」，两步都做才真正遗忘。' },
				{ t: '账本损坏', d: '极少数情况会自动隔离重建，~/.dsh/ 留有 .corrupt-时间戳 备份；想救回：先关 DSH、删掉后缀恢复原名再启动。' },
				{ cat: '🖥 桌面形态', t: '桌面通知同款', d: '桌面小鲸鱼上的通知 / 红标 / 三行用量与页内完全同一套，双击气泡同样跳回对话。' },
				{ t: '怎么"关掉"小鲸鱼', d: '右键 → 🙈 躲猫猫就是它的"关"：桌面只剩一颗小气泡，点一下随时召回；彻底退出关掉 DSH 即可，没有常驻后台进程。' },
				{ t: '摸摸头与装扮', d: '右键双击摸摸头：好感 +1、小心心飘出；完成任务攒进度解锁新装扮（右键菜单 → 🎨 我的装扮 查看）。' }
			] }
		];
		function mountWhaleManualTab(content) {
			/* 固定高度滚动区（用户反馈「点开来突然变大」）：折叠/展开框尺寸
			 * 恒定，内容超出只在区内滚 */
			var wrap = document.createElement('div');
			wrap.className = 'dsh-whale-pp-manual';
			content.appendChild(wrap);
			var mSearch = document.createElement('input');
			mSearch.className = 'dsh-whale-history-search dsh-whale-manual-search';
			mSearch.placeholder = '搜索说明…（如：红标、音色）';
			mSearch.addEventListener('click', function (event) { event.stopPropagation(); });
			wrap.appendChild(mSearch);
			var mStatus = document.createElement('div');
			mStatus.className = 'dsh-whale-manual-status';
			wrap.appendChild(mStatus);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			mSearch.addEventListener('input', function () {
				var q = (mSearch.value || '').trim();
				var rows = list.children;
				var n = 0;
				var first = null;
				/* 搜索先展开全部分区（过滤与折叠共用 display 隐藏，混用会互相
				 * 打架），清空查询后按记忆恢复折叠态 */
				for (var k = 0; k < rows.length; k++) {
					rows[k].classList.remove('dsh-whale-manual-folded');
				}
				if (q) {
					for (var k2 = 0; k2 < manualSecEls.length; k2++) {
						manualSecEls[k2].el.setAttribute('data-folded', '0');
					}
				} else {
					applyManualFolds();
				}
				var secHits = [];
				var catHits = [];
				for (var s2 = 0; s2 < manualSecEls.length; s2++) secHits.push(0);
				for (var c2 = 0; c2 < manualCatEls.length; c2++) catHits.push(0);
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers: visibility handled below（孤头隐藏） */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					/* 分组小标题：不参与逐行命中/恢复，可见性由 catHits 统一裁决 */
					if (el.className.indexOf('dsh-whale-manual-cat') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						if (el._mT) el._mT.textContent = el._mTerm;
						if (el._mD) el._mD.textContent = el._mDesc;
						if (el._mG) el._mG.textContent = el._mTerm;
						/* 通知矩阵逐格恢复（11-13 视觉重构 _mCells 契约：格挂
						 * {el,text} 数组，与 _mT/_mD 同一恢复语义） */
						if (el._mCells) {
							for (var ci = 0; ci < el._mCells.length; ci++) el._mCells[ci].el.textContent = el._mCells[ci].text;
						}
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (rowSection && rowSection[i] >= 0 && rowSection[i] < secHits.length) secHits[rowSection[i]]++;
						/* 行挂 _mCat（渲染循环赋组号）→ 命中计入所属组 */
						if (el._mCat !== undefined && el._mCat >= 0 && el._mCat < catHits.length) catHits[el._mCat]++;
						if (el._mG) {
							highlightAll(el._mG, el._mTerm, q);
							/* 11-13 编号行带说明行：说明同样参与命中高亮 */
							if (el._mD) highlightAll(el._mD, el._mDesc, q);
						} else {
							if (el._mT) highlightAll(el._mT, el._mTerm, q);
							if (el._mD) highlightAll(el._mD, el._mDesc, q);
						}
						/* 通知矩阵逐格命中高亮（mark 逻辑同一套 highlightAll） */
						if (el._mCells) {
							for (var cj = 0; cj < el._mCells.length; cj++) highlightAll(el._mCells[cj].el, el._mCells[cj].text, q);
						}
						if (!first) first = el;
					}
				}
				/* 搜索时隐藏零命中分区头（消孤头）；空查询全恢复 */
				for (var s3 = 0; s3 < manualSecEls.length; s3++) {
					manualSecEls[s3].el.classList.toggle('dsh-whale-hide', !!q && secHits[s3] === 0);
				}
				/* 分组小标题同款裁决：该组零命中隐藏（消孤组头）；空查询全恢复 */
				for (var c3 = 0; c3 < manualCatEls.length; c3++) {
					manualCatEls[c3].classList.toggle('dsh-whale-hide', !!q && catHits[c3] === 0);
				}
				mStatus.textContent = q ? (n > 0 ? '找到 ' + n + ' 条相关内容' : '未找到相关内容 🔍') : '';
				if (first && typeof first.scrollIntoView === 'function') {
					first.scrollIntoView({ block: 'nearest' });
				}
			});
			var manualSecEls = [];
			function applyManualFolds() {
				for (var i = 0; i < manualSecEls.length; i++) {
					var s = manualSecEls[i];
					/* 默认目录态=「🚀 三步上手」首开即展（主观痛点 6：置顶但折叠
					 * =对新手没置顶；11-13 重构沿用，仅随分区改名），其余三层全
					 * 折叠——机制内幕收进默认折叠区。用户点过的记住其选择 */
					var memoV = ppManualFoldMemo[s.title];
					var folded = memoV === undefined ? s.title !== '🚀 三步上手' : memoV !== false;
					s.el.setAttribute('data-folded', folded ? '1' : '0');
					var end = i + 1 < manualSecEls.length ? manualSecEls[i + 1].start : list.children.length;
					for (var j = s.start + 1; j < end; j++) {
						list.children[j].classList.toggle('dsh-whale-manual-folded', folded);
					}
				}
			}
			function highlightAll(el, text, q) {
				if (!q) { el.textContent = text; return; }
				var lower = (text || '').toLowerCase();
				var ql = q.toLowerCase();
				el.textContent = '';
				var i = 0;
				for (;;) {
					var hitAt = lower.indexOf(ql, i);
					if (hitAt < 0) {
						el.appendChild(document.createTextNode((text || '').slice(i)));
						break;
					}
					if (hitAt > i) el.appendChild(document.createTextNode(text.slice(i, hitAt)));
					var mk = document.createElement('mark');
					mk.textContent = text.substr(hitAt, q.length);
					el.appendChild(mk);
					i = hitAt + q.length;
				}
			}
			var sec = function (t, badge, hint) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				/* 11-14 卡片化重构：标题收进独立 span——分区头升级为 44px 卡片
				 * 头行（15px/600 主层级），右侧徽标/摘要 + ::after 圆形 chevron
				 * 由注入 CSS 排到行尾（CSS 旋转指示折叠态） */
				var ts = document.createElement('span');
				ts.className = 'dsh-whale-manual-sec-t';
				ts.textContent = t;
				el.appendChild(ts);
				/* 分区头右侧徽标/摘要（11-13 三层重构）：折叠分区在收起态也能
				 * 一眼看到里面装了什么；flex 布局由注入 CSS 追加规则接管 */
				if (badge) {
					var bd = document.createElement('span');
					bd.className = 'dsh-whale-manual-badge';
					bd.textContent = badge;
					el.appendChild(bd);
				}
				if (hint) {
					var ht = document.createElement('span');
					ht.className = 'dsh-whale-manual-hint';
					ht.textContent = hint;
					el.appendChild(ht);
				}
				/* 点击分区头折叠/展开该组：扁平结构不变（行仍是 list 直接
				 * 子元素），搜索断言遍历 children 的契约不破 */
				el.addEventListener('click', function (event) {
					event.stopPropagation();
					ppManualFoldMemo[t] = ppManualFoldMemo[t] === false ? true : false;
					applyManualFolds();
				});
				list.appendChild(el);
				manualSecEls.push({ title: t, el: el, start: list.children.length - 1 });
			};
			var item = function (term, desc, detail) {
				var el = document.createElement('div');
				/* 11-13 视觉重构：主区条目=轻卡片（CSS 接管）；机制内幕区
				 * 条目加 dsh-whale-manual-detail 走无卡片紧凑单行分层 */
				el.className = 'dsh-whale-manual-item' + (detail ? ' dsh-whale-manual-detail' : '');
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				el.appendChild(t);
				if (desc) {
					var d = document.createElement('div');
					d.className = 'dsh-whale-manual-d';
					d.textContent = desc;
					el.appendChild(d);
				}
				/* 原文与节点引用留在行上——搜索高亮/恢复用（mark 拆分文本节点
				 * 后 textContent 仍是原文拼接，锁定断言不受影响） */
				el._mTerm = term;
				el._mDesc = desc || '';
				el._mT = t;
				el._mD = desc ? d : null;
				list.appendChild(el);
			};
			var gesture = function (n, text, desc) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-help-row';
				var num = document.createElement('span');
				num.className = 'dsh-whale-help-num';
				num.textContent = String(n);
				var text2 = document.createElement('span');
				text2.className = 'dsh-whale-help-text';
				text2.textContent = text;
				row.appendChild(num);
				row.appendChild(text2);
				if (desc) {
					/* 11-13 编号两行式：说明行挂在编号行下（复用 manual-d 的
					 * 搜索高亮/恢复契约：_mDesc/_mD 与词条行同构） */
					var d2 = document.createElement('div');
					d2.className = 'dsh-whale-manual-d';
					d2.textContent = desc;
					row.appendChild(d2);
					row._mDesc = desc;
					row._mD = d2;
				}
				row._mTerm = text;
				row._mG = text2;
				list.appendChild(row);
			};
			/* 通知矩阵卡片（11-13 视觉重构，用户批「4 种通知挤成一句长横排」）：
			 * PP_MANUAL_DATA 里该条的 d 是一句长横排（数据一字未改），渲染层
			 * 按用户拍板的四行两列短语转译成 mini 矩阵——左列=状态（panel-text
			 * 色）、右列=动词开头短句（muted 色）。矩阵短语挂 _mCells={el,text}
			 * 数组进搜索契约（highlightAll 会把 grid 压平，单串 _mD 挂点对矩阵
			 * 无意义，由逐格挂点顶上）；_mTerm/_mT 照常在行上，行级命中/隐藏/
			 * 折叠行为与普通条目完全一致 */
			var NOTIFY_DO_MATRIX = [
				['✅ 完成', '双击看结果'],
				['❌ 失败·截断', '双击看原因'],
				['❓🛡 需要你', '双击直达决策处'],
				['🌡 压力高', '该收尾了']
			];
			/* 内嵌参考面板骨架（11-14，用户批「编号节奏之后突然一堆东西堆在
			 * 那里」）：末尾两块参考内容（通知矩阵/常用设置）外层保持卡片
			 * 片段（className 严格不变=测试/搜索契约，样式由注入块的 :has
			 * 定向），内层 dsh-whale-manual-panel 软底内嵌盒+图标圆片——
			 * 与编号条目刻意「另起一格」 */
			var beginRefPanel = function (term, icon) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
				var panel = document.createElement('div');
				panel.className = 'dsh-whale-manual-panel';
				var h = document.createElement('div');
				h.className = 'dsh-whale-manual-panel-h';
				var ico = document.createElement('span');
				ico.className = 'dsh-whale-manual-panel-ico';
				ico.textContent = icon;
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				h.appendChild(ico);
				h.appendChild(t);
				panel.appendChild(h);
				el.appendChild(panel);
				el._mTerm = term;
				el._mT = t;
				return { el: el, panel: panel, t: t };
			};
			var notifyMatrix = function (term, pairs) {
				var built = beginRefPanel(term, '🔔');
				var grid = document.createElement('div');
				grid.className = 'dsh-whale-manual-matrix';
				var cells = [];
				pairs.forEach(function (p) {
					var st = document.createElement('span');
					st.className = 'dsh-whale-manual-mx-s';
					st.textContent = p[0];
					var act = document.createElement('span');
					act.className = 'dsh-whale-manual-mx-a';
					act.textContent = p[1];
					grid.appendChild(st);
					grid.appendChild(act);
					cells.push({ el: st, text: p[0] });
					cells.push({ el: act, text: p[1] });
				});
				built.panel.appendChild(grid);
				built.el._mCells = cells;
				list.appendChild(built.el);
			};
			/* 常用设置在哪（同款内嵌面板，⚙️ 图标头）：两行说明 pre-line
			 * 渲染，_mDesc/_mD 契约与普通条目同构 */
			var refPanel = function (term, desc) {
				var built = beginRefPanel(term, '⚙️');
				if (desc) {
					var d = document.createElement('div');
					d.className = 'dsh-whale-manual-d';
					d.textContent = desc;
					built.panel.appendChild(d);
					built.el._mDesc = desc;
					built.el._mD = d;
				}
				list.appendChild(built.el);
			};
			/* 分组小标题行（11-14 用户批「19 条一排一排不知道从哪看起」）：更多
			 * 细节区按 5 组重排，每组第一条带 cat 字段——渲染层在 detail 条目
			 * 前插一行组头。cat 行是 list 直接子元素但不带 dsh-whale-manual-detail
			 * 类（detail 恰 19 条的测试契约不破），并挂进 manualCatEls 供搜索
			 * 「组内零命中隐藏（消孤组头）、无查询恢复」的可见性裁决 */
			var catRow = function (label) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-cat';
				el.textContent = label;
				list.appendChild(el);
				manualCatEls.push(el);
				el._mCat = manualCatEls.length - 1;
			};
			var manualCatEls = [];
			/* 内容渲染=遍历 PP_MANUAL_DATA（11-13 抽取）：行仍是 list 直接
			 * 子元素，rowSection 分区索引与搜索 children 遍历契约不破。
			 * 11-13 视觉重构：机制内幕区条目走 detail 紧凑行；「通知响了=
			 * 该做什么」按标题识别转译成通知矩阵卡片（数据未动）。
			 * 11-14 分组：catRow 先于组内首条插入组头；curCat 记当前组号，
			 * 渲出的行挂 _mCat 供搜索组计数（-1=不属任何组，前置三区与组内
			 * 命中计数互不干扰） */
			PP_MANUAL_DATA.forEach(function (S) {
				sec(S.sec, S.badge, S.hint);
				var detail = S.sec.indexOf('更多细节') >= 0;
				var curCat = -1;
				S.items.forEach(function (it) {
					if (it.cat) { catRow(it.cat); curCat = manualCatEls.length - 1; }
					if (it.g) gesture(it.g, it.t, it.d);
					else if (it.t === '通知响了 = 该做什么') notifyMatrix(it.t, NOTIFY_DO_MATRIX);
					else if (it.t === '常用设置在哪') refPanel(it.t, it.d);
					else item(it.t, it.d, detail);
					if (curCat >= 0 && list.children.length) list.children[list.children.length - 1]._mCat = curCat;
				});
			});
			wrap.appendChild(list);
			applyManualFolds(); /* 目录态 */
			var rowSection = [];
			var curSec = -1;
			for (var si = 0; si < list.children.length; si++) {
				if (list.children[si].className.indexOf('dsh-whale-manual-sec') === 0) curSec++;
				rowSection.push(curSec);
			}
			/* 高度实测自适应窗口（11-11 用户反馈固定 calc 边界悬空）：滚动区
			 * 底边钉在视口底-24px——边界永远落在窗口范围里，不再悬空 */
			function fitManualHeight() {
				if (typeof wrap.getBoundingClientRect !== 'function') return; /* vm 测试桩 */
				/* 11-11 真机修复轮：滚动容器=页根（pp-host 分层后 content→page
				 * →root）。基准改用容器 clientHeight（比 window.innerHeight 准：
				 * main 区≠整窗，窗窗口模式下旧算法本来就会偏），并用 rect 差值
				 * 消除页面已滚动带来的 top 偏移（切 Tab 时页面可能不在顶部） */
				try {
					var scroller = content.parentNode && content.parentNode.parentNode;
					if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;
					var relTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
					var h = Math.round((scroller.clientHeight || 0) - relTop - 24);
					if (h < 320) h = 320;
					wrap.style.height = h + 'px';
				} catch (e) { /* 桩环境兜底 */ }
			}
			fitManualHeight();
			/* 窗口 resize 后重算（11-11 审计 P3-3：只算一次=窗口变小底边悬出
			 * 视口、变大底部留白）——先摘旧处理器再挂新的；vm 桩无
			 * addEventListener 时跳过 */
			if (typeof window.addEventListener === 'function') {
				if (__ppManualResize) window.removeEventListener('resize', __ppManualResize);
				__ppManualResize = fitManualHeight;
				window.addEventListener('resize', __ppManualResize);
			}
		}
		/* 📊 周报 Tab（11-09 自 openReport 侧抽屉迁入——抽屉/浮层从侧边栏页
		 * 打开会盖住 DSH 侧边栏，全部页内化）。聚合逻辑与旧抽屉逐行同源：
		 * 近 7 天按日聚合 done/fail/killed/ask + tokens。11-13 版式升级（用户
		 * 批准方案）：旧「日期+计数+token 死列表」→ 今日汇总置顶 + 按天折叠
		 * 展开当日会话明细（标题/时刻/轮次/状态 + Σtoken + 当日占比条）+
		 * 会话行点击跳回——openSessionAt(endTime||at 翻页锚点) → 侧栏兜底，
		 * 与历史抽屉完全同链（drawers.js fillHistoryList 行点击）；空日
		 * 「这天没有任务记录」不可展开，空周保留原提示。 */
		var ppReportOpenDays = new Set(); /* 日期折叠展开态：模块级 Set，跨 Tab 切换/重渲存活（ppManualFoldMemo 同思路），默认全收起 */
		function mountWhaleReportTab(content) {
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			function build() {
			list.textContent = ''; /* 重渲前清空——pullCloudHistory 回调二次 build 不叠加（11-11 用户实报双份） */
			var fmtK = function (n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n; };
			var weekAgo = Date.now() - 7 * 864e5;
			var days = {};
			var hasAny = false;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				var at = rec.at || 0;
				if (at < weekAgo) continue;
				hasAny = true;
				var d = new Date(at);
				var key = (d.getMonth() + 1) + '月' + d.getDate() + '日';
				if (!days[key]) days[key] = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0, sessions: {} };
				var b = days[key];
				if (rec.kind === 'done') b.done++;
				else if (rec.kind === 'fail') b.fail++;
				else if (rec.kind === 'killed') b.killed++;
				else if (rec.kind === 'question' || rec.kind === 'approval') b.ask++; /* 计任务数；question/approval 的 turnTokens 为 null，不参与 token 求和 */
				if (rec.turnTokens) b.tokens += rec.turnTokens;
				/* 当日按 sessionId 分组（展开区会话明细行的数据源）。history 新
				 * →旧，组内首见=当日最新记录：标题取最新非「未命名任务」（全
				 * 未命名才回退原样），跳转锚点=最新记录的 endTime||at（多轮组
				 * 用 max 兜住乱序载荷，规范见 11-13 方案第 7 条） */
				var g = b.sessions[rec.sessionId || ''];
				if (!g) g = b.sessions[rec.sessionId || ''] = { n: 0, tokens: 0, hasBad: false, allDone: true, title: '', rawTitle: '', anchor: 0 };
				g.n++;
				if (rec.turnTokens) g.tokens += rec.turnTokens;
				if (rec.kind === 'fail' || rec.kind === 'killed') { g.hasBad = true; g.allDone = false; }
				else if (rec.kind !== 'done') g.allDone = false;
				if (!g.rawTitle) g.rawTitle = rec.title || '';
				if (!g.title && rec.title && rec.title !== '未命名任务') g.title = rec.title;
				var anchor = rec.endTime || rec.at || 0;
				if (anchor > g.anchor) g.anchor = anchor;
			}
			/* 今日汇总行（置顶卡片，沿用 .dsh-whale-report-summary 类名）：
			 * 今天的 key=本地日期；当日无记录也如实显示 0 */
			var now = new Date();
			var todayKey = (now.getMonth() + 1) + '月' + now.getDate() + '日';
			var tb = days[todayKey];
			var sumRow = document.createElement('div');
			sumRow.className = 'dsh-whale-report-summary';
			sumRow.title = '任务数与 token 按日聚合；周报窗口 7 天';
			sumRow.textContent = '今日 ' + todayKey + ' · ✅' + (tb ? tb.done : 0) + ' ❌' + (tb ? tb.fail : 0) + ' ⏹' + (tb ? tb.killed : 0) + ' ❓' + (tb ? tb.ask : 0) + ' · ' + fmtK(tb ? tb.tokens : 0) + ' tok · ' + (tb ? Object.keys(tb.sessions).length : 0) + ' 个对话';
			list.appendChild(sumRow);
			if (!hasAny) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '这 7 天还没有任务记录 🐳';
				list.appendChild(empty);
				return;
			}
			/* 每天一行（折叠头）：固定渲染窗口内 7 个本地日历日（今天起倒序，
			 * 按本地日期分量倒推——864e5 毫秒减法跨夏令时会日期漂移）。空日
			 * 「这天没有任务记录」：无箭头、不可展开、cursor:default */
			for (var dd = 0; dd < 7; dd++) {
				var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dd);
				var dkey = (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
				var db = days[dkey];
				var head = document.createElement('div');
				head.className = 'dsh-whale-rep-day' + (db ? '' : ' dsh-whale-rep-day-empty');
				head.title = '会话 token=当日该会话各轮消耗之和（turnTokens 口径）';
				var left = document.createElement('span');
				left.className = 'dsh-whale-rep-day-left';
				var right = document.createElement('span');
				right.className = 'dsh-whale-rep-day-right';
				if (!db) {
					left.textContent = dkey;
					right.textContent = '这天没有任务记录';
					head.appendChild(left);
					head.appendChild(right);
					list.appendChild(head);
					continue;
				}
				var open = ppReportOpenDays.has(dkey);
				var parts = [];
				if (db.done) parts.push('✅' + db.done);
				if (db.fail) parts.push('❌' + db.fail);
				if (db.killed) parts.push('⏹' + db.killed);
				if (db.ask) parts.push('❓' + db.ask);
				right.textContent = parts.join(' ') + (db.tokens ? ' · ' + fmtK(db.tokens) + ' tok' : '');
				left.textContent = (open ? '▾ ' : '▸ ') + dkey + ' · ' + Object.keys(db.sessions).length + ' 个对话';
				head.appendChild(left);
				head.appendChild(right);
				/* 整行点击切换展开/收起：重建整列表（build 开头已清空），展开
				 * 态从模块级 Set 读回——跨 Tab 切换/重渲存活 */
				head.addEventListener('click', (function (k) {
					return function (event) {
						event.stopPropagation();
						if (ppReportOpenDays.has(k)) ppReportOpenDays.delete(k);
						else ppReportOpenDays.add(k);
						build();
					};
				})(dkey));
				list.appendChild(head);
				if (!open) continue;
				/* 展开区：当日会话明细行，按组内最新活动倒序 */
				var sids = Object.keys(db.sessions);
				sids.sort(function (x, y) { return (db.sessions[y].anchor || 0) - (db.sessions[x].anchor || 0); });
				sids.forEach(function (sid) {
					var g2 = db.sessions[sid];
					var title2 = g2.title || g2.rawTitle || '（未命名）';
					var ad = new Date(g2.anchor || 0);
					var label = g2.hasBad ? '❌ 失败' : (g2.allDone ? '✅ 完成' : '混合');
					var pct = db.tokens > 0 ? Math.round(g2.tokens / db.tokens * 100) : 0;
					var srow = document.createElement('div');
					srow.className = 'dsh-whale-rep-srow';
					var main = document.createElement('div');
					main.className = 'dsh-whale-rep-smain';
					var st = document.createElement('div');
					st.className = 'dsh-whale-rep-stitle';
					st.textContent = title2;
					var sm = document.createElement('div');
					sm.className = 'dsh-whale-rep-smeta';
					sm.textContent = (ad.getHours() < 10 ? '0' : '') + ad.getHours() + ':' + (ad.getMinutes() < 10 ? '0' : '') + ad.getMinutes() + ' · ' + g2.n + ' 轮 · ' + label;
					main.appendChild(st);
					main.appendChild(sm);
					var sright = document.createElement('div');
					sright.className = 'dsh-whale-rep-sright';
					var stok = document.createElement('div');
					stok.className = 'dsh-whale-rep-stok';
					stok.textContent = fmtK(g2.tokens) + ' tok';
					var share = document.createElement('div');
					share.className = 'dsh-whale-rep-share';
					var bar = document.createElement('div');
					bar.className = 'dsh-whale-rep-bar';
					var fill = document.createElement('div');
					fill.className = 'dsh-whale-rep-fill';
					fill.style.width = pct + '%';
					bar.appendChild(fill);
					var pctEl = document.createElement('span');
					pctEl.className = 'dsh-whale-rep-pct';
					pctEl.textContent = '当日占比 ' + pct + '%';
					share.appendChild(bar);
					share.appendChild(pctEl);
					sright.appendChild(stok);
					sright.appendChild(share);
					srow.appendChild(main);
					srow.appendChild(sright);
					/* 与历史抽屉行点击完全同链（drawers.js 147-151）：带锚点直开
					 * →侧栏按 id →侧栏按标题；全失败给刷新提示 */
					srow.addEventListener('click', (function (sid2, anchor2, t2) {
						return function (event) {
							event.stopPropagation();
							if (openSessionAt(sid2, anchor2) || openViaSidebarById(sid2) || openViaSidebarByTitle(t2)) {
								uiSay('正在跳转到该对话… 🐳', 1500, sid2);
								return;
							}
							uiSay('跳转失败：右键菜单 🔄 刷新页面后重试（浏览器可按 Ctrl+F5）🥲', 3000, sid2);
						};
					})(sid, g2.anchor, title2));
					list.appendChild(srow);
				});
			}
			}
			/* 报告卡片化（用户反馈「这是搞的啥」：旧列表裸奔在页面背景上） */
			var card = document.createElement('div');
			card.className = 'dsh-whale-pp-report';
			card.appendChild(list);
			content.appendChild(card);
			build();
			/* warm: merge records saved by other windows（vm/离线静默降级）——
			 * 合并完成后重渲一次，首开即见其他窗口保存的记录 */
			try { pullCloudHistory(function () { build(); }); } catch (e) { /* offline */ }
		}
		window.__dshWhalePanel = { mount: mountWhalePanelPage };
/* ---- module: src/input/swim.js ---- */
		/* --- swim-back animation (directional, with ripple trail) --- */
		var swim = null;

		function cancelSwim() {
			if (!swim) return false;
			swim = null;
			whale.classList.remove('dsh-whale-swimming');
			if (figure) {
				figure.style.transition = 'none';
				figure.style.transform = '';
			}
			return true;
		}

		function finishSwim() {
			/* capture BEFORE nulling: the peek dive flips the completion path */
			var petPeek = !!(swim && swim.petPeek);
			var peekCb = (swim && swim.peekCb) || null;
			swim = null;
			whale.classList.remove('dsh-whale-swimming');
			/* ease the figure back to the logo orientation */
			if (figure) {
				figure.style.transition = 'transform 0.25s ease';
				figure.style.transform = '';
				setTimeout(function () {
					if (figure) figure.style.transition = 'none';
				}, 300);
			}
			/* arrival splash: flowing-water burst + a little bounce。
			 * petPeek 到达不撒水花不扭动：主体随即收成小气泡——只做安静落定。 */
			if (!petPeek) {
				var w = whale.offsetWidth;
				var h = whale.offsetHeight;
				spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
				whale.classList.add('dsh-whale-splash');
				setTimeout(function () {
					whale.classList.remove('dsh-whale-splash');
				}, 600);
				wiggle();
			}
			updateStatusPos();
			/* 桌宠常驻（第九轮用户定稿）：没有进入/退出交接，只有躲猫猫潜入。
			 * 页内双击回游维持随机到达台词。 */
			if (petPeek) {
				/* 躲猫猫到达右下角：静默（主体随即收成小气泡），写回落点并回调
				 * 页面（收鲸鱼、显小气泡） */
				try { savePos(); } catch (e) {}
				if (peekCb) peekCb();
			} else {
				uiSay(ARRIVAL_LINES[Math.floor(Math.random() * ARRIVAL_LINES.length)]);
			}
		}

		function swimFrame(now) {
			var s = swim;
			if (!s) return;
			var t = Math.min(1, (now - s.start) / s.duration);
			var e = easeInOutCubic(t);
			var p = bezierPoint(s, e);
			whale.style.left = p.x + 'px';
			whale.style.top = p.y + 'px';
			var phi = bezierHeading(s, e);
			/* sine sway on top of the true heading */
			var sway = Math.sin(now / 110) * 5;
			if (figure) {
				figure.style.transform = 'rotate(' + (phi + sway) + 'deg) scaleX(-1)';
			}
			/* keep an open status panel on-screen while swimming */
			updateStatusPos();
			/* water trail from the (mirrored) tail */
			if (now - s.lastRipple > 55) {
				s.lastRipple = now;
				spawnRipple(p.x + TAIL_X, p.y + TAIL_Y);
				var behind = bezierPoint(s, Math.max(0, e - 0.06));
				spawnRipple(behind.x + TAIL_X, behind.y + TAIL_Y, 8);
			}
			if (t < 1) {
				requestAnimationFrame(swimFrame);
				return;
			}
			finishSwim();
		}

		/** Shared swim core: bezier arc from the whale's CURRENT position to
		 * (x1, y1) with the ripple trail + arrival splash. opts.petPeek marks
		 * the hide-into-bubble dive (silent arrival + done callback).
		 * swimToCorner keeps its exact historical semantics (POS removal +
		 * bottom-right); tests drive this shape. */
		function startSwim(x1, y1, opts) {
			var x0 = whale.offsetLeft;
			var y0 = whale.offsetTop;
			if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return false;
			/* gentle arc: control point bulges toward the upper-left of travel */
			var dx = x1 - x0;
			var dy = y1 - y0;
			var len = Math.sqrt(dx * dx + dy * dy) || 1;
			var nx = -dy / len;
			var ny = dx / len;
			var bulge = Math.min(140, len * 0.28);
			cancelSwim();
			whale.style.transition = 'none';
			whale.classList.add('dsh-whale-swimming');
		swim = {
			x0: x0,
			y0: y0,
			cx: (x0 + x1) / 2 + nx * bulge,
			cy: (y0 + y1) / 2 + ny * bulge,
			x1: x1,
			y1: y1,
			start: performance.now(),
			/* leisurely pace so the swim can be interrupted by grabbing it */
			duration: Math.max(900, Math.min(2600, 500 + len * 1.4)),
			lastRipple: 0,
			petPeek: !!(opts && opts.petPeek),
			peekCb: (opts && typeof opts.peekCb === 'function') ? opts.peekCb : null
		};
			requestAnimationFrame(swimFrame);
			return true;
		}

		/** Animated directional swim back to the default corner. */
		function swimToCorner() {
			closeCtxFloats(); /* swimming away closes any open float */
			var x1 = window.innerWidth - whale.offsetWidth - DEFAULT_RIGHT;
			var y1 = window.innerHeight - whale.offsetHeight - DEFAULT_BOTTOM;
			safeRemove(POS_KEY);
			if (reducedMotion()) {
				applyPos(x1, y1);
				return;
			}
			startSwim(x1, y1);
		}

		/** 桌宠入场（第九轮用户定稿：桌宠常驻，无进入/退出交接）——PET_MODE
		 * 下 uiInit 的 loadPos 已把鲸鱼放回家（上次落点），这里只做两件事：
		 * 恢复透明度（pet 页 CSS opacity 0→1 淡入，首建区域的 DWM re-clip 帧
		 * 藏进淡入段）+ 立 entranceReady（页面从此才发首帧区域+ready 握手，
		 * 页鲸让位仲裁照旧）。鲸鱼开机即在家里，没有跨窗口交接=闪现无从谈起。 */
		function petEntranceSwim() {
			if (!whale) return;
			try { whale.style.opacity = '1'; } catch (e) {}
			try { if (window.__dshPetHost) window.__dshPetHost.entranceReady = true; } catch (e) {}
		}
		/** 躲猫猫潜入（用户定稿 11-02）：「隐藏小鲸鱼」=鲸鱼游到桌面右下角钻进
		 * 角落，到达回调页面（收鲸鱼、在原位弹出小气泡）。到达静默——主体
		 * 随即收起。 */
		function peekHide(done) {
			if (!whale) { if (done) done(); return; }
			closeCtxFloats();
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			var x1 = window.innerWidth - w - DEFAULT_RIGHT;
			var y1 = window.innerHeight - h - DEFAULT_BOTTOM;
			x1 = Math.max(0, Math.min(x1, window.innerWidth - w));
			y1 = Math.max(0, Math.min(y1, window.innerHeight - h));
			var fire = function () {
				try { savePos(); } catch (e) {}
				if (done) done();
			};
			if (reducedMotion() || !startSwim(x1, y1, { petPeek: true, peekCb: fire })) {
				applyPos(x1, y1);
				fire();
			}
		}

		/** 躲猫猫跳出（小气泡单击）：鲸鱼在气泡处现身——弹跳+水花+台词，
		 * 落点写回（下次开机从这起）。display 恢复由页面负责（peekShow 只管
		 * 鲸鱼自己的 choreography）。 */
		function peekShow() {
			if (!whale) return;
			try {
				whale.classList.add('dsh-whale-bounce');
				setTimeout(function () { try { whale.classList.remove('dsh-whale-bounce'); } catch (e2) {} }, 600);
			} catch (e3) {}
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
			whale.classList.add('dsh-whale-splash');
			setTimeout(function () { try { whale.classList.remove('dsh-whale-splash'); } catch (e4) {} }, 600);
			wiggle();
			uiSay('我回来啦 🐋', 3200);
			try { savePos(); } catch (e5) {}
		}
		if (typeof window !== 'undefined' && window.__dshWhale) {
			window.__dshWhale.peekHide = peekHide;
			window.__dshWhale.peekShow = peekShow;
		}

/* ---- module: src/input/drag.js ---- */
		/* --- dragging (pointer events, click suppressed after a move) --- */
		var drag = null;
		var clickTimer = null;
		var caughtFlag = false;

		/** Quick trembling shake of the whale's body (used when caught). */
		function caughtShake() {
			if (!figure) return;
			var poses = ['rotate(-6deg)', 'rotate(5deg)', 'rotate(-4deg)', 'rotate(3deg)', ''];
			var i = 0;
			var shakeStep = function () {
				if (i >= poses.length) return;
				figure.style.transition = 'transform 0.08s ease';
				figure.style.transform = poses[i++];
				setTimeout(shakeStep, 80);
			};
			shakeStep();
		}

		whale.addEventListener('pointerdown', function (event) {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			/* the first interaction also unlocks the audio context */
			ensureAudio();
			/* touching the whale closes any open float immediately */
			closeCtxFloats();
			/* grabbing mid-swim: catch feedback (bubble + splash + shake) */
			var caught = cancelSwim();
			caughtFlag = false;
			if (caught) {
				caughtFlag = true;
				uiSay(pickCatchLine(), 2600);
				spawnWaterSplash(
					whale.offsetLeft + whale.offsetWidth / 2,
					whale.offsetTop + whale.offsetHeight * 0.8,
					2, 0, 6
				);
				caughtShake();
			}
			drag = {
				id: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				left: whale.offsetLeft,
				top: whale.offsetTop,
				moved: false
			};
			try {
				whale.setPointerCapture(event.pointerId);
			} catch (error) {
				/* unsupported */
			}
			whale.classList.add('dsh-whale-dragging');
		});

		whale.addEventListener('pointermove', function (event) {
			if (!drag || drag.id !== event.pointerId) return;
			var dx = event.clientX - drag.startX;
			var dy = event.clientY - drag.startY;
			if (Math.abs(dx) + Math.abs(dy) > 4) {
				if (!drag.moved) touchActivity(); /* starting to drag wakes the whale */
				drag.moved = true;
			}
			if (drag.moved) {
				applyPos(drag.left + dx, drag.top + dy);
				/* re-flow the open status panel live while dragging, so it
				 * never runs off the viewport edge */
				updateStatusPos();
			}
		});

		function finishDrag(event) {
			if (!drag || drag.id !== event.pointerId) return false;
			var moved = drag.moved;
			drag = null;
			whale.classList.remove('dsh-whale-dragging');
			if (moved) {
				savePos();
				updateStatusPos();
			}
			return moved;
		}

		whale.addEventListener('pointerup', function (event) {
			/* only the left button interacts (right-click is reserved) */
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			if (finishDrag(event)) return;
			/* a catch already gave its feedback; don't overwrite with a click summary */
			if (caughtFlag) {
				caughtFlag = false;
				return;
			}
			/* click: delay briefly so a double-click can cancel it */
			if (clickTimer) {
				clearTimeout(clickTimer);
				clickTimer = null;
				return;
			}
			clickTimer = setTimeout(function () {
				clickTimer = null;
				spawnRipple(event.clientX, event.clientY); /* click-confirmed halo (#13) */
				wiggle();
				/* an explicit click on the whale closes open floats */
				closeCtxFloats();
				if (asleep) {
					/* napping: a click gets a sleepy mumble, no wake-up */
					uiSay('呼… Zzz 别吵我 🥱', 2000);
					return;
				}
				if (readNext()) return;
				/* nothing new to read: if a read is still displayed, finish it now,
				 * so a lingering badge "1" clears on the next click */
				if (reading) {
					clearTimeout(readTimer);
					reading = null;
					renderUnread();
				}
				uiSay(clickSummary());
			}, 260);
		});

		whale.addEventListener('pointercancel', function (event) {
			finishDrag(event);
			caughtFlag = false;
		});

		whale.addEventListener('dblclick', function (event) {
			if (clickTimer) {
				clearTimeout(clickTimer);
				clickTimer = null;
			}
			/* a double-click whose presses land ON the bubble (or drift a
			 * few pixels onto the whale) jumps to that conversation — the
			 * bubble is an independent surface, never the whale's body */
			var onBubble = false;
			var t = event && event.target;
			if (t && t !== whale && bubble.contains(t)) onBubble = true;
			if (!onBubble && event && typeof event.clientX === 'number') {
				onBubble = inBubbleRect(event.clientX, event.clientY);
			}
			if (onBubble) {
				jumpToBubbleSession();
				return;
			}
			/* swimming away also closes any open float (menu/wardrobe/help/
			 * history/settings) so the UI never leaves an orphaned drawer */
			closeCtxFloats();
			touchActivity(); /* double-clicking to swim wakes the whale */
			swimToCorner();
		});

		/* no hover tooltip (user request): the native title flashed its
		 * gesture list on every accidental hover — the same list now lives
		 * in the 右键菜单 → 📖 使用说明 drawer (menu.js openHelp) */

		loadPos();

		/* 桌宠入场（第一批）：PET_MODE 下落位后同步执行——首帧即画在「落点
		 * 向屏幕中心回拉」的拉入位，随后游向最近边缘（弧线+涟漪+到达水花+
		 * 引导台词），uiInit 同步无跳变。见 swim.js petEntranceSwim。 */
		if (PET_MODE) {
			try { petEntranceSwim(); } catch (e) {}
		}

		/* nap timer starts at page load: 5 idle minutes -> sleep
		 * (defensive clear: drag.js must never leave a stale timer around —
		 * the shared sleepTimer var belongs to core/sleep.js) */
		clearTimeout(sleepTimer);
		sleepTimer = setTimeout(goSleep, sleepMsOverride || SLEEP_AFTER_MS);

		/* diagnostic seam for tests */
		window.__dshWhale.swimToCorner = swimToCorner;
		window.__dshWhale.swimState = function () {
			return swim;
		};
		window.__dshWhale.whale = whale;
		window.__dshWhale.openCtxMenu = openCtxMenu;
		window.__dshWhale.petWhale = petWhale;
		window.__dshWhale.ctxMenuOpen = function () {
			return !!(ctxMenu && ctxMenu.classList.contains('show'));
		};
		window.__dshWhale.ctxMenuEl = function () {
			return ctxMenu;
		};
		window.__dshWhale.panelOpen = function () {
			return !!(ctxPanel && ctxPanel.classList.contains('show'));
		};
		window.__dshWhale.panelEl = function () {
			return ctxPanel;
		};
		window.__dshWhale.openHistory = openHistory;
		/* openSettings export retired (11-08): the drawer is gone — settings
		 * live on the sidebar page (panel-page.js via window.__dshWhalePanel) */
		window.__dshWhale.openReminders = openReminders;
		/* reminder fire loop seam (回归 11-14): due-consume + triple chime */
		window.__dshWhale._fireReminders = fireDueReminders;
		window.__dshWhale.openHealthPanel = openHealthPanel;
		/* heart spawner lives in the uiInit closure — mood.js idle hearts and
		 * milestone celebrations reach it through this seam */
		window.__dshWhale.spawnHearts = spawnHearts;
		window.__dshWhale.CONFIG = CONFIG;
		window.__dshWhale.historyList = function () {
			return history;
		};
		window.__dshWhale.pushHistory = pushHistory;
		window.__dshWhale.getClearAt = getClearAt;
		window.__dshWhale.bumpClearAt = bumpClearAt;
		window.__dshWhale.drawerOpen = function () {
			return !!(ctxHistory && ctxHistory.classList.contains('show'));
		};
		window.__dshWhale.drawerEl = function () {
			return ctxHistory;
		};

		/* drain messages queued before the UI was ready */
		pendingSay.forEach(function (message) {
			uiSay(message.text, message.duration, message.sessionId);
		});
		pendingSay = [];
		renderUnread();
	}
/* ---- module: src/ui/session-jump.js ---- */
/** Session jump (inline module): open a conversation in the DSH UI and,
 * when a target moment (atMs) is given, page the conversation log backwards
 * until the rendered message stamps cover that moment (or the whole log is
 * in memory), then scroll the closest older stamp into view.
 *
 * 0.4.0 provenance: this logic used to be INJECTED into the official
 * conversation client by apply-plugin-hook.ps1 (globalThis.__dshOpenSession).
 * It now runs in the plugin: the client-module bridge (whale-assistant/
 * client.js apply → ctx.inject(['sessions'])) hands us the very same
 * sessions service through official channels, so no DSH file is ever
 * modified and DSH upgrades can never wipe it. Fallback when the bridge is
 * missing (old host / exotic builds): sidebar row click — opens the
 * conversation without moment positioning (openViaSidebarByTitle). */

var jumpSessions = null; /* 0.1.x sessions service via the bridge (has .open) */
var jumpUiWorkspace = null; /* 0.2.0 uiWorkspace service face via the bridge (has .openSession) */
var jumpRunSeq = 0; /* supersede counter: a newer jump cancels the paging loop */

/** Wire the services in (called by the client-module bridges, or at boot when
 * a bridge stashed its face before whale eval). Idempotent and ADDITIVE: each
 * bridge callback delivers only ITS services, so an argument that is absent
 * must never clear a binding another callback already made. */
function bindJumpSessions(sessions, conversation, uiWorkspace) {
	if (sessions && typeof sessions.open === 'function') jumpSessions = sessions;
	if (uiWorkspace && typeof uiWorkspace.openSession === 'function') jumpUiWorkspace = uiWorkspace;
}

/** True once any jump path is bridged (health jump item + callers). */
function jumpReady() {
	return !!(jumpSessions || jumpUiWorkspace);
}

/** Parse a rendered message stamp into ms epoch; null when not a stamp.
 * Layouts: M月D日 HH:MM · M/D HH:MM · YYYY-M-D HH:MM · HH:MM · Mon D, HH:MM.
 * Pure — exported for tests. */
function parseStamp(text) {
	var m = text.match(/(\d{1,2})\u6708(\d{1,2})\u65e5\s*(\d{1,2}):(\d{2})/);
	if (!m) m = text.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
	if (m) {
		var now = new Date();
		var d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
		if (d.getTime() > Date.now() + 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2], +m[3], +m[4]);
		return d.getTime();
	}
	m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
	if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
	m = text.match(/^(\d{1,2}):(\d{2})$/);
	if (m) { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), +m[1], +m[2]).getTime(); }
	m = text.match(/([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{1,2}):(\d{2})/);
	if (m) {
		var names = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
		var mo = names[m[1].slice(0, 3).toLowerCase()];
		if (mo !== void 0) {
			var n2 = new Date();
			var d2 = new Date(n2.getFullYear(), mo, +m[2], +m[3], +m[4]);
			if (d2.getTime() > Date.now() + 864e5) d2 = new Date(n2.getFullYear() - 1, mo, +m[2], +m[3], +m[4]);
			return d2.getTime();
		}
	}
	return null;
}

/** Open the session and (with atMs) page back to it. Returns true when the
 * jump was initiated via the bridge; false lets callers fall back to the
 * sidebar. A newer call supersedes a still-running paging loop.
 *
 * Two bridge shapes (第35章九):
 * - 0.1.x: sessions.open(sessionId, atMs) — service-level open.
 * - 0.2.0: uiWorkspace.openSession(sessionId) — the SAME call the sidebar's
 *   row click makes (onOpen → openSession → replaceMain(id, signal, "reveal"):
 *   switches the main view AND reveals the row in the sidebar). The moment
 *   paging below is DOM-based and engine-agnostic, so it rides on either. */
function openSessionAt(sessionId, atMs) {
	if (!sessionId) return false;
	/* 同会话跳转跳过 open（11-06 真机破案）：dispatch 验证 45s 内 ~30 次翻页
	 * 点击全被 openSession 的异步 replaceMain 重渲染覆盖丢弃（点击落在过渡
	 * 视图上），页面静止后手工同款 onClick 一次生效——open() 对「当前已打开
	 * 的会话」本来就是 no-op 切换，跳过它翻页点击直接落在稳定视图上。 */
	var activeNow = null;
	try { activeNow = (typeof resolveCurrentSessionId === 'function') ? resolveCurrentSessionId() : null; } catch (e) { activeNow = null; }
	var sameSession = !!activeNow && activeNow === sessionId;
	/* 异会话的 open settle 权威信号（11-06 二轮，用户实报「有一些历史行
	 * 只能跳到对话」）：同会话已 skip open；异会话必须 open——但 replaceMain
	 * 的异步重渲染会把翻页点击整个覆盖丢弃（真机实锤同会话竞态，异会话
	 * 同病且更重=历史行大多是异会话）。session 面的 openPromise 是官方
	 * settle 信号：resolve 前循环只观察不点击，resolve 后点击才落在稳定
	 * 视图上。桥拿不到（老引擎/形状变化）时立即放行（12s 无进展兜底）。 */
	var openSettled = sameSession;
	if (!sameSession) {
		try {
			var uwS = jumpUiWorkspace && jumpUiWorkspace.sessions;
			var uwScope = uwS && uwS.scopes && typeof uwS.scopes.get === 'function' ? uwS.scopes.get(sessionId) : null;
			var uwSession = uwScope && uwScope.session;
			if (uwSession && uwSession.openPromise && typeof uwSession.openPromise.then === 'function') {
				uwSession.openPromise.then(function () { openSettled = true; }, function () { openSettled = true; });
			} else {
				openSettled = true;
			}
		} catch (e) { openSettled = true; }
	}
	if (!sameSession) {
		if (jumpSessions && typeof jumpSessions.open === 'function') {
			try {
				/* atMs forwarded on the call surface (same 2-arg shape as the old
				 * hook) for observability; the REAL anchor consumer is the paging
				 * loop below — the official open() ignores the extra arg */
				jumpSessions.open(sessionId, atMs);
			} catch (e) {
				return false; /* open failed: callers fall back to the sidebar */
			}
		} else if (jumpUiWorkspace && typeof jumpUiWorkspace.openSession === 'function') {
			try {
				jumpUiWorkspace.openSession(sessionId);
			} catch (e) {
				return false; /* open failed: callers fall back to the sidebar */
			}
		} else {
			return false; /* no bridge bound */
		}
	}
	/* 每窗口归属（P1 2026-10-28）：本窗口主动打开的会话直接钉进本窗口 pin
	 * （utils/session-key.js）——跳转是归属最确定的一手信号 */
	pinWindowSession(sessionId);
	if (!atMs) return true;
	var run = (jumpRunSeq = jumpRunSeq + 1);
	var pages = 0, paged = false, done = false, stampMode = "";
	var inFlight = 0;
	var t0 = Date.now();
	function stampEls() {
		var root = document.querySelector("[data-chat-flow]");
		if (!root) return [];
		if (stampMode === "") {
			var quick = root.querySelectorAll('[class*="timeStart"]');
			if (quick.length) { stampMode = "class"; return quick; }
			stampMode = "walk";
		}
		if (stampMode === "class") return root.querySelectorAll('[class*="timeStart"]');
		/* fallback: leaf elements whose whole text parses as a stamp */
		var all = root.querySelectorAll("*"), out = [];
		for (var i = 0; i < all.length; i++) {
			if (all[i].children.length) continue;
			var t = (all[i].textContent || "").trim();
			if (!t || t.length > 16) continue;
			if (parseStamp(t) !== null) out.push(all[i]);
		}
		return out;
	}
	function stampMs(el) { return parseStamp((el.textContent || "").trim()); }
	/** oldest already-rendered stamp in ms, or null when nothing renders yet */
	function renderedOldestMs() {
		var list = stampEls();
		var oldest = null;
		for (var i = 0; i < list.length; i++) {
			var ms = stampMs(list[i]);
			if (ms === null) continue;
			if (oldest === null || ms < oldest) oldest = ms;
		}
		return oldest;
	}
	/** the「加载更早」pager button element, or null. The pager node EXISTS
	 * while older history remains — its label flips to a loading text
	 * mid-flight, so match the node, not the text. */
	function findOlderButton() {
		var root = document.querySelector("[data-chat-flow]");
		if (root) {
			var b = root.querySelector('[class*="older"] button');
			if (b) return b;
		}
		var btns = document.querySelectorAll("button");
		for (var i = 0; i < btns.length; i++) {
			var t = (btns[i].textContent || "").trim();
			if (t.indexOf("\u52a0\u8f7d") === 0 || /^load/i.test(t)) return btns[i];
		}
		return null;
	}
	function hasMoreNode() { return !!findOlderButton(); }
	/** Fire the pager's React onClick directly (props live on the
	 * __reactProps$ key): el.click() does NOT reach React's handler on this
	 * DSH build — 真机实拍 11-06：三次测试 stamps 恒 56 直到 props-onClick
	 * 触发（56→64）——合成 .click() 在该按钮上是死的。回退=完整
	 * pointer/mouse 事件序列。 */
	function clickOlderButton(btn) {
		try {
			var k = Object.keys(btn).find(function (key) { return key.indexOf('__reactProps$') === 0; });
			if (k && btn[k] && typeof btn[k].onClick === 'function') {
				btn[k].onClick({ preventDefault: function () {}, stopPropagation: function () {} });
				return true;
			}
		} catch (e) { /* fall through to the sequence */ }
		try {
			['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
				var E = t.indexOf('pointer') === 0 ? (window.PointerEvent || MouseEvent) : MouseEvent;
				btn.dispatchEvent(new E(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
			});
			return true;
		} catch (e) { return false; }
	}
	function finish() {
		if (done) return;
		done = true;
		/* Re-entrant placement: a CROSS-SESSION jump re-renders the whole
		 * flow after open() settles — React mounts the list and resets
		 * scroll to the tail, wiping a single early placement. Re-find the
		 * target (re-query keeps it connected) and re-assert while the view
		 * settles. */
		function place() {
			var best = null, top = null;
			var list = stampEls();
			for (var i = 0; i < list.length; i++) {
				var ms = stampMs(list[i]);
				if (ms === null) continue;
				if (top === null || ms < top.ms) top = { el: list[i], ms: ms };
				if (ms <= atMs && (best === null || ms > best.ms)) best = { el: list[i], ms: ms };
			}
			var target = best || top;
			if (!target) return;
			/* the chat column's own scroll element has overflow:visible — the
			 * REAL scroller is the nearest ancestor with a scrollable
			 * overflowY, so scroll that one directly (rect-delta math) */
			var n = document.querySelector("[data-chat-flow]");
			var sc = null;
			while (n && n !== document.body) {
				var oy = window.getComputedStyle(n).overflowY;
				if (oy === "auto" || oy === "scroll") { sc = n; break; }
				n = n.parentElement;
			}
			if (!sc) sc = document.scrollingElement || document.documentElement;
			var delta = target.el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
			sc.scrollTop = sc.scrollTop + delta - 24;
		}
		place();
		setTimeout(place, 350);
		setTimeout(place, 900);
	}
	var lastStampSig = '';
	var lastProgressAt = t0;
	var viewStableAt = 0;
	/* 11-06 诊断缝（保留）：翻页循环每拍状态快照，外部经
	 * window.__dshWhale._jumpDebug() 只读——跳转定位问题的首查入口
	 * （oldest/pages/clicks/lastAction 一眼定位卡点）。 */
	var __dbg = { started: false, lastTick: 0, oldest: null, n: 0, sig: '', pages: 0, paged: false, inFlight: 0, clicks: 0, lastAction: '-', t0ms: t0, atMsV: atMs, sameSession: sameSession };
	if (typeof window !== 'undefined' && window.__dshWhale) {
		try { window.__dshWhale._jumpDebug = function () { return JSON.parse(JSON.stringify(__dbg)); }; } catch (e) {}
	}
	var timer = setInterval(function () {
		__dbg.lastTick = Date.now();
		if (jumpRunSeq !== run) { __dbg.lastAction = 'superseded'; clearInterval(timer); return; }
		if (pages >= 400 || Date.now() - t0 > 45000) { __dbg.lastAction = 'timeout'; clearInterval(timer); finish(); return; }
		if (done) { __dbg.lastAction = 'done'; clearInterval(timer); return; }
		/* 渲染面判定（每拍）：目标时刻已被渲染窗口覆盖 → 收尾定位 */
		var oldest = renderedOldestMs();
		__dbg.oldest = oldest; __dbg.n = stampEls().length;
		if (oldest !== null && oldest <= atMs) { __dbg.lastAction = 'covered'; clearInterval(timer); finish(); return; }
		/* 无进展检测（11-06）：渲染窗口签名（最早 stamp+条数）12 秒没变化
		 * =翻页卡死/到底/被竞态吞——收尾，别把 45s 窗口耗在静止上 */
		var sig = (oldest === null ? '' : oldest) + ':' + stampEls().length;
		__dbg.sig = sig; __dbg.pages = pages; __dbg.paged = paged; __dbg.inFlight = inFlight;
		if (sig !== lastStampSig) { lastStampSig = sig; lastProgressAt = Date.now(); viewStableAt = 0; }
		else {
			if (!viewStableAt) viewStableAt = Date.now();
			else if (Date.now() - lastProgressAt > 12000) { clearInterval(timer); finish(); return; }
		}
		if (inFlight && Date.now() - inFlight < 1500) return; /* page watchdog (both paths) */
		/* 视图稳定窗（11-06 真机破案，两段式）：①dispatch 后立即点击的翻页
		 * 全部无效——openSession 的 replaceMain 是异步重渲染，点击加载的
		 * older 内容挂在过渡视图上被 settle 后的 tail 重渲染整个覆盖
		 * （真机：45s 内 ~30 次点击全丢；页面静止后手工同款 onClick 一次
		 * 生效 56→64）；②固定 2.5s 仍概率性失败（非确定竞态：点击落在
		 * React 渲染事务中被吞，同构建三次 56 停 vs 并行验证全程 36→56→64
		 * 成功）。改为**签名稳定 1.5s 才允许点击**——tail 渲染/settle 完全
		 * 停歇后才出手，配合 1.5s 点击节流=每次点击都落在静默窗口里。 */
		if (Date.now() - t0 < 2500 || !openSettled || !viewStableAt || Date.now() - viewStableAt < 1500) return;
		/* 翻页双路线（11-06，用户实报「只跳到对话不跳到节点」根修）：
		 * 真机取证 0.2.1 桌面 __dshWhaleSessions 桥未绑（inject 闸门挡了
		 * sessions 服务）——旧循环里 jumpSessions.scope() 每拍 TypeError、
		 * conv 恒 null、`if (!conv || …) return` 空转 45s 超时 → atMs 有值
		 * 也无处使，用户看到的=「跳到会话停在默认位置」。现改双路线：
		 * ①conv.loadOlder() 桥优先（绑上了就用，0.1.x/老引擎原样）；
		 * ②DOM「加载更早」按钮点击兜底——与用户手动点击同一条路径，
		 *   版本无关（CDP 实证 0.2.1 的 [class*="older"] button 在）。
		 * 两条路径都受 1.5s watchdog 节流（DOM 点击后置 inFlight 不清零
		 * ——React 异步渲染期间连点无效，真机实拍 200ms 全速点击 25 拍
		 * 就烧完 bail 预算只翻了几页）。 */
		var conv = null;
		try {
			if (jumpSessions && typeof jumpSessions.scope === 'function') {
				var scoped = jumpSessions.scope(sessionId);
				conv = scoped && scoped.get("conversation");
			}
		} catch (e) { conv = null; }
		if (conv && typeof conv.loadOlder === "function") {
			inFlight = Date.now();
			pages++;
			Promise.resolve(conv.loadOlder()).then(function () {
				paged = true;
				inFlight = 0;
			}, function () {
				paged = true;
				inFlight = 0;
			});
			return;
		}
		var btn = findOlderButton();
		if (btn) {
			inFlight = Date.now();   /* watchdog holds: next attempt ≥1.5s later */
			pages++;
			__dbg.clicks++; __dbg.lastAction = 'clicked@' + (Date.now() - t0) + 'ms';
			try { clickOlderButton(btn); } catch (e) { __dbg.lastAction = 'click-err'; }
			paged = true;
			return;
		}
		if (paged && !hasMoreNode()) { clearInterval(timer); finish(); return; }
	}, 200);
	return true;
}

/** 0.2.0 desktop fallback (B-2, precise): the app sidebar is a virtualized
 * rc-tree whose rows carry data-row-key="session:<sessionId>" — click the row
 * by ID, immune to same-titled conversations and to the cordis inject gate
 * that blocks the sessions bridge. Rows exist only while rendered (expanded
 * project + viewport) — absent row = false, title fallback runs next. */
function openViaSidebarById(sessionId) {
	if (!sessionId) return false;
	var items = document.querySelectorAll('[role="treeitem"]');
	for (var i = 0; i < items.length; i++) {
		var el = items[i];
		var rk = el.getAttribute('data-row-key');
		if (rk !== 'session:' + sessionId) {
			/* react may keep it only in props (getAttribute misses on some trees) */
			rk = null;
			var own = Object.keys(el);
			for (var k = 0; k < own.length; k++) {
				if (own[k].indexOf('__reactProps$') === 0 && el[own[k]] && el[own[k]]['data-row-key']) {
					rk = el[own[k]]['data-row-key'];
					break;
				}
			}
		}
		if (rk === 'session:' + sessionId) {
			el.click();
			return true;
		}
	}
	return false;
}

/** Fallback (no bridge): click the app sidebar's row whose text starts with
 * this title — opens the conversation without moment positioning. Ported
 * from the history drawer's openViaSidebar so BOTH jump entry points share
 * one fallback chain. */
function openViaSidebarByTitle(title) {
	if (!title) return false;
	var divs = document.getElementsByTagName('div');
	for (var i = 0; i < divs.length; i++) {
		var cls = divs[i].className;
		var clsStr = typeof cls === 'string' ? cls : (cls && cls.baseVal) || '';
		if (clsStr.indexOf('sessionRow') < 0) continue;
		var t = (divs[i].textContent || '').trim();
		if (t && t.indexOf(title) === 0) {
			divs[i].click();
			return true;
		}
	}
	return false;
}

/* boot pickup: a bridge may run before whale eval and stash its service
 * faces. GUARDED: a stashed value from a mismatched engine must never kill
 * the whale boot — the bridges keep working; worst case jump stays unbound
 * (sidebar fallbacks cover it). */
if (typeof window !== 'undefined' && (window.__dshWhaleSessions || window.__dshWhaleUiWorkspace)) {
	try {
		bindJumpSessions(window.__dshWhaleSessions, window.__dshWhaleConversation, window.__dshWhaleUiWorkspace);
	} catch (e) { /* service shape mismatch — jump unbound until the bridges rebind */ }
}

/* 桌宠通知双击跳转（11-03）：宿主把合成码反查回真实会话后广播 pet/jump
 * 帧，server-events（core）派发本事件——这里是唯一执行者（跳转桥+侧栏
 * 兜底都在 ui 层）。页鲸在桌宠常驻期间处于视觉休眠，但数据管线照跑，
 * 事件照常到达。载荷坏值只跳过本次，绝不打断监听。
 * atMs（11-06）：时间锚点透传——openSessionAt 的翻页回溯把桌宠通知/历史
 * 行所指的那条任务消息滚进视野（跳到任务节点，不再只跳到会话头部）。 */
	if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
	/* v16（11-13）：跳转串行化 + 隐藏期延迟执行。两个真机实锤断点：
	 * ①隐藏窗里 openSessionAt 的翻页回溯靠 setTimeout（隐藏页被钳到
	 *   ≥1s/步，大会话=分钟级爬行）且 33 次重试链同期在跑；
	 * ②窗口唤醒瞬间 visibilitychange 重放与在途链并发=两条会话打开管线
	 *   交错打满渲染层 JS 主线程=页面卡死（用户实报「弹出来的页面连啥都
	 *   点不了」，进程全部 responding=True，刷新好几轮才恢复——JS 主线程
	 *   被双管线打满的典型形态）。
	 * 规则：隐藏期收到 pet/jump 只记意图不执行；唤醒后 visibilitychange
	 * 以全速定时器跑单链；可见期新意图经 gen 闸门顶替在途链。 */
	var jumpGen = 0, jumpBusy = false, lastPetJump = null;
	function runJumpChain(sid, atMs, myGen) {
		jumpBusy = true;
		var tries = 0;
		var attempt = function () {
			if (myGen !== jumpGen) { jumpBusy = false; return; } /* 被新意图顶替 */
			var ok = false;
			try { ok = openSessionAt(sid, typeof atMs === 'number' ? atMs : undefined); } catch (e2) { ok = false; }
			if (lastPetJump && lastPetJump.sid === String(sid)) lastPetJump.landed = ok;
			/* v16 诊断缝：跳转链每次尝试的落点可见（真机排障 04:5x 十连不落地用） */
			try { if (typeof window !== 'undefined' && window.__dshWhale) window.__dshWhale._petJumpState = { gen: myGen, sid: String(sid).slice(-12), atMs: atMs || 0, tries: tries, ok: ok, busy: jumpBusy, hidden: document.hidden === true, t: Date.now() }; } catch (e4) { }
			if (ok) { jumpBusy = false; return; }
			if (++tries < 33) { setTimeout(attempt, 300); return; }
			jumpBusy = false;
			try { if (typeof window !== 'undefined' && window.__dshWhale) window.__dshWhale._petJumpState = { gen: myGen, sid: String(sid).slice(-12), tries: tries, ok: false, exhausted: true, t: Date.now() }; } catch (e5) { }
		};
		attempt();
	}
	window.addEventListener('dsh-whale:pet-jump', function (ev) {
		try {
			var sid = ev && ev.detail && ev.detail.sessionId;
			var atMs = ev && ev.detail && ev.detail.atMs;
			if (!sid || typeof openSessionAt !== 'function') return;
			jumpGen++;
			var hidden = document.hidden === true;
			lastPetJump = { sid: String(sid), atMs: typeof atMs === 'number' ? atMs : 0, at: Date.now(), whileHidden: hidden, landed: false };
			if (hidden) return; /* 隐藏期只记意图：唤醒后由 visibilitychange 全速执行 */
			runJumpChain(String(sid), atMs, jumpGen);
		} catch (e) { /* a bad payload must not kill the listener */ }
	});
	document.addEventListener('visibilitychange', function () {
		try {
			if (document.hidden) return;
			/* v17（11-13）：落点复核——真机实锤 openSessionAt 返回 true 只代表
			 * 「打开已受理」，真正的会话导航在 occluded 页里被冻结（窗口被遮挡
			 * 时标题不变=没落地，回视=旧会话+页面卡死）。回视时校验：意图 120s
			 * 内 &&（未落地 || 当前标题不含目标会话名）→ 全速重发单链。标题从
			 * ui 闭包的 history 里按 sid 反查最新记录。 */
			if (lastPetJump && Date.now() - lastPetJump.at < 120000 && typeof openSessionAt === 'function') {
				var need = !!lastPetJump.whileHidden || !lastPetJump.landed;
				if (!need) {
					var rec = null;
					try { rec = (typeof history !== 'undefined' ? (history || []) : []).filter(function (h) { return h.sessionId === lastPetJump.sid; }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); })[0] || null; } catch (e1) { }
					var want = rec ? String(rec.title || '') : '';
					need = !!want && (document.title || '').indexOf(want) === -1;
				}
				if (need) {
					lastPetJump.whileHidden = false;
					jumpGen++;
					var jp = lastPetJump;
					setTimeout(function () { runJumpChain(jp.sid, jp.atMs, jumpGen); }, 250);
				}
			}
		} catch (e) { }
	});
}
/* ---- module: src/core/exports.js ---- */

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', uiInit);
	} else {
		uiInit();
	}

	/** 设置 relay（11-11 真机修复轮，用户实报「设置了叮叮桌宠响单声叮」）：
	 * 桌宠 WebView2 是独立 localStorage 分区，页面 CONFIG/总静音永远到不了
	 * 桌宠——每次持久化（saveConfig/setSoundMuted）+ boot 各推一份到宿主
	 * /pet/config（fence-only，与 /pet/ctrl 同信任级），桌宠 2s state 轮询
	 * 差分应用。fire-and-forget：失败静默（轮询与下次改动自然补上）。
	 * 函数声明提升：config.js/dings.js 的调用点在本定义之前也可用。 */
	function pushPetConfig() {
		try {
			if (PET_MODE || typeof fetch !== 'function') return;
			fetch('/api/whale-assistant/pet/config', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					config: JSON.parse(JSON.stringify(CONFIG)),
					sound: soundMuted ? 'off' : 'on'
				})
			}).catch(function () { /* 宿主无桌宠/离线：静默 */ });
		} catch (e) { /* 序列化失败不可能，防御 */ }
	}
	pushPetConfig(); /* boot 一推：宿主 ledger 缺货（首次启用/重装）时兜底 */

	/* diagnostic seam */
	window.__dshWhale.version = PATCH_VERSION;
	window.__dshWhale._pushPetConfig = pushPetConfig;
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
	window.__dshWhale.bindJumpSessions = bindJumpSessions;
	window.__dshWhale.jumpReady = jumpReady;
	window.__dshWhale.openSessionAt = openSessionAt;
	window.__dshWhale._parseStamp = parseStamp;
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
	/* 桌宠仲裁 seam（第一批）：测试直接驱动休眠开关 / 读当前态（see ui/bubble.js） */
	window.__dshWhale._petDormant = {
		apply: applyPetDormant,
		get: function () { return petDormant; },
		seen: function () { return petStateEverSeen(); }
	};
	/* 11-05 开机防双鲸：兜底 reveal 缝（真实页 6s 定时器调用；测试的
	 * ready() 同步调用它模拟超时——见 test-whale makeEnv.ready） */
	window.__dshWhale._bootReveal = function () {
		if (!petStateEverSeen() && !petDormant) applyPetDormant(false, true);
	};
	/* _petDormantOf（仲裁纯函数）由 server-events 闭包内导出——这里够不着 */
	/* 桌宠常驻（第九轮）：没有开局问候——鲸鱼开机即在家里（loadPos 落位），
	 * 页内鲸鱼在桌宠运行期间整体休眠，问候无从谈起。 */
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
