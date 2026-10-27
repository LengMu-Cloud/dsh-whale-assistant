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
			if (ctxHistory) ctxHistory.classList.remove('show');
		}
