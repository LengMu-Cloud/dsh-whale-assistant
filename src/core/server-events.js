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
					typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
					try { window.dispatchEvent(new CustomEvent('dsh-whale:pet-jump', { detail: { sessionId: f.sessionId, atMs: typeof f.atMs === 'number' ? f.atMs : undefined } })); } catch (e) {}
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
				if (!PET_MODE && Date.now() - rpTime < 10000 &&
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
				if (!PET_MODE && Date.now() - osTime < 10000 &&
					typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
					try { window.dispatchEvent(new CustomEvent('dsh-whale:pet-open-settings')); } catch (e) {}
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
					if (f.sessionId !== resolveCurrentSessionId()) {
						var v = f.value;
						var title = typeof v === 'string' ? v : (v && typeof v.title === 'string' ? v.title : null);
						if (title) {
							try { sessionTitles.set(f.sessionId, title); rememberTitle(f.sessionId, title); } catch (e) {}
							try {
								var subs = window.__dshWhale && window.__dshWhale.subagentSessions;
								var info = subs && subs.get(f.sessionId);
								if (info && !info.title) info.title = title;
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
	function connectSSE() {
		/* 11-06 枚举 SSE 流（用户实报「任务通知有延时」）：宿主现在按 pet
		 * token 把 SSE 连接分流——桌宠连接收到的是逐帧枚举载荷（与 /pet/feed
		 * 同一码本同一边界），页鲸连接照旧收全量帧。桌宠通知从 3s 轮询节奏
		 * 变成即时推送；轮询保留作断线兜底（EventSource 断开→sseUp=false→
		 * poll 恢复跑 /pet/feed 补漏帧，lastSeq 闸门去重）。 */
		if (typeof EventSource !== 'function') return; /* vm sandbox / ancient browsers */
		try { sse = new EventSource('/api/whale-assistant/events/stream'); } catch (e) { return; }
		sse.onopen = function () { sseUp = true; };
		sse.onerror = function () { sseUp = false; }; /* EventSource auto-reconnects */
		sse.onmessage = function (ev) { handleSseData(ev.data); };
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
