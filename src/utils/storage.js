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