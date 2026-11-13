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
