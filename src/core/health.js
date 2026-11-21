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

	/** M5 通知链路可信度计数（0.4.3 阶段 B，度量地基）：通知链路的三类降级
	 * 信号各计一个数，落 localStorage 键 dsh-whale:m5（页鲸侧自度量——宿主
	 * 账本不收页指标）。形状 {healthFail:N, sseCircuit:N, sseProbeOk:N}，
	 * 三个计数各自钳顶 9999（4 位定宽，防溢出也封住 JSON 体积）。「计数+1」
	 * 统一走本助手——三处调用点（本文件 healthFail / server-events.js 的
	 * sseCircuit+sseProbeOk）不得各写一份 localStorage 逻辑。坏形状（手改/
	 * 损坏/未知键）一律整键重开为 0，不炸功能。 */
	var M5_KEY = 'dsh-whale:m5';
	var M5_KINDS = { healthFail: 1, sseCircuit: 1, sseProbeOk: 1 };
	function m5Count(kind) {
		if (!M5_KINDS[kind]) return; /* 白名单闸：未知信号不造键（形状恒三键） */
		try {
			/* 既有 localStorage 守卫模式：try/catch 整体包裹，隐私模式静默放弃 */
			var raw = JSON.parse(localStorage.getItem(M5_KEY) || '{}');
			var cur = { healthFail: 0, sseCircuit: 0, sseProbeOk: 0 };
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
				for (var k in cur) {
					if (typeof raw[k] === 'number' && isFinite(raw[k]) && raw[k] > 0) cur[k] = Math.min(9999, Math.floor(raw[k]));
				}
			}
			cur[kind] = Math.min(9999, cur[kind] + 1);
			localStorage.setItem(M5_KEY, JSON.stringify(cur));
		} catch (e) { /* 存储不可用：计数静默放弃（度量不炸通知功能） */ }
	}

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
		if (degraded) {
			healthState.everDegraded = true;
			/* M5（0.4.3 阶段 B）：健康检查失败即计一数（server/dom 任一腿 fail
			 * 都算——两条腿都在通知链路上）。每拍失败检查各计一数：计数近似
			 * 「降级持续时长」（60s 节拍），9999 钳顶。 */
			m5Count('healthFail');
		}
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
