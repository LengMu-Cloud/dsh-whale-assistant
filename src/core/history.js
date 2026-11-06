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
	}