# 🐋 whale.js 函数导航（构建时自动生成，勿手改）

> 由 node build-whale.js 产出：每个模块的职责（取文件头注释首段）与顶层函数清单。
> 改代码前先在这里定位模块，再进 src/ 对应文件；改完重新构建本表自动更新。

共 32 个模块（构建产物为单文件 IIFE，全部模块共享同一作用域）。

## **src/index.js**（行切片）

> dsh-whale — companion mascot for the DeepSeek Harness Web UI.  - Draggable: pointer-drag moves it anywhere; position persists in   localStorage ("dsh-whale:pos"). Double-click makes it SWIM back to the   default corner: it turns to face the direction of travel (mirrored logo   whale + live heading f

## **src/utils/constants.js**

> Centralized magic values (inline module authored after the split). Consumers reference these names instead of raw literals.

## **src/types.js**

> Type contracts (JSDoc only — no runtime effect). Describes the shapes the whale exchanges with the host mux stream and its own internal state. Editors (and optional `tsc --checkJs`) surface these. Inline module: authored, not a line slice.

## **src/utils/storage.js**

> Versioned localStorage wrapper (inline module).  Every persisted key is stored as:     { v: 1, data: <payload> }  safeGet  : reads v1, or reads a legacy v0 shape and MIGRATES it to v1            immediately (best-effort write-back). Corruption / private mode            degrade silently to a default.

**safeGet()** · **safeSet()** · **safeRemove()**

## **src/utils/session-key.js**

## **src/core/config.js**

> User configuration (inline module). Defaults live here; persisted overrides live in 'dsh-whale:config' (v1 envelope) and are merged over the defaults on load. Unknown saved fields are dropped so a future schema cannot leak.  Load once at startup (startMux bootstrap); save on every settings change.

**loadConfig()** · **saveConfig()** · **applyConfig()**

## **src/core/history.js**

> Task history (inline module): the most recent finished main-task records, newest first, persisted as 'dsh-whale:history' (v1 envelope, cap 50). Consumed by the history drawer (ui/history.js) and the fail-recall hint (M3.2, via recentFailAt).

**getClearAt()** · **bumpClearAt()** · **dedupeKey()** · **mergeHistories()** · **pushCloudHistory()** · **pullCloudHistory()** · **loadHistory()** · **pushHistory()** · **correctHistoryTitle()** · **recentFailAt()**

## **src/core/stuck.js**

> Tool-stuck detection (inline module).  Tool calls are SINGLE frames on the mux (no heartbeat while a slow job runs), so a bare time-based watchdog would mis-flag legitimate long jobs (e.g. `Start-Sleep 30`). Rule: a tool call is only "stuck" when it has been pending longer than CONFIG.toolStuckMs AN

**sessionHasRunningJob()** · **trackToolCall()** · **clearTool()** · **clearSessionTools()** · **scanStuckTools()** · **showStuckHint()** · **hideStuckHint()** · **refreshStuck()**

## **src/core/chip-gate.js**

> Pure chip-gate policy for the alpha adapter — NO DOM, NO timers of its own: every input is a fact gathered by the MutationObserver callback and `now` is injected, so the whole policy is unit-testable. The test file requires this module directly (the browser build shares it inside the IIFE; `module` 

## **src/core/alpha-adapter.js**

> Alpha adapter (inline module, M5 alpha-compat): synthesizes mux-equivalent event frames from DOM observations. dsh 0.1.2-alpha removed the WebSocket event mux; the web UI is per-request streaming + DOM rendering.  The gate POLICY lives in core/chip-gate.js as a pure function (unit tested); this file

**ensureRegistered()** · **parseTokNum()** · **readTurnUsage()** · **applyPageTitleFallback()** · **seedActiveTitle()** · **synthOn()** · **synth()** · **feedSessionUsage()** · **chipAgeMinutes()** · **batchInFlow()** · **debugOn()** · **debugInject()** · **dumpComposer()** · **describeEl()** · **ensureToolSweep()** · **attach()**

## **src/core/dedup.js**

> Cross-channel event dedup (inline module): ONE place that owns every "this exact event already spoke" decision, with EXPLICIT keys and RING-CAPPED storage (the three ad-hoc maps this replaces — bgSeen, attSeen-writes and the single-slot lastEndFire — grew without bound or could shadow each other; th

## **src/core/server-events.js**

> Server-events consumer (inline module): polls the whale-assistant host's /api/whale-assistant/events route (the host lives in the dsh server's cordis container and buffers session events for EVERY session) and feeds the frames the DOM adapter cannot see:    - turn/start of EVERY session (2026-09-02 

**rememberSeq()** · **feedEventFrame()** · **registerBackground()** · **lookupTitlesFromHistory()** · **consume()** · **poll()**

## **src/core/health.js**

> Dependency self-check (inline module): the whale fails QUIETLY by design (a stale DOM selector or a missing event route just means no notifications), and twice already that silence hid real breakage for days (the f.time ReferenceError, the rc.1 usage-DOM migration). This module makes degradation VIS

**markServerPoll()** · **recordUsageHealth()** · **runHealthCheck()** · **updateHealthChip()** · **ensureHealthChip()** · **openHealthPanel()**

## **src/core/state.js**（行切片）

> job id -> { status, label, kind, sessionId }

## **src/core/reports.js**（行切片）

> Unread job-report count: accumulates reports, one click reads one.

**say()** · **renderUnread()** · **sessionTotalTokens()** · **statusReport()** · **pushReport()** · **readNext()**

## **src/core/dings.js**（行切片）

> One synthesized notification. 'done' = bicycle-bell "ding-ding": two metallic strikes (2400Hz fundamental + 2×/2.76× inharmonic partials) with a long resonant decay. 'fail' = dull descending minor third (550 → 415). Back-to-back dings stay clear because the queue gap (DING_GAP_MS) outlasts the ring'

**ensureAudio()** · **renderDing()** · **pumpDings()** · **dndActive()** · **playDing()** · **setSoundMuted()**

## **src/ui/status-panel.js**（行切片）

> Status panel: an independent surface placed LEFT or BELOW the whale (whichever side has room), so live tool status and the per-task token/pressure report NEVER collide with the speech bubble (notifications) or the click summary.

**ensureStatusEl()** · **updateStatusPos()** · **estWidth()** · **applyStatusText()** · **ensureReportEl()** · **hideReportBox()** · **stuckPendingNow()** · **showStatusPanel()** · **renderDisplaced()** · **hideStatusPanel()** · **markStatusBusy()** · **showStatus()** · **fmtTokens()** · **pressurePct()** · **maybeWarnPressure()** · **pressureColor()** · **applyPressureHue()** · **runTimerLine()** · **capNameWidth()** · **timerRowText()** · **runningSessionCount()** · **multiRunTag()** · **ensureTimerEl()** · **hideTimerBox()** · **runTimerTick()** · **startRunTimer()** · **stopRunTimer()**

## **src/core/sleep.js**（行切片）

> Any real activity resets the nap timer; if asleep, wakes with a line. Pass silentWake=true when the waking frame announces itself (task turns, attention requests) — the generic mumble would only be overwritten a tick later anyway.

**goSleep()** · **wakeUp()** · **touchActivity()**

## **src/core/gear.js**（行切片）

> Local-date key "YYYY-MM-DD" (the daily counter's bucket).

**todayKey()** · **resetUnlockedGear()** · **loadGearStats()** · **saveGearStats()** · **checkDayRollover()** · **unlockCheck()**

## **src/core/affection.js**（行切片）

> Sub-tasks (background jobs) never announce: no bubble, no unread, no sound — they only move the workload/mood state and feed the click summary. Only the main task (conversation turns) and attention requests (approval/question) produce notifications.  A second kind of sub-task is a spawned SUBAGENT: 

**loadAffection()** · **saveAffection()** · **affectionTier()** · **petLine()**

## **src/core/frames.js**（行切片）

> Completed subtasks for one session since a moment — the run timer's "已完成 N 个子任务" count (see ui/status-panel.js).

**isMainSession()** · **isFailedJob()** · **handleJobsFrame()** · **countJobsCompleted()** · **handleSubscribedFrame()** · **rememberTitle()** · **bookTitle()** · **correctReports()** · **fetchSubagentLabel()** · **flushHeld()** · **handleProjectionFrame()** · **reportTurn()** · **handleEventFrame()** · **reportAttention()** · **handleAttentionFrame()** · **handleMuxPayload()**

## **src/utils/fmt-title.js**（行切片）

> git subcommand -> short Chinese verb.

**truncate()** · **taskTitle()**

## **src/core/mux.js**（行切片）

**startMux()** · **scheduleReconnect()**

## **src/ui/swim-effects.js**（行切片）

> Heading (degrees, clockwise from east) of the path tangent at t.

**easeInOutCubic()** · **bezierPoint()** · **bezierHeading()** · **reducedMotion()** · **ensureRippleLayer()** · **spawnRipple()** · **spawnWaterSplash()**

## **src/ui/messages.js**（行切片）

> Said when the whale is grabbed mid-swim.

**pickTail()**

## **src/core/mood.js**（行切片）

> Lines spoken while idle, per mood stage (gradually mixed in).

**completedTail()** · **updateMood()** · **bumpWork()** · **moodStageIndex()** · **pickIdleLine()** · **pickCatchLine()** · **loadPetHint()** · **savePetHint()** · **hasRunningJobs()** · **idleTick()**

## **src/ui/bubble.js**（行切片）

> Faint transient note above the whale (clear-all feedback #10): never a bubble, never unread, never a sound — auto-fades, then removes.

**uiSay()** · **armBubbleHide()** · **bubbleResumeMs()** · **bindBubbleHover()** · **showWhaleNote()**

## **src/ui/bootstrap.js**（行切片）

> Mark the report currently shown in the bubble as READ: remove it from the unread queue (or resolve an in-flight replay), so the badge drops by one. Called after a double-click jump — the report the user just acted on must not still be waiting in the queue.

**uiInit()**

## **src/ui/menu.js**（行切片）

> Sub-panel footer. Back follows the navigation hierarchy 菜单 → 设置 → 子面板 (user request): panels entered from the right-click menu (提醒我) return TO THE MENU; panels entered from settings (音色/周报/运行状态) return to settings.

## **src/input/swim.js**（行切片）

> Animated directional swim back to the default corner.

## **src/input/drag.js**（行切片）

> Quick trembling shake of the whale's body (used when caught).

## **src/core/exports.js**（行切片）
