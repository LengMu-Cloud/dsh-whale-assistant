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
	}