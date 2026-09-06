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
