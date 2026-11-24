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
	}

	/* —— 压力提醒日志（BUG-F，2026-11-24 用户拍板口径 A）——
	 * 口径：上下文压力提醒**计入红标**（未读队列）、**不写历史账本**（历史只收
	 * 任务事件）、**周报可计次**。这里只维护一条轻量时间线，页鲸侧 localStorage，
	 * 90 天 / 500 条滚动；周报汇总卡按 7 天窗口计数。 */
	var PRESSURE_LOG_KEY = 'dsh-whale:pressureLog';
	var PRESSURE_LOG_CAP = 500;
	var PRESSURE_LOG_TTL_MS = 90 * 864e5;
	function recordPressureWarn(at, pct) {
		var t = typeof at === 'number' ? at : Date.now();
		var log = safeGet(PRESSURE_LOG_KEY);
		if (!Array.isArray(log)) log = [];
		log.push({ at: t, pct: typeof pct === 'number' ? pct : null });
		var cutoff = t - PRESSURE_LOG_TTL_MS;
		log = log.filter(function (e) { return e && typeof e.at === 'number' && e.at >= cutoff; });
		if (log.length > PRESSURE_LOG_CAP) log = log.slice(log.length - PRESSURE_LOG_CAP);
		safeSet(PRESSURE_LOG_KEY, log);
		return log.filter(function (e) { return e.at >= t - 604800000; }).length;
	}
	function pressureWarnCountSince(sinceMs) {
		var log = safeGet(PRESSURE_LOG_KEY);
		if (!Array.isArray(log)) return 0;
		var since = typeof sinceMs === 'number' ? sinceMs : 0;
		var n = 0;
		for (var i = 0; i < log.length; i++) {
			if (log[i] && typeof log[i].at === 'number' && log[i].at >= since) n++;
		}
		return n;
	}