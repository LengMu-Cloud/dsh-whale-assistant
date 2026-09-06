# 调试与测试导出缝清单（`window.__dshWhale`）

运行时缝在 `src/core/exports.js` 末尾统一挂载（构建后位于 `whale.js` 尾部，同一 IIFE 作用域内）。

- **浏览器控制台 / CDP**：`window.__dshWhale.<name>`（壳自带调试口 9222，可用 `cdp-eval.js` 直读）
- **单元测试**：`test-whale.js` 在 vm 沙箱加载 `whale.js` 后读取同一命名空间做断言

## 状态只读（无副作用）

| 缝 | 返回 | 来源 |
|---|---|---|
| `version` | 当前 PATCH_VERSION | utils/constants.js |
| `mood()` | 当前班味等级 key | core/mood.js |
| `workLoad()` | 累计工作量 | core/mood.js |
| `affection()` | 好感度 | core/mood.js |
| `asleep()` | 是否睡眠中 | core/mood.js |
| `unreadCount()` | 未读通知数（含正在读的一条） | ui/bootstrap.js |
| `reportQueue()` | 未读通知队列引用 | ui/bootstrap.js |
| `turnTokens()` | 当前回合 token 用量投影 | ui/status-panel.js |
| `debugCounters` | 诊断计数器对象 | core/health.js |
| `gearStats` / `unlockedGear` | 装扮进度 / 已解锁装饰 | core/mood.js |
| `known` / `subagentSessions` | 已知会话集 / 后台会话投影 | core/frames.js |
| `toolSlot` | 工具卡占用状态 | ui/status-panel.js |
| `soundMuted()` | 全局静音状态 | core/config.js |

## 行为触发

| 缝 | 作用 |
|---|---|
| `playDing(kind)` | 播放指定类别音效（done/fail/attn/remind） |
| `setSoundMuted(b)` | 设置全局静音 |
| `applyConfig()` / `saveConfig()` | 重读 / 持久化配置 |
| `bumpWork(delta)` | 加减工作量（影响班味） |
| `pickIdleLine()` / `petLine` | 闲话台词选取 / 摸头台词库 |
| `taskTitle(frame)` | 从帧提取任务显示名 |
| `spawnRipple(x, y)` | 在指定位置播放单击涟漪 |
| `showWhaleNote(text, ms)` | 极淡自动消散提示（如「已清空 N 条通知」） |
| `scanStuckTools()` | 重扫卡住的工具卡（压力色） |
| `pressureColor` / `applyPressureHue` | 上下文压力配色换算与应用 |
| `handleJobsFrame` / `handleSubscribedFrame` / `handleMuxPayload` | 事件帧入口（手工注入帧做回归） |

## 台词库（数组，测试断言用）

`catchLines`（被抓）· `tiredCatch`（疲惫被抓）· `idleLines`（闲话）· `moodLines`（班味分层）· `todayKey()`（当日 key）

## 测试专用缝（`_` 前缀，勿在产品逻辑中使用）

| 缝 | 作用 |
|---|---|
| `_resetDing()` | 作废音效队列（pending 声音不再渲染） |
| `_setHoldMs(ms)` / `_setBaselineTtl(ms)` / `_setSleepMs(ms)` | 覆盖悬停保持 / 基线过期 / 入睡阈值 |
| `_setGearDay(key)` / `_rolloverDay` | 伪造装扮日期 / 手动触发跨日重置 |
| `_health.run()` / `.seed(o)` / `.state()` | 立即自检 / 注入依赖失效场景 / 读当前健康态 |
| `_dedup.seeAttention` / `.seeEndFire` / `.endFiredRecently` | 跨通道去重 key 的直接访问 |
| `_runTimer.start(sid, startAtMs?)/stop/line/count/rows(now?)/state` | 长任务计时（每会话一槽）：启停（start 可回拨起点，测试用）/ 文案纯函数 / 完成数 / 各会话命名行（可传 now 越过 2 分钟门槛）/ 运行态 `{active,count,sessions,session}` |
| `_bubble.resumeMs` | 悬停暂停后的剩余时长换算（1.5s 保底） |
| `_idleGuide.tick/lines/count` | 强制触发闲置引导（跳过概率门控）/ 台词 / 计数 |
| `_dismissBubble()` | 关闭当前气泡并立即完成"正在读"状态 |
| `_feedEventFrame(frame)` | 直接驱动轮询帧门（活跃会话跳过 + 完成跨通道去重），免等 3s 轮询 |

## 宿主半区路由（`whale-assistant/lib/index.js`，仅回环地址可访问）

| 路由 | 用途 |
|---|---|
| `GET /api/whale-assistant/state` | 读历史存储（`~/.dsh/whale-assistant.json`） |
| `POST /api/whale-assistant/save` | 写历史存储（clearAt 范围清空也走这里） |
| `GET /api/whale-assistant/assets` | 鲸鱼样式 + SVG（发布布局优先 `lib/parts/`） |
| `GET /api/whale-assistant/whale.js` | 页面半区脚本（发布布局优先 `lib/whale.js`，构建时自动同步） |
| `GET /api/whale-assistant/events` | 事件帧轮询（后台通知数据源） |
| `POST /api/whale-assistant/dev-say` | 回环专用无人值守注入（`{sessionId, text}`，回归测试用） |
| `POST /api/whale-assistant/debug` | 调试模式取证数据写入 `_debug` |
