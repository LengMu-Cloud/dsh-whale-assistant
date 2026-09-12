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

	/** Whale patch version (M5.1). Build-time override: build-whale.js reads
	 * env PATCH_VERSION; the default here is the fallback single source. */
	var PATCH_VERSION = '0.3.2';

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
	}/* ---- module: src/core/config.js ---- */
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
		if (typeof fetch !== 'function') return;
		try {
			fetch('/api/whale-assistant/state').then(function (response) {
				return response.ok ? response.json() : null;
			}).then(function (doc) {
				if (!doc || !Array.isArray(doc.history)) return;
				var merged = mergeHistories(history, doc.history);
				if (merged.length !== history.length) {
					history = merged;
					safeSet(HISTORY_KEY, history);
					/* write the merge back: a browser whose local history was
					 * ahead uploads it — this is also how an existing window's
					 * records migrate to the server on first open */
					pushCloudHistory();
				}
				if (onDone) onDone();
			}).catch(function () {});
		} catch (e) {}
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
	var FALLBACK_ID = 'session-alpha-active';
	var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;

	function getCurrentSessionId() {
		try {
			/* the app keeps the ACTIVE conversation id here (JSON
			 * {"sessionId":"session-…"}) — authoritative across switches;
			 * the dsh.conversation.* keys below are insertion-ordered caches
			 * and go stale after a jump back to an older conversation */
			var raw = localStorage.getItem('dsh.sessions.current');
			if (raw) {
				var v = JSON.parse(raw);
				if (v && typeof v.sessionId === 'string' && v.sessionId.indexOf('session-') === 0) return v.sessionId;
			}
		} catch (e) {}
		try {
			var keys = Object.keys(localStorage);
			for (var i = keys.length - 1; i >= 0; i--) {
				var m = SESSION_KEY_RE.exec(keys[i]);
				if (m) return m[1];
			}
		} catch (e) {}
		return FALLBACK_ID;
	}

	/* reportTurn() only speaks for sessions registered in subagentSessions —
	 * that map is filled by the subagentTiming PROJECTION frame, so register
	 * once per session before any turn/event is fed. Registering also makes
	 * frames.js fetch the conversation title (real name in notifications). */
	var registeredId = null;
	function ensureRegistered() {
		var sid = getCurrentSessionId();
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
			var sid = getCurrentSessionId();
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
	function chipAgeMinutes(text) {
		var now = new Date();
		var m = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/.exec(text);
		if (m) {
			var d = new Date(now.getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
			if (d.getTime() > Date.now() + 864e5) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2], +m[3], +m[4]);
			return (Date.now() - d.getTime()) / 60000;
		}
		m = /(\d{1,2}):(\d{2})\s*$/.exec(text);
		if (m) {
			var d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]);
			return (Date.now() - d2.getTime()) / 60000;
		}
		return 0; /* no stamp parsed: treat as fresh */
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

	var observer = new MutationObserver(function (mutations) {
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
						seeEndFire(getCurrentSessionId(), 'fail');
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
		var age = chipAgeMinutes((row.textContent || '') + ' ' + (chip.textContent || ''));
		if (age > 10) return;
		var turnTokens = readTurnUsage();
		/* health sample: a REAL turn finish with nothing read is one strike
		 * against the usage selector (3 in a row = degraded, see health.js) */
		recordUsageHealth(turnTokens > 0);
		if (turnTokens > 0) turnTokenUsage = turnTokens;
		var sid = ensureRegistered();
		feedSessionUsage(sid); /* cumulative burn for the status panel */
		/* the stats node may render a beat after the chip: re-feed once */
		setTimeout(function () { feedSessionUsage(getCurrentSessionId()); }, 800);
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
		setTimeout(function () { feedSessionUsage(getCurrentSessionId()); }, 1200);
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

	var FALLBACK_ID = 'session-alpha-active';
	var SESSION_KEY_RE = /^dsh\.conversation\.(?:chat\.)?(session-[0-9a-f-]{10,})$/;

	function activeSessionId() {
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
				var m = SESSION_KEY_RE.exec(keys[i]);
				if (m) return m[1];
			}
		} catch (e) {}
		return FALLBACK_ID;
	}

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
	/* batch fold: how many completed turn/ends of the SAME session ride in
	 * one poll batch (a hidden/throttled tab lets minutes of events pile up
	 * in a single fetch). FOLD_MIN or more collapse into ONE 📦 summary
	 * announcement — history still records every turn. */
	var FOLD_MIN = 3;

	function rememberSeq(n) {
		lastSeq = n;
		try { localStorage.setItem('dsh-whale:evseq', JSON.stringify({ bootId: knownBootId, seq: n })); } catch (e) {}
	}

	function feedEventFrame(frame) {
		var sid = frame.sessionId;
		var event = frame.event || {};
		var active = activeSessionId();
		var isActive = sid === active;
		var type = event.type;
		if (type === 'turn/end') {
			var reason = event.data && event.data.reason && event.data.reason.kind;
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
				if (reason !== 'aborted' && endFiredRecently(sid)) return;
			}
			/* cross-channel completion dedup (09-06): the active-session
			 * check above can race (chip gate / session tracking) and the
			 * DOM chip adapter may have JUST announced this same end —
			 * same physical end = same wall clock within seconds; a real
			 * new completion carries its own endTime and still announces */
			if (reason === 'completed' && endFiredFor(sid, 'success', frame.time || Date.now(), 8000)) return;
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
					foldCount: event.foldCount || undefined
				}
			});
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
			if (lastStartAt[sid] && nowMs - lastStartAt[sid] < 15000) return;
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
		if (type === 'assistant/message' && !isActive) {
			/* per-model-reply usage: the ONLY source of THIS-turn token burn
			 * for a background session (the DOM chip path cannot see it).
			 * Without this the completion panel re-showed the previous
			 * foreground turn's stale count (live-verified 2026-09-03). */
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

	function consume(events, bootId) {
		if (bootId && bootId !== knownBootId) {
			/* new host generation: its seq starts over — reset and only take
			 * frames newer than the swap */
			knownBootId = bootId;
			lastSeq = 0;
			rememberSeq(0);
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
			if (!f || typeof f.seq !== 'number' || f.seq <= lastSeq) continue;
			rememberSeq(f.seq);
			/* a fresh page must not replay the buffer's history — same
			 * event.time fallback as the fold pre-scan (host frames have no
			 * top-level time; bare f.time made this guard dead code) */
			var fTime = f.time || (f.event && f.event.time);
			if (fTime && Date.now() - fTime > 60000 && bootAt - fTime > 60000) continue;
			if (f.type === 'session/projection') {
				if (f.key === 'title') {
					if (f.sessionId !== activeSessionId()) {
						var v = f.value;
						var title = typeof v === 'string' ? v : (v && typeof v.title === 'string' ? v.title : null);
						if (title) {
							try { sessionTitles.set(f.sessionId, title); rememberTitle(f.sessionId, title); } catch (e) {}
							try {
								var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
								var info = subs && subs.get(f.sessionId);
								if (info && !info.title) info.title = title;
							} catch (e) {}
						}
					}
					continue;
				}
				/* usage + pressure projections: the host sees EVERY session, so
				 * feeding them here keeps 全对话累计/上下文压力 real for
				 * sessions this window never opened (after a reload the DOM
				 * reader only sees the one visible conversation). The ACTIVE
				 * session is skipped — its DOM feed already covers it and must
				 * not race the server values for lastMainSession. */
				if ((f.key === 'tokenUsage' || f.key === 'contextPressure') && f.sessionId !== activeSessionId()) {
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
				feedEventFrame(f);
			}
			/* session/jobs frames are intentionally ignored (empty payloads) */
		}
	}

	function poll() {
		fetch('/api/whale-assistant/events').then(function (r) {
			return r.ok ? r.json() : null;
		}).then(function (data) {
			if (data && Array.isArray(data.events)) {
				markServerPoll(true);
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

	/* start as soon as the boot render settles (1.5s); the first polls still
	 * skip frames that predate the page via the bootAt guards above */
	setTimeout(function () {
		setInterval(poll, POLL_MS);
		poll();
	}, 1500);

	/* test seam: drive the polled-frame gate directly (active-session skip +
	 * cross-channel completion dedup) without waiting for the 3s poll */
	try {
		window.__dshWhale = window.__dshWhale || {};
		window.__dshWhale._feedEventFrame = feedEventFrame;
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
				jump: (typeof window !== 'undefined' && typeof window.__dshOpenSession === 'function') ? 'ok' : 'warn'
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
	 * cumulative burn, and the context pressure — each its own line, joined
	 * into ONE line when the panel has room (see applyStatusText). */
	function statusReport(turnTokens, sessionTokens, pressure) {
		var lines = [];
		if (typeof turnTokens === 'number' && turnTokens > 0) {
			lines.push('此次任务消耗 ' + fmtTokens(turnTokens) + ' tokens');
		}
		if (typeof sessionTokens === 'number' && sessionTokens > 0) {
			lines.push('全对话累计消耗 ' + fmtTokens(sessionTokens) + ' tokens');
		}
		if (pressure && pressure.contextWindow) {
			var pct = Math.round((pressure.pressureTokens || 0) / pressure.contextWindow * 100);
			lines.push('上下文已用 ' + pct + '%');
		}
		return lines.length > 0 ? { prefix: '📊 ', lines: lines } : null;
	}

	/** The report currently displayed in the bubble (the latest push, or the
	 * one being replayed from a click). Double-clicking the bubble to jump
	 * marks THIS report read — it leaves the unread queue and the badge
	 * drops by one. */
	var lastShownReport = null;

	/** Record one job report for the unread badge (bubble is shown by the caller).
	 * `snapshot === false` stores NO token/pressure data (used for the
	 * turn/start report — a task that just started has nothing to report).
	 * `endTime` (ms epoch of the moment this report is about) powers the
	 * double-click jump: the bubble jump pages the log back to THAT moment. */
	function pushReport(text, duration, sessionId, snapshot, endTime) {
		/* snapshot the task's token/pressure with the report, so reading it
		 * later can re-show the same numbers. The per-turn burn is only
		 * snapshotted when it belongs to THIS session (see turnTokenSession) */
		reportQueue.push({
			text: text,
			duration: duration,
			sessionId: sessionId,
			at: Date.now(),
			turnTokens: snapshot === false ? null :
				(turnTokenSession === sessionId ? turnTokenUsage : null),
			sessionTokens: snapshot === false ? null : sessionTotalTokens(sessionId),
			pressure: snapshot === false ? null : sessionPressure.get(sessionId),
			endTime: typeof endTime === 'number' ? endTime : null
		});
		/* generous bound: the badge must keep accumulating long past 20 */
		if (reportQueue.length > REPORT_QUEUE_CAP) reportQueue.shift();
		lastShownReport = reportQueue[reportQueue.length - 1];
		currentSaySession = sessionId || null;
		renderUnread();
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
					if (dingKinds.length > 0) pumpDings();
				}).catch(function () {
					/* resume rejected; stay silent rather than crash */
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

	function playDing(kind) {
		if (soundMuted) return; /* right-click menu: one-tap mute */
		/* 免打扰: completion/failure sounds are dropped (attention still
		 * rings — the user must act on those regardless of the hour) */
		if (dndActive() && (kind === 'done' || kind === 'fail')) return;
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
		if (!sessionId || !title || title === '未命名任务') return;
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
		var changed = false;
		for (var i = 0; i < reportQueue.length; i++) {
			var item = reportQueue[i];
			if (item.sessionId === sessionId && item.text.indexOf('未命名任务') !== -1) {
				item.text = item.text.split('未命名任务').join(title);
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
			if (bubble && currentSaySession === sessionId && bubble.textContent.indexOf('未命名任务') !== -1) {
				bubble.textContent = bubble.textContent.split('未命名任务').join(title);
			}
		}
	}

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
			touchActivity();
			return;
		}
		if (frame.key === 'contextPressure') {
			if (isMainSession(frame.sessionId)) {
				sessionPressure.set(frame.sessionId, frame.value || {});
				capMap(sessionPressure, 150); /* memory audit */
				lastMainSession = frame.sessionId;
			}
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
		var title = truncate(info.label || info.title || bookTitle(frame.sessionId) || '未命名任务', 40);
		if (event.type === 'turn/start') {
			bumpWork(1);
			/* mark the status panel as busy while this turn runs */
			markStatusBusy(true);
			/* (the task counter was already reset on the live turn/start
			 * event, before the name-hold, so early usage is kept) */
			if (CONFIG.notifyOnStart) {
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
				 * gear credit; history keeps a neutral ⏹ entry that still jumps */
				var stopMsg = '[' + title + ']被中止了 ✋';
				say(stopMsg, DURATION_END, frame.sessionId);
				pushReport(stopMsg, DURATION_END, frame.sessionId, undefined, atMs);
				pushHistory({ title: title, sessionId: frame.sessionId, kind: 'killed', at: Date.now(), endTime: atMs, turnTokens: turnTokenUsage });
			} else if (isError) {
				var endMsg = '[' + title + ']失败了 ' + pickTail('failed') + '（双击通知可回到该对话）';
				if (!dndActive()) {
					say(endMsg, DURATION_END, frame.sessionId);
					playDing('fail');
					var repFail = statusReport(turnTokenUsage, sessionTotalTokens(frame.sessionId), sessionPressure.get(frame.sessionId));
					if (repFail) showStatusPanel(repFail, DURATION_END);
				}
				pushReport(endMsg, DURATION_END, frame.sessionId, undefined, atMs);
				/* a failed task does not count toward the daily gear */
				pushHistory({ title: title, sessionId: frame.sessionId, kind: 'fail', at: Date.now(), endTime: atMs, turnTokens: turnTokenUsage });
			} else {
				/* batch-fold contract (see server-events consume pre-scan):
				 * a flood batch's OLDER completed turns carry foldSuppress —
				 * they record history + gear credit silently so the unread
				 * badge never explodes; the NEWEST carries foldCount and
				 * announces once for the whole batch. */
				if (event.foldSuppress) {
					gearStats.tasksDone++;
					saveGearStats();
					pushHistory({
						title: title,
						sessionId: frame.sessionId,
						kind: 'done',
						at: Date.now(),
						endTime: atMs,
						turnTokens: turnTokenUsage
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
					playDing('done');
					var rep = statusReport(turnTokenUsage, sessionTotalTokens(frame.sessionId), sessionPressure.get(frame.sessionId));
					if (rep) showStatusPanel(rep, DURATION_END);
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
					turnTokens: turnTokenUsage
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
		if (info && (info.label || info.title)) name = info.label || info.title;
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

		/** Jump to the conversation behind the CURRENT bubble (double-click
		 * on the bubble, or on a spot that overlaps it). Idle summaries
		 * carry no session and only get a hint. */
		function jumpToBubbleSession() {
			var sessionId = currentSaySession;
			if (!sessionId) {
				uiSay('这条消息没有对应的对话哦 🐳', 2000);
				return;
			}
			var opener = window.__dshOpenSession;
			if (typeof opener !== 'function') {
				uiSay('跳转功能需要刷新页面（插件未加载）', 2500);
				return;
			}
			/* the report's endTime (the moment THIS report is about) lets the
			 * host page back to that message — on a SAME-session jump (the
			 * alpha adapter only tracks the current conversation) open() alone
			 * would be a no-op with zero visible feedback */
			var rep = reading || lastShownReport;
			var atMs = rep && typeof rep.endTime === 'number' ? rep.endTime : undefined;
			try {
				opener(sessionId, atMs);
				/* jumping to the conversation counts as reading the report:
				 * the badge drops by one and the notification leaves the
				 * queue (it must NOT still pop up from the red badge later) */
				markBubbleRead();
				/* keep the session attached to the bubble — the feedback
				 * must not clear currentSaySession or the NEXT double-click
				 * would lose the conversation */
				uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
			} catch (error) {
				/* the jump failed: the report stays unread */
				uiSay('找不到对应的对话 🥲', 2000, sessionId);
			}
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
				backBtn.textContent = '← 返回设置';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					openSettings();
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
			remindItem.textContent = '⏰ 提醒我' + (pendingReminders > 0 ? '（' + pendingReminders + ' 个待响）' : '');
			remindItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openReminders();
			});
			menu.appendChild(remindItem);
			/* sound toggle */
			var soundItem = document.createElement('div');
			soundItem.className = 'dsh-whale-menu-item';
			soundItem.textContent = soundMuted ? '🔇 声音：关' : '🔊 声音：开';
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
			var helpItem = document.createElement('div');
			helpItem.className = 'dsh-whale-menu-item';
			helpItem.textContent = '📖 使用说明';
			helpItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHelp();
			});
			menu.appendChild(helpItem);
			/* wardrobe */
			var dressItem = document.createElement('div');
			dressItem.className = 'dsh-whale-menu-item';
			dressItem.textContent = '🎨 我的装扮';
			dressItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openWardrobe();
			});
			menu.appendChild(dressItem);
			/* history */
			var historyItem = document.createElement('div');
			historyItem.className = 'dsh-whale-menu-item';
			historyItem.textContent = '📜 历史任务';
			historyItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHistory();
			});
			menu.appendChild(historyItem);
			/* settings */
			var settingsItem = document.createElement('div');
			settingsItem.className = 'dsh-whale-menu-item';
			settingsItem.textContent = '⚙️ 设置';
			settingsItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openSettings();
			});
			menu.appendChild(settingsItem);
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
				leftTxt.textContent = def.emoji + ' ' + def.name;
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
			affL.textContent = '❤️ 好感度';
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

		/** 📖 使用说明: the full user manual, one scrollable side drawer.
		 * Covers what the whale is, every notification, every gesture, every
		 * settings row and where the data lives — THE authoritative doc for
		 * end users (the old 8-line gesture cheat sheet grew into this per
		 * user request, 2026-09-04). Lives in the side-drawer slot: wide,
		 * left of the whale, list scrolls, never stacks with other panels. */
		function openHelp() {
			closeCtxPanel();
			closeCtxHistory();
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history dsh-whale-manual';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📖 使用说明 ⚡ v' + PATCH_VERSION;
			panel.appendChild(title);
			/* keyword search (#5): filters rows live, jumps to the first hit */
			var mSearch = document.createElement('input');
			mSearch.className = 'dsh-whale-history-search dsh-whale-manual-search';
			mSearch.placeholder = '搜索说明…（如：红标、音色）';
			mSearch.addEventListener('click', function (event) { event.stopPropagation(); });
			panel.appendChild(mSearch);
			var mStatus = document.createElement('div');
			mStatus.className = 'dsh-whale-manual-status';
			panel.appendChild(mStatus);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			mSearch.addEventListener('input', function () {
				var q = (mSearch.value || '').trim();
				var rows = list.children;
				var n = 0;
				var first = null;
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers always stay visible */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (!first) first = el;
					}
				}
				mStatus.textContent = q ? (n > 0 ? '找到 ' + n + ' 条相关内容' : '未找到相关内容 🔍') : '';
				if (first && typeof first.scrollIntoView === 'function') {
					first.scrollIntoView({ block: 'nearest' });
				}
			});
			var sec = function (t) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				el.textContent = t;
				list.appendChild(el);
			};
			var item = function (term, desc) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
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
				list.appendChild(el);
			};
			var gesture = function (n, text) {
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
				list.appendChild(row);
			};
			sec('🚀 快速上手');
			item('右键点我：打开菜单', '所有功能都在右键菜单里——提醒我、装扮、历史任务、设置、使用说明。先记住这一个手势就够了。');
			item('点我一下：读通知', '有未读就逐条读给你（红标数字会减）；没有未读就陪我聊一句。');
			item('双击通知气泡：跳回对话', '任何完成/失败/提问通知，双击就能回到那条对话现场。');
			item('拖着我走：位置会记住', '按住我拖到喜欢的角落，刷新后还在这。');
			sec('🐳 我是什么');
			item('打工小鲸鱼，住在 DeepSeek Harness 右下角', '只读任务事件做播报和记录，不拦截、不修改任何任务行为，随便折腾不影响工作。任务在后台跑我也会看着，跑完 3 秒内告诉你。');
			sec('🔔 通知一览');
			item('[对话名]开工了 …', '任务开始跑。不进红标（不算未读）。');
			item('[对话名]完成了 …', '正常结束：响一声 + 红标 +1，下方同时弹出用量面板（本次消耗 / 全对话累计 / 上下文占用），和气泡同生同灭。');
			item('[对话名]失败了 …', '出错了：低沉音 + 红标 +1。双击通知气泡可回去看看。');
			item('[对话名]被截断了 …', '回复顶到 max tokens 上限，任务本身没坏。');
			item('[对话名]被中止了 ✋', '你手动停了任务，不算失败。');
			item('🤔 [对话名]需要你选择', '模型在等你作答：响铃 + 红标 +1。回到对话作答即收尾；任务还没跑完，用量等完成通知再统一看。');
			item('⚠️ [对话名]需要你审核', '有工具调用等你批准：同上。');
			item('上下文快挤爆了…建议 /compact', '上下文占用达到压力阈值时提醒一次。');
			item('⏰ 定时提醒', '右键菜单设的闹钟到点播报（不进红标，不带用量面板）。');
			sec('🐾 交互手势');
			gesture(1, '左键拖动：移动我');
			gesture(2, '左键单击：进行互动（读通知）');
			gesture(3, '左键双击：游回角落（中途可抓住）');
			gesture(4, '双击通知气泡：跳转对应对话');
			gesture(5, '左键单击红标数字：读通知');
			gesture(6, '左键双击红标数字：通知清空');
			gesture(7, '右键：打开菜单');
			gesture(8, '右键双击：触发摸摸头');
			sec('🎛️ 设置项详解');
			item('🔔 开工通知（开/关）', '关掉后"开工了"不再播报，其余通知不受影响。');
			item('🌙 免打扰', '时段内完成/失败不弹泡不响铃，只记红标；需要你动手的选择/审核照常提醒，急事不瞒你。');
			item('🔊 音量', '提示音音量，5 档循环。');
			item('🎵 音色（按通知设置）', '完成/失败/提问、定时提醒四类通知各选各的音效：单声叮 / 叮叮两连击 / 清脆上行 / 低沉下行 / 静音，下拉选中即生效并现场试听。');
			item('⏱️ 工具超时', '某个工具跑超过该时长时提示一次"可能卡住了"（只是提醒，不会打断任务）。');
			item('🚨 压力提醒', '上下文占用达到该百分比时提醒 /compact；回降到 50% 以下后重新武装。');
			item('📊 任务周报', '近 7 天按日统计任务数（完成/失败/中止/提问）与 token 消耗。');
			item('📤 导出历史', 'Markdown：复制全部历史到剪贴板；CSV：下载表格文件。');
			item('🩺 运行状态', '鲸鱼自查各条通知链路（后台通知/用量读取/跳转）；平时全部正常、不打扰，出问题我头上会亮 ⚠️，设置里点"运行状态"能看是哪一条。');
			item('🩺 调试模式', '排障用：开启后往控制台输出调试信息，并把取证数据写进 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。');
			sec('📜 历史与红标');
			item('红标数字 = 未读通知数', '左键单击读一条（读过的消失），双击一键清空。完成/失败/提问/审核计入，开工/提醒不计入。');
			item('📜 历史任务（右键菜单）', '保留最近 50 条：本地 + 服务器双存储，桌面壳和别的浏览器窗口看到同一份；支持搜索、清空、导出。');
			item('跳回对话', '双击通知气泡，或点历史抽屉里的任意一条记录。');
			sec('❤️ 陪伴小彩蛋');
			item('摸摸头', '右键双击我：好感 +1，还有小心心飘出。');
			item('状态与情绪', '任务越多我越累、会打瞌睡（左键单击唤醒）；右键菜单标题能看当前心情和进行中的任务数。');
			item('装扮与成就', '完成任务攒进度，解锁新装扮后去 右键菜单 → 🎨我的装扮 查看。');
			sec('🙋 常见问题');
			item('怎么没有声音？', '依次看：右键菜单 🔊 声音是否开 → 设置里音量 → 🎵 音色里对应通知是否选了"静音" → 是否在免打扰时段（深夜只记红标不出声）。');
			item('通知突然不来了？', '多半是页面放久了过期：按 Ctrl+F5 刷新即可恢复。我自己的链路自检在 设置 → 🩺 运行状态 里，哪条失效会明说。');
			item('后台任务会打扰我吗？', '不会：只有完成/失败/需要你动手时才提醒，中间过程只在状态面板安静展示；深夜时段只记红标不出声。');
			item('换浏览器历史还在吗？', '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份；跨机器不同步。');
			panel.appendChild(list);
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			showSidePanel(panel, 380);
		}

		/** History drawer: recent finished tasks (newest first), each row can
		 * jump back to its conversation via the session-opening hook. Uses a
		 * separate panel slot so it can be wider and left-anchored. */
		var ctxHistory = null;
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
					/* the app's own sidebar navigation: the guaranteed fallback
					 * when the conversation-plugin hook is missing (stale page) */
					function openViaSidebar() {
						var divs = document.getElementsByTagName('div');
						for (var i = 0; i < divs.length; i++) {
							var cls = divs[i].className;
							var clsStr = typeof cls === 'string' ? cls : (cls && cls.baseVal) || '';
							if (clsStr.indexOf('sessionRow') < 0) continue;
							var t = (divs[i].textContent || '').trim();
							if (t && title && t.indexOf(title) === 0) {
								divs[i].click();
								return true;
							}
						}
						return false;
					}
					return function (event) {
						event.stopPropagation();
						closeCtxHistory();
						var opener = window.__dshOpenSession;
						if (typeof opener === 'function') {
							try {
								/* endTime (fallback: the record's `at`) lets the host
								 * page back until the log covers the moment this
								 * record happened */
								opener(sessionId, endTime);
								uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
								return;
							} catch (error) { /* fall through to the sidebar */ }
						}
						if (openViaSidebar()) {
							uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
							return;
						}
						uiSay('跳转失败：请按 Ctrl+F5 刷新页面后重试 🥲', 3000, sessionId);
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

		/** 🎵 音色: per-notification sound picker — 每种通知各选各的音效，
		 * 点选即切换并现场试听。 */
		function openSoundPicker() {
			var KINDS = [
				{ key: 'soundDone', kind: 'done', label: '✅ 完成通知', opts: ['ding', 'bell', 'chime', 'none'] },
				{ key: 'soundFail', kind: 'fail', label: '❌ 失败通知', opts: ['thud', 'ding', 'bell', 'chime', 'none'] },
				{ key: 'soundAttn', kind: 'attention', label: '❓ 提问回答', opts: ['chime', 'ding', 'bell', 'none'] },
				{ key: 'soundRemind', kind: 'remind', label: '⏰ 定时提醒', opts: ['bell', 'ding', 'chime', 'thud', 'none'] }
			];
			var LABELS = { ding: '单声叮', bell: '叮叮（两连击）', chime: '清脆上行', thud: '低沉下行', none: '静音' };
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			/* extra width: label + its dropdown must fit on ONE row (层级) */
			panel.className = 'dsh-whale-settings dsh-whale-sound-panel';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎵 音色';
			panel.appendChild(title);
			/* one dropdown per kind (user feedback: 同类交互统一走下拉/紧凑控件，
			 * 取代把所有选项铺满一屏的列表）；改动即试听，无需重建面板 */
			KINDS.forEach(function (k) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = k.label;
				row.appendChild(l);
				var sel = document.createElement('select');
				sel.className = 'dsh-whale-sound-sel';
				k.opts.forEach(function (opt) {
					var opt2 = document.createElement('option');
					opt2.value = opt;
					opt2.textContent = LABELS[opt];
					sel.appendChild(opt2);
				});
				sel.value = CONFIG[k.key];
				sel.addEventListener('click', function (event) { event.stopPropagation(); });
				sel.addEventListener('change', function () {
					var pa = {}; pa[k.key] = sel.value;
					if (applyConfig(pa)) saveConfig();
					playDing(k.kind); /* 现场试听 */
				});
				row.appendChild(sel);
				panel.appendChild(row);
			});
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 220);
		}

		/** ⏰ 提醒: presets in the right-click menu; persisted in
		 * localStorage so they survive reloads; a 20s interval fires due
		 * ones as bubble + attention chime + unread badge. */
		function loadReminders() {
			try { return JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]'); } catch (e) { return []; }
		}
		function saveReminders(list) {
			try { localStorage.setItem('dsh-whale:reminders', JSON.stringify(list)); } catch (e) {}
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
			PRESETS.forEach(function (min) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				row.textContent = '➕ ' + min + ' 分钟后提醒';
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var list = loadReminders();
					list.push({ at: Date.now() + min * 60000, text: min + ' 分钟时间到了' });
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
			addRow.textContent = '➕ 添加提醒';
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
				list.push({ at: target.getTime(), text: '定时提醒 ' + label });
				saveReminders(list);
				uiSay('好，' + (target.getDate() === new Date().getDate() ? '今天' : '明天') + ' ' + label + ' 提醒你 ⏰', 2600);
				openReminders();
			};
			var list = loadReminders();
			list.sort(function (a, b) { return a.at - b.at; });
			list.forEach(function (r, idx) {
				var left = Math.max(0, Math.round((r.at - Date.now()) / 60000));
				var d = new Date(r.at);
				var pad2 = function (v) { return v < 10 ? '0' + v : '' + v; };
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				row.textContent = '⏳ ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
					pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
					'（还剩约 ' + left + ' 分钟，点按取消）';
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var rest = loadReminders();
					rest.splice(idx, 1);
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
		setInterval(function () {
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
				playDing('remind'); /* 音色面板可选（soundRemind，默认铃铛） */
			}
		}, 20000);

		/** 📊 任务周报: last-7-day buckets from the history records, drawn in
		 * the same drawer style as the history list (fixed height, list
		 * scrolls). Lives in the side-drawer slot: opening it CLOSES the
		 * settings panel — both float next to the whale, and stacked they
		 * hide each other (the drawer rendered "empty" for its whole life
		 * because its list div was never appended to the panel — only the
		 * title + close ever made it into the DOM). */
		function openReport() {
			closeCtxPanel();
			pullCloudHistory(); /* warm: merge records saved by other windows */
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📊 任务周报（近 7 天）';
			panel.appendChild(title);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			var days = {};
			var order = [];
			var weekAgo = Date.now() - 7 * 864e5;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				var at = rec.at || 0;
				if (at < weekAgo) continue;
				var d = new Date(at);
				var key = (d.getMonth() + 1) + '月' + d.getDate() + '日';
				if (!days[key]) { days[key] = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0, titles: [] }; order.push({ key: key, at: at }); }
				var b = days[key];
				if (rec.kind === 'done') b.done++;
				else if (rec.kind === 'fail') b.fail++;
				else if (rec.kind === 'killed') b.killed++;
				else if (rec.kind === 'question' || rec.kind === 'approval') b.ask++;
				if (rec.turnTokens) b.tokens += rec.turnTokens;
				if (rec.title && rec.title !== '未命名任务' && b.titles.indexOf(rec.title) < 0) b.titles.push(rec.title);
			}
			order.sort(function (a, b2) { return b2.at - a.at; });
			var totals = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0 };
			order.forEach(function (o) {
				var b = days[o.key];
				totals.done += b.done; totals.fail += b.fail; totals.killed += b.killed; totals.ask += b.ask; totals.tokens += b.tokens;
			});
			var fmtK = function (n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? Math.round(n / 1000) + 'K' : n; };
			var sumRow = document.createElement('div');
			sumRow.className = 'dsh-whale-report-summary';
			sumRow.textContent = '本周：✅' + totals.done + ' 失败' + totals.fail + ' ⏹' + totals.killed + ' ❓' + totals.ask + ' · ' + fmtK(totals.tokens) + ' tok';
			list.appendChild(sumRow);
			if (order.length === 0) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '这 7 天还没有任务记录 🐳';
				list.appendChild(empty);
			}
			order.forEach(function (o) {
				var b = days[o.key];
				var row = document.createElement('div');
				row.className = 'dsh-whale-history-row';
				row.title = b.titles.join('\n');
				var text = document.createElement('span');
				text.className = 'dsh-whale-history-text';
				text.textContent = o.key;
				var time = document.createElement('span');
				time.className = 'dsh-whale-history-time';
				var parts = [];
				if (b.done) parts.push('✅' + b.done);
				if (b.fail) parts.push('❌' + b.fail);
				if (b.killed) parts.push('⏹' + b.killed);
				if (b.ask) parts.push('❓' + b.ask);
				time.textContent = parts.join(' ') + (b.tokens ? ' · ' + fmtK(b.tokens) : '');
				row.appendChild(text);
				row.appendChild(time);
				list.appendChild(row);
			});
			panel.appendChild(list);
			/* entered from settings too (任务周报 row): back/close footer */
			mkPanelFoot(panel, closeCtxHistory);
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			showSidePanel(panel, 300);
		}

		/** 📤 导出历史: Markdown → clipboard; CSV → file download. */
		function exportHistory(fmt) {
			if (!history.length) { uiSay('还没有历史可导出哦 🐳', 2000); return; }
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
				uiSay('CSV 已下载 📤', 2000);
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
				navigator.clipboard.writeText(md).then(function () { uiSay('Markdown 已复制 📋', 2200); }, function () { uiSay('复制失败 🥲', 2000); });
			} else {
				uiSay('剪贴板不可用 🥲', 2000);
			}
		}

		function openHistory() {
			closeCtxPanel(); /* drawers and floating panels never stack */
			pullCloudHistory(function () {
				/* the server merge may have brought records from other windows:
				 * re-fill the list body when the pull settles */
				if (ctxHistory && ctxHistory.isConnected) {
					var liveList = ctxHistory.querySelector('.dsh-whale-history-list');
					if (liveList) fillHistoryList(liveList);
				}
			});
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
				try { safeSet(HISTORY_KEY, history); } catch (e) {}
				pushCloudHistory();
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
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			/* fixed-height drawer with a scrollable list: long histories never
			 * grow past the viewport — the LIST scrolls, not the drawer */
			showSidePanel(panel, 280);
		}
		function closeCtxHistory() {
			if (ctxHistory) ctxHistory.classList.remove('show');
		}

		/** Settings panel: notify-on-start toggle, stuck threshold, volume.
		 * Each row is a cycle; changes apply + persist immediately. Reuses the
		 * floating-panel slot (ctxPanel) for outside-click close. */
		function openSettings() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
			var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '⚙️ 设置';
			panel.appendChild(title);
			var mkSection = function (label) {
				var sec = document.createElement('div');
				sec.className = 'dsh-whale-settings-section';
				sec.textContent = label;
				panel.appendChild(sec);
			};
			var mkRow = function (label, valueText, onChange, keepOpen, hint) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = label;
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				/* (?) explainer (#6): CLICK-toggled one-line hint with an
				 * explicit 收起 button — never a hover tooltip (user rejected
				 * those, 2026-09-03); re-clicking (?) alone felt wrong. */
				if (hint) {
					var tip = document.createElement('div');
					tip.className = 'dsh-whale-settings-hint';
					var tipT = document.createElement('span');
					tipT.className = 'dsh-whale-settings-hint-t';
					tipT.textContent = hint;
					tip.appendChild(tipT);
					var tipX = document.createElement('span');
					tipX.className = 'dsh-whale-settings-hint-x';
					tipX.textContent = '收起 ▴';
					tipX.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.remove('show');
					});
					tip.appendChild(tipX);
					row.appendChild(tip);
					var q = document.createElement('span');
					q.className = 'dsh-whale-settings-q';
					q.textContent = '?';
					q.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.toggle('show');
						/* re-measure + re-clamp: an expansion near a screen
						 * edge must flip/shrink, never run off-screen */
						showFloatingPanel(panel, 220, 200);
					});
					row.appendChild(q);
				}
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onChange();
					/* rows that open ANOTHER panel (音色/周报) must not
					 * rebuild the settings panel afterwards — the rebuild used
					 * to paint the settings content straight over the panel
					 * that had just opened, so clicking 音色 did "nothing"
					 * (user-reported bug). */
					if (!keepOpen) openSettings();
				});
				panel.appendChild(row);
				return row;
			};
			mkSection('通知');
			mkRow('🔔 开工通知', CONFIG.notifyOnStart ? '开' : '关', function () {
				if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
			}, false, '任务开始跑时说一声"开工了"；关掉后只有结果通知（完成/失败等）才说话。');
			var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
			var dndCur = CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : '关';
			var dndIdx = -1;
			DND_PRESETS.forEach(function (pr, i) {
				if (pr && pr[0] + '-' + pr[1] === dndCur) dndIdx = i;
			});
			mkRow('🌙 免打扰', dndCur, function () {
				var next = DND_PRESETS[(dndIdx + 1) % DND_PRESETS.length];
				if (next) applyConfig({ dndEnabled: true, dndFrom: next[0], dndTo: next[1] });
				else applyConfig({ dndEnabled: false });
				saveConfig();
			}, false, '该时段只默默记红标不出声；需要你选择/审核的急事照常提醒。');
			mkSection('声音');
			mkRow('🔊 音量', Math.round(CONFIG.volume * 100) + '%', function () {
				var i = VOL_STEPS.indexOf(CONFIG.volume);
				if (applyConfig({ volume: VOL_STEPS[(i + 1) % VOL_STEPS.length] })) saveConfig();
			}, false, '提示音大小，点一下换一档。');
			mkRow('🎵 音色', '按通知设置 →', function () {
				openSoundPicker();
			}, true, '完成/失败/提问、定时提醒四类通知各配各的音效。');
			mkSection('监控');
			mkRow('⏱️ 工具超时', Math.round(CONFIG.toolStuckMs / 1000) + 's', function () {
				var i = TOOL_PRESETS.indexOf(CONFIG.toolStuckMs);
				if (applyConfig({ toolStuckMs: TOOL_PRESETS[(i + 1) % TOOL_PRESETS.length] })) saveConfig();
			}, false, '单个工具跑超过这个时长就提醒一次"可能卡住了"，不会打断任务。');
			var P_PRESETS = [50, 60, 70, 80, 90];
			mkRow('🚨 压力提醒', (CONFIG.pressureWarnPct || 70) + '%', function () {
				var i = P_PRESETS.indexOf(CONFIG.pressureWarnPct || 70);
				if (applyConfig({ pressureWarnPct: P_PRESETS[(i + 1) % P_PRESETS.length] })) saveConfig();
			}, false, '上下文占用到这个百分比就提醒 /compact，防止回复被截断。');
			mkSection('数据');
			mkRow('📊 任务周报', '最近 7 天', function () {
				openReport();
			}, true, '最近 7 天每天完成多少任务、花了多少 tokens。');
			mkRow('📤 导出历史', 'Markdown', function () {
				exportHistory('md');
			}, true, '把全部历史整理成 Markdown 复制到剪贴板。');
			mkRow('📤 导出历史', 'CSV 下载', function () {
				exportHistory('csv');
			}, true, '把全部历史下载成 CSV 表格文件。');
			/* 诊断 group; the manual is NOT a row here: 使用说明 lives in the
			 * right-click menu only (user request, 2026-09-04 — settings
			 * stays settings, the manual is a doc) */
			mkSection('诊断');
			mkRow('🩺 运行状态', '点此查看', function () {
				openHealthPanel();
			}, true, '鲸鱼自查各条通知链路是否正常；平时全部正常、不打扰，出问题我头上会亮 ⚠️。');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			mkRow('🩺 调试模式', debugNow ? '开（取证中）' : '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
			}, false, '排障时才开：往控制台输出调试信息，平时保持关闭。');
			/* 设置 itself is opened from the right-click menu: back goes to
			 * the menu (user request: bottom-left 返回菜单) */
			mkPanelFoot(panel, null, true);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 200);
		}

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
				['气泡跳转', rep.jump === 'ok' ? '✅ 可用' : '⚠️ 不可用（走侧栏兜底）']
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
			hint.textContent = '多数失效是页面过期：按 Ctrl+F5 刷新即可恢复；仍失效请看控制台 [🐋] 日志';
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
				(ctxPanel && ctxPanel.classList.contains('show'));
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
			safeSet(POS_KEY, {
				x: whale.offsetLeft,
				y: whale.offsetTop
			});
		}

		function loadPos() {
			var pos = safeGet(POS_KEY, function (v0) {
				/* migrate { x, y } -> v1 */
				return (v0 && typeof v0 === 'object' && typeof v0.x === 'number' && typeof v0.y === 'number') ? v0 : null;
			});
			if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y);
				return true;
			}
			return false;
		}

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
			/* arrival splash: flowing-water burst + a little bounce */
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
			whale.classList.add('dsh-whale-splash');
			setTimeout(function () {
				whale.classList.remove('dsh-whale-splash');
			}, 600);
			wiggle();
			updateStatusPos();
			uiSay(ARRIVAL_LINES[Math.floor(Math.random() * ARRIVAL_LINES.length)]);
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

		/** Animated directional swim back to the default corner. */
		function swimToCorner() {
			closeCtxFloats(); /* swimming away closes any open float */
			var x0 = whale.offsetLeft;
			var y0 = whale.offsetTop;
			var x1 = window.innerWidth - whale.offsetWidth - DEFAULT_RIGHT;
			var y1 = window.innerHeight - whale.offsetHeight - DEFAULT_BOTTOM;
			safeRemove(POS_KEY);
			if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return;
			if (reducedMotion()) {
				applyPos(x1, y1);
				return;
			}
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
				lastRipple: 0
			};
			requestAnimationFrame(swimFrame);
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
		 * in 设置 → ❓ 操作说明, which also stays in sync with the help panel */

		loadPos();

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
		window.__dshWhale.openHelp = openHelp;
		window.__dshWhale.openHistory = openHistory;
		window.__dshWhale.openSettings = openSettings;
		window.__dshWhale.openReport = openReport;
		window.__dshWhale.openReminders = openReminders;
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
/* ---- module: src/core/exports.js ---- */

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
