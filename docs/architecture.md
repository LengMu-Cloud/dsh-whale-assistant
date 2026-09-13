# 架构与分层（architecture.md）

> 本文沉淀自 2026-09-13 的六轮外部架构评审（DeepSeek ↔ Agent 对抗审计）。
> **所有数字可复核**：`node scripts/audit-deps.js`（静态审计，含自检）；
> **机械 guard 在构建时强制**：`node build-whale.js`（重复声明断言 / menu 热点 / 耦合登记表）。
> 本文只做"解释层"——约束的载体是代码标记与构建检查，不依赖任何人读文档。

## 1. 构建形态

31 个切片文件 + authored inline 模块按 `whale-manifest.js` 序拼回 `whale.js`
单文件 IIFE（当前 32 模块 = 20 行切片 + 12 authored）。**src/ 即维护面**；
`whale.js`/`whale-assistant/lib/` 是构建产物（`node build-whale.js` 重建并逐字节同步发布副本）。
构建时强制三项检查（详见 §7）：246 个顶层符号的重复声明断言、menu 热点双 guard、
KNOWN-COUPLING 登记表打印。

## 2. 作用域三层（拼回原始文件后的真实作用域）

| 层 | 内容 | 规则 |
|---|---|---|
| **IIFE 全局域**（depth 1） | `utils/` 全部、`core/` 全部、`ui/status-panel`、`ui/bubble`、`ui/messages`、`ui/swim-effects` | 全局域符号互相可见（函数声明提升） |
| **三个闭包**（depth ≥2） | ① `core/alpha-adapter` 整模块自包 IIFE（带环境 early-return）② `core/server-events` 的 `initServerEvents` IIFE ③ `uiInit` 巨闭包 = bootstrap→menu→drag 跨文件连续切片（menu 全部 34 个函数、9 个抽屉都是 uiInit 局部） | 闭包内符号**只**对同 span 文件可见；对外只经 `window.__dshWhale` 缝 |
| **window 缝** | `window.__dshWhale`（index.js 初始化） | 跨闭包委托 / 诊断 / 测试唯一通道；80 条显式命名导出 + 16 处防御式读，10 种动态访问模式全零（audit-deps E 节） |

## 3. 依赖图（142 条模块级边，audit-deps B/C 节）

- **core→ui/input 共 12 条**：5 条组合根（`exports.js` 装配，职责使然）+
  7 条 push 管线（frames→status-panel/messages、reports→status-panel/bubble、
  stuck/server-events→status-panel、mood→messages）。
- **真互指 3 组**：frames↔status-panel、reports↔status-panel、mood↔messages。
  前两组的回读点以 `// KNOWN-COUPLING:` 标记在代码里（构建时打印，见 §7）。
- **ui→core 控制面（0.3.3 +1，总边 141→142）**：menu→frames（`clearTitleBook`
  清空通讯录）——与既有 bookTitle/countJobsCompleted 查询同向，属于既定
  「ui 只走控制面/查询函数」准入。
- **push vs 订阅（评估后保留 push）**：回读内容是面板自有状态的投影写入
  （frames 把 sessionUsage/sessionPressure 写进面板槽位、面板回调查询函数）。
  订阅化需引入事件分发层、改造 6 个 push 调用点、触发全量真机回归；收益仅是
  依赖图面纯净，且通知路径依赖同步推（无队列延迟）。`chip-gate.js` 证明本项目
  在值得解耦处会做纯函数化——这里不做是成本判断。

## 4. 三档准入（新功能落点的判断规则）

| 档 | 模块（文件） | 判据 |
|---|---|---|
| **契约层**（破=通知承诺破）14 | alpha-adapter、server-events、mux、frames、chip-gate、dedup、state、reports、bubble、dings、config、storage、constants、**session-key** | 动它必须全量真机回归 |
| **承诺配套** 6 | status-panel（1:1 面板承诺）、stuck（看门狗）、health（自检护栏）、exports（组合根）、input/drag、input/swim | 动它跑相关单测 + 目标功能真机确认 |
| **增强层** 8 | menu、history、mood、gear、affection、sleep、swim-effects、messages | 默认落点；单测覆盖即可 |
| 入口/类型 2 | index.js、types.js | —— |

**准入规则**：①新功能默认进增强层；②动契约层 = 全量真机回归（真机流水线见
`升级方案-DSH-0.1.5.md` 附录 C）；③core/ 目录名 ≠ 核心契约——mood/gear/affection/sleep
住在 core/ 但是增强（拟人化是产品一等需求，见 32 条用户决策），以本表为准。

## 5. 动态缝清单

- 出口：`exports.js` 48 条（诊断/测试缝，`_` 前缀=测试专用，`docs/seams.md` 有逐条表）
  + `drag.js` 23（UI 缝）+ 其余模块 9 = **80 条显式命名导出**。
- 读侧：**16 处防御式读**（`window.__dshWhale && ...` 带 guard），构成静态图之外的
  4 条真实跨闭包边（server-events→stuck 的 _trackTool/_clearTool、status-panel→stuck、
  mood→exports/menu、menu→exports）。
- 回调注册 2 处：`reports.onUnreadChange`（bootstrap 赋值）、`mux sockets` 数组。
- 动态键：10 种遍历/拼接/解构/展开模式**全零**（audit-deps E3 节）——缝命名空间
  静态可枚举，新形态出现时把模式加进 E3 清单。

## 6. 时序契约（sessionTitles）

- **写者 3 个**（通道侧）：frames（路由投影）、alpha-adapter（DOM 提取）、
  server-events（轮询回填）——都是 `.set()`，audit-deps D 节。
- **读者全部走显式回退链**：`sessionTitles.get(id) || bookTitle(id) || '未命名任务'`
  （status-panel ×2、stuck ×1、frames 内部 ×2）；health 只读 `.size` 诊断计数。
  09-05 标题污染链修复的产物：未知→占位，晚到→correctHistoryTitle 三处改写。
- **锁**：audit-deps F 节 lint——非 owner 文件的 `sessionTitles.get(` 必须带
  `||` 回退或 get-then-set 守卫，否则 LINT FAIL。

## 7. 债务登记与触发线（构建时强制/打印）

| 债务/触发线 | 机械检测 | 状态 |
|---|---|---|
| menu.js 是唯一热点（1378 行，其中历史/周报/提醒/导出数据抽屉群 ~41%） | `open*` 抽屉函数 >9 或行数 >1450 → 构建 WARN | 未触发；**触发后先拆历史抽屉群（~567 行）再加新抽屉** |
| mood↔messages 文案互取（1 函数边 + 文案常量互读） | 人工（可消除：WEARY_TAILS 归位 messages + pickTail 传参，~15 分钟） | 与 menu 拆分同批执行 |
| 位置常量 POS_KEY/DEFAULT_* 住在文案池 messages.js | 人工（归位 utils/constants） | 同上 |
| push 架构回读点 | `// KNOWN-COUPLING:` 代码标记 ×5（构建时打印清单） | 已登记：frames→status-panel 投影写 ×2 + push 渲染 ×1、status-panel→frames 回查 ×1、reports→status-panel 配对 ×1 |
| 同名顶层声明（共享作用域会静默遮蔽） | build-whale.js 断言（var/let/const/function 四形态，246 符号） | 0 重复；session-key 已收敛（原 alpha-adapter/server-events 各一份逐字节相同的解析已并入 utils/session-key.js） |

## 8. 审计方法与修正记录

- 工具：`scripts/audit-deps.js`——按 manifest 序拼回原始单文件做**花括号深度追踪**
  （31 文件本来就是同一文件的连续切片，逐文件分析在作用域上是错的）。
- 自检前置（G 节）：跨行模板串 / 正则字面量花括号平衡与引号 / 注释花括号，检出
  干扰即宣告深度结论不可靠。当前全净。
- v1→v3 修正（对抗评审的价值记录）：v1 的 min-indent 启发式产生过三个错误结论——
  幻影共享变量 bubble（实为函数局部）、"FALLBACK_ID 双声明静默覆盖"（实为两个
  IIFE 各自的同名局部）、"openHealthPanel 遮蔽死代码"（实为刻意的缝委托设计）；
  互指 5 组→3 组（2 条假边）；写者检测补 `.set()` 后 sessionTitles 1→3。
  已知局限：名字匹配法对同名局部变量有噪声（B2 节），沉淀真 AST 是远期方向。
- 升级适配的机器核验另见 `check-dsh-compat.js`（--static 对新版 DSH 包扫耦合点
  特征 / --live 对运行实例探活），人工项见 `升级方案-DSH-0.1.5.md` 附录 C。
