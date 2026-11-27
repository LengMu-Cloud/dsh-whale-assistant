# 🐋 dsh-whale-assistant — DeepSeek Harness 的小鲸鱼助手插件

![CI](https://github.com/LengMu-Cloud/dsh-whale-assistant/actions/workflows/ci.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@lengmu-cloud/dsh-whale-assistant?label=npm)](https://www.npmjs.com/package/@lengmu-cloud/dsh-whale-assistant)

> **English** — A third-party plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): a whale companion lives in the bottom-right corner — in-page on the web, and as a real always-on-top desktop pet on the Windows desktop app (the pet appears with DSH and leaves with it) — turning DSH's **read-only event stream** into:
>
> - **Cross-session task notifications** — started / done / needs your review or answer / failed / aborted / truncated, with sounds you can customize per category, plus an unread badge (click = read one, double-click = clear all, badge clears the moment the last one is read);
> - **Usage reports** — per-turn tokens, conversation total, context-pressure percentage with a configurable 20–100% warning threshold;
> - **Task history** — search, range clear, click to jump back to the conversation;
> - **Weekly report & reminders** — 7-day stats, last-night summary, failures-only view, Markdown/CSV export; countdown or wall-clock reminders;
> - **Companion & desktop modes** — petting / friendship / moods / daily props / sleeping, with three desktop forms (full whale / mini glass card / hide-and-seek bubble) and a right-click entry to restart the desktop pet.
>
> **Safety**: read-only — it never intercepts or modifies agent behavior; all data stays local (`~/.dsh/whale-assistant.json` + localStorage); the plugin makes no external network requests.
>
> **Install**: add the plugin index `https://cdn.jsdelivr.net/gh/LengMu-Cloud/dsh-whale-assistant@main/market/market-index.json` in DSH → Plugins → Discover, or use the GitHub / npm routes below.
>
> 中文说明见下；English entry point: [README.en.md](README.en.md)。

住在 DeepSeek Harness（DSH）界面右下角的打工小鲸鱼：在 DSH 页面里，它帮你把任务通知、用量、历史变成鲸鱼旁边的小面板；在 Windows 官方桌面端，它还能从页面里游出来、变成一只贴着壁纸的桌面小鲸鱼。核心用法一句话：**任务跑完点一下通知或历史记录，就跳回对应对话——用桌面小鲸鱼时，它还会顺手把 DSH 窗口叫到前面，不用自己找。**

## 功能一览

### 🔔 通知与跳转（核心用法）

- **任务通知**：开工 / 完成 / 需要你审核或回答 / 失败 / 中止 / 截断——只播报需要你关注的事；后台会话（别的窗口、标签页）也照常通知
- **未读角标（红标）**：小鲸鱼右上角的红色数字，就是还没读的通知数（最多显示 99+）；单击逐条读，双击一键清空
- **点一下回到对话（核心用法）**：**双击通知气泡**或**单击历史记录**，直接跳回对应对话；**用桌面小鲸鱼时它还会把 DSH 窗口叫到前面**——DSH 最小化或被其他窗口挡住时，点一下通知就能回到那个对话
- **定时提醒**：倒计时（5 / 10 / 25 / 60 分钟）或指定时刻；到点连响三声并计入红标——人不在电脑前也不会错过

### 📊 用量与记录

- **用量报告**：任务完成时弹出三行报告——本次任务消耗 / 全对话累计消耗 / 上下文已用百分比
- **压力提醒**：上下文接近上限时提醒你整理上下文；提醒阈值可在设置里调（20%~100%）
- **长任务与卡住提示**：跑得久的任务（超过 2 分钟）会显示已经跑了多久、完成了几个子任务；工具卡住不动时会提醒你
- **历史记录**：可以搜索（大小写都能搜到）、按范围清空（全部 / 7 天前 / 30 天前）；同一台电脑的所有窗口共用一份，单击任一条就能跳回那个对话。支持导出：Markdown 复制到剪贴板 / CSV 下载文件（在 设置 → 数据 里）
- **任务周报**：近 7 天按日统计、今日汇总、按会话明细、失败筛选、昨夜摘要、挂机心跳（在 DSH 侧边栏「📊 周报」或右键菜单「📊 周报」直达）

### 🐋 桌面小鲸鱼（Windows 官方桌面端）

- **小鲸鱼住到桌面上**：打开 DSH 后，小鲸鱼就直接浮在桌面上（没有窗口边框，像贴在壁纸上）；退出 DSH 时一起消失。可以拖到任意位置，下次打开还在原处
- **三种样子，右键「🎭 切换形态」随时换**：
  - 🐋 **完整形态**——整只小鲸鱼浮在桌面上，可以拖动、双击游回角落
  - 🪟 **缩成小窗**——鲸鱼缩成一枚很小的深色玻璃卡片（约 64×64 像素），卡片中间是线条画的小鲸鱼；不挡屏幕，红标和通知照常工作
  - 🙈 **隐藏小鲸鱼（躲猫猫）**——鲸鱼游到屏幕右下角，缩成一枚小水泡；点一下气泡，鲸鱼就重新冒出来
- **右键菜单**（和界面上的图标一一对应）：顶部一行状态「🐳 元气满满 · 待命中 / N 个任务进行中」；下面是 ⏰ 提醒我 · 🔊 声音：开/关 · 🎨 我的装扮 · 📜 历史任务 · ⚙️ 设置 · 📊 周报 · 🖥️ DSH 窗口 ›（🔄 刷新 DSH 窗口 / 🖥️ 打开 DSH 窗口）· 🔄 重启小鲸鱼 · 🎭 切换形态 › · ✕ 关闭
- **桌面交互**：单击互动、双击游回角落、右键双击摸头；双击通知直达对话（**含把 DSH 窗口叫到前面**）
- **更新与自愈**：右键「🔄 重启小鲸鱼」重新加载桌面小鲸鱼；它意外退出会自动回来；系统用不了桌面形态时，自动换回 DSH 页面里的鲸鱼

### 💙 陪伴与个性化

- **互动**：摸摸头加好感度（分层台词、里程碑爱心雨）、班味情绪（越忙越丧）、每日装饰成就（咖啡杯 / 红色安全帽）、睡觉打盹
- **使用说明**：可搜索的完整手册，在 DSH 侧边栏「小鲸鱼助手」页的「📖 使用说明」Tab 里（右键菜单「⚙️ 设置」可直接进侧边栏）
- **设置页**：按 通知 / 声音 / 监控 / 数据 / 诊断 / 关于 分区（音色、一键静音、免打扰时段、工具超时、导出历史都在这里），每项都有一句话说明

### 🩺 可靠性与隐私

- **健康自检**：每 60 秒检查依赖，异常在鲸鱼旁显示 ⚠️ 明细
- **只读安全**：只读任务事件流，不拦截、不修改任何任务；数据只存本机，无外部网络请求
- 当前版本 **0.4.3**（完整说明见 [FEATURES.md](FEATURES.md)，更新记录见 [CHANGELOG.md](CHANGELOG.md)）

> **前提**：这个插件是给已经在用 DeepSeek Harness（DSH）的人用的——DSH 本身要先装好；
> 还没装 DSH 的话，装上插件不会有任何效果。

## 组件关系（插件 / 桌面端 / 壳——谁依赖谁）

| 组件 | 必需？ | 是什么 | 与小鲸鱼的关系 |
|---|---|---|---|
| **插件本体**（`whale-assistant/` + `src/`） | ✅ 必需 | DSH cordis 插件：宿主半区（服务端路由 + 事件/投影订阅）+ 页面半区（`whale.js`） | **全部功能所在**，完全自包含——加载走官方模块清单，跳转走官方 sessions 服务，实时推送走自有路由 |
| **官方桌面端**（DSH 官网分发） | 推荐 | DSH 官方 Electron 桌面应用（独占 `profiles/desktop`） | 插件注册进 desktop profile 即得全功能（0.2.0-rc.2 实测：通知/报告/历史/三行报告/跳转全绿）；**会话跳转已适配 0.2.0**（0.4.1 起，官方 `uiWorkspace.openSession` 导航链） |
| **浏览器** | 可选 | 任意现代浏览器直开 `dsh web` 的地址 | 与官方桌面共享同一份服务端数据 |
| **桌面壳**（`shell/`，**遗留**） | — | 本仓库自制的 Electron 封装（09-03~09-28 使用） | **官方桌面端发布后已退役**（其增量——独立进程/后台不丢通知——官方桌面原生具备）；源码保留供参考，`scripts/fix-shell.ps1` 不再需要 |
| ~~跳转补丁~~（**已退役**） | — | 0.3.x 时代的跳转靠一个手动注入脚本（**从未随本仓库分发**） | **0.4.0 起退役**：跳转已内置。若曾打过它，残留无害，下次 DSH 升级时自然消失 |

依赖方向一句话：**官方桌面或浏览器二选一，插件自己就是全部；壳已成历史。**

---

## 环境要求

| 组件 | 要求 |
|---|---|
| DeepSeek Harness | 兼容下限见 `whale-assistant/package.json` 的 `dsh.engines`（`>=0.1.7`）；已在 **0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.3 / 0.2.2-rc.5** 上实测。插件只走公开插件接口与 HTTP 路由，官方 UI 改版不影响通知与用量数据（压力数据走 DSH 服务端投影） |
| Git | 路径 A 的 install.ps1 用它克隆仓库（已装可跳过克隆、用 `-Repo` 指向本地副本）；路径 C（插件索引）不需要 |
| Node.js | 跟随 DSH 自身要求即可（开发机 v24 实测）；仅改源码/构建/跑测试时需要 |
| 操作系统 | 插件本体为纯 JS，跨平台；自动化脚本为 PowerShell（Windows），macOS/Linux 按下文手动步骤 |
| 运行载体 | **官方桌面端**（推荐）/ 任意现代浏览器；本仓库 Electron 桌面壳已退役（遗留参考） |

## 能力矩阵（先看这个再安装）

| 能力 | 网页版（浏览器访问 dsh web） | 官方桌面端（推荐） |
|---|---|---|
| 任务通知 / 用量面板 / 运行计时 / 历史（搜索·范围清空·单击跳转对话） / 周报 / 提醒 | ✅ 开箱即用 | ✅ 开箱即用 |
| 陪伴系统（摸头好感 / 爱心 / 班味情绪 / 装饰成就 / 使用手册） | ✅ | ✅ |
| 多窗口/多端历史同步（同一台机器） | ✅ 服务端镜像，自动合并 | ✅ 同左 |
| 后台任务通知实时性 | ✅ SSE 实时推送（0.4.0 起）；标签页被浏览器「内存节省」丢弃时例外 | ✅ 实时（SSE；桌面应用无标签页节流问题） |
| 官方插件管理页启停（0.4.1 起） | ✅（dsh web 0.1.7+） | ✅（0.2.0+，「已安装」卡片+开关） |
| 小鲸鱼形态（桌面常驻、三种形态，0.4.2 起） | ❌（页内鲸鱼形态） | ✅ 仅 Windows 官方桌面端（独立桌面进程+自动自愈） |
| 应用级稳定性（崩溃自恢复等） | 不适用（浏览器自己管） | 官方桌面自带（非插件职责） |
| 页面刷新 | 浏览器 F5 | 右键菜单 **🔄 刷新页面**（官方桌面无 F5） |
| 跨机器同步 | ❌ 明确不支持（历史存在各自机器的 `~/.dsh/whale-assistant.json`） | ❌ 同左 |

> 插件功能两版**完全一致**，完整清单见 [FEATURES.md](FEATURES.md)。本仓库旧自制
> Electron 壳已**退役**（09-29 起，官方桌面端覆盖其全部增量——源码保留 `shell/` 供
> 参考）。组件之间的依赖关系见「组件关系」一节。

## 与同类插件对比

> 同类项目按 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录表取 **2026-11-27 的公开简介**；`—` 表示其公开简介未提及（不代表不具备）。只列差异点，不做优劣评判。

| 能力 | 小鲸鱼助手 | dsh-pet（zealot00） | dsh-pet（FlytoMAYDAY80） | dsh-token-pet | dsh-whale-galgame | whale-girl |
|---|---|---|---|---|---|---|
| 载体 | 页内 + **Windows 桌面小鲸鱼**（独立进程，三种样子可换） | 页面内精灵 | 桌面（简介未细述） | 页面内小部件 | 页面内对话界面 | 页面内宠物 |
| 跨会话后台任务通知（开工/完成/失败/中止/截断/提问/审核，分事件音效） | ✅ + 未读红标 | — | — | — | — | — |
| 红标交互（单击读一条 / 双击清空 / 读完即消） | ✅ | — | — | — | — | — |
| 通知 / 历史直达对话 · 桌面形态可唤回 DSH 窗口 | ✅ | — | — | — | — | — |
| 用量：每轮 token + 全对话累计 + 上下文压力（20%~100% 提醒阈值） | ✅ | — | — | ✅（用量小部件） | — | — |
| 历史：搜索 / 范围清空 / 单击跳转对话节点 | ✅ | — | — | — | — | — |
| 周报：近 7 天 / 昨夜摘要 / 失败筛选 / Markdown·CSV 导出 | ✅ | — | — | — | — | — |
| 定时提醒 | ✅ 倒计时 / 指定时刻 | ✅ 闹钟 + 番茄钟 | — | — | — | — |
| 依赖健康自检 + 桌面形态异常自愈 | ✅ | — | — | — | — | — |
| 陪伴互动 | 摸头好感 / 情绪 / 装饰成就 / 睡觉 | 皮肤 + 动画 | 状态联动 | 玩偶 + 天气 | 好感度 / 记忆 / CG | 投喂 / 玩耍 |
| 只读（不拦截、不改任务行为） | ✅ | 未知 | 未知 | 未知 | 未知 | 未知 |

**一句话差异**：同类大多是「页面里显示状态、卖萌陪伴」；本插件把**任务通知**（谁开工了 / 完成 / 失败 / 需要你回答）、**点一下就回到对话**（用桌面小鲸鱼时还会把 DSH 窗口叫回来）、**用量与周报**串成一套完整流程——而且全程只读，不干扰任务。

---

## 安装（网页版 / 桌面版通用第一步）

插件以 DSH cordis 插件形式安装到 DSH 服务，共四条分发渠道（任选其一，**不要并存**——同一 profile 两套 = 双鲸鱼）：

| 渠道 | 入口 | 说明 |
|---|---|---|
| **GitHub 仓库 + 脚本**（路径 A/B） | 本仓库 `install.ps1` / `ensure-whale-assistant.ps1` | 改源码即生效（`link:` 安装）；Windows 一键、macOS/Linux 手动 |
| **npm 包** | `@lengmu-cloud/dsh-whale-assistant`（`dsh plugin --profile web add @lengmu-cloud/dsh-whale-assistant`） | 0.4.3 起已发布；适合脚本化/CI 场景 |
| **官方自定义插件索引**（路径 C，实验性） | 添加本仓库 `market/market-index.json` 索引 URL | 全程官方 UI 点按；版本由索引锁定（0.4.3 起支持） |
| **社区清单/第三方市场** | awesome-dsh-plugin 等收录清单 | 收录后可在第三方市场/管理器中搜索安装（见文末「生态与收录」） |

DSH 的 profile 目录默认在 `~/.dsh/profiles/web`（DSH 首次运行后生成），注册共三件套：
**package.json 依赖 + node_modules 实体 + `dsh.profile.bundles` 清单**，缺一不可。
（0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-rc.3 多版本实测支持 bundle 声明；插件自带 `cordis.patch.yml`
作为 bundle 层被启动器应用，并出现在**官方插件管理页**「已安装」里，带启停开关。）

**第 0 步 · 获取仓库**（路径 A / B / 备选命令都需要；路径 C 市场安装不需要）：

```powershell
git clone https://github.com/LengMu-Cloud/dsh-whale-assistant.git
```

克隆到任意固定目录（下文称 `<repo>`）。没装 git 的话：GitHub 页面 Code →
Download ZIP 解压同样可用，或直接走路径 C（全程官方 UI 内点按，零命令行）。

> **用官方桌面端的话**：桌面端独占 `~/.dsh/profiles/desktop`（与 web profile 不共享插件）。
> 两套 profile 可并存注册，互不影响。一键安装用 `-TargetProfile desktop`（默认就是它），
> 手动安装则把下文命令里的 `profiles\web` 全部换成 `profiles\desktop`
> （`ensure-whale-assistant.ps1` 对应加 `-ProfileDir ~\.dsh\profiles\desktop`）再跑一遍。

### 路径 A · 一键安装（推荐，Windows）

先跑一次 DSH（打开一次官方桌面，或跑一次 `dsh --profile web`）让 profile 目录生成，然后：

```powershell
powershell -ExecutionPolicy Bypass -File "<repo>\install.ps1" -Repo "<repo>"
```

`-Repo` 指向第 0 步克隆出的本地副本（推荐——直接复用，不重复联网克隆）；**省略
`-Repo`** 时脚本会自行从 GitHub 拉取到 `~\dsh-whale-assistant`（已有副本则复用并
尝试快进更新；第 0 步的克隆将被忽略）。脚本随后自动：注册进 desktop profile →
挂 node_modules junction → 体检三件套并提示下一步。变体：

- 浏览器用户加 `-TargetProfile web`；两套 profile 都装加 `-TargetProfile both`
- 幂等可重复执行；配套 `ensure-whale-assistant.ps1 -Check`（只读体检三件套，缺件时
  退出码 1）与 `-Remove`（对称卸载：依赖行 + bundles 行 + junction，改坏 JSON 会
  自动放弃写入并留 .bak）

### 路径 B · 手动步骤（macOS / Linux，或想看清每一步）

1. 把本仓库放到任意固定目录（下称 `<repo>`；路径含空格也可以，但后续命令里给含
   空格的路径加英文引号）。
2. **注册插件到 profile**（Windows 推荐用自带脚本，幂等可重复执行）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File <repo>\ensure-whale-assistant.ps1
   ```

   脚本自动完成其中两件：profile `package.json` 写入 `link:` 依赖、
   `dsh.profile.bundles` 追加鲸鱼（并自动清退旧版手工 insert 注册行，防双注册）。
   剩下一件是把插件实体挂进 profile 的 node_modules（Windows junction）：

   ```powershell
   New-Item -ItemType Directory -Force ~\.dsh\profiles\web\node_modules\@lengmu-cloud | Out-Null
   New-Item -ItemType Junction -Force -Path ~\.dsh\profiles\web\node_modules\@lengmu-cloud\dsh-whale-assistant -Target <repo>\whale-assistant
   ```

   **macOS / Linux**（手动等价操作）：

   ```bash
   # profile package.json 的 dependencies 里加一行：
   #   "@lengmu-cloud/dsh-whale-assistant": "link:<repo>/whale-assistant"
   # dsh.profile.bundles 数组里加一行：
   #   "@lengmu-cloud/dsh-whale-assistant"
   mkdir -p ~/.dsh/profiles/web/node_modules/@lengmu-cloud
   ln -s <repo>/whale-assistant ~/.dsh/profiles/web/node_modules/@lengmu-cloud/dsh-whale-assistant
   ```

   **bundle 注册行**（包内 `cordis.patch.yml` 已自带，无需手写；此处仅为格式说明——
   插件的 `dsh.bundle.patch` 指向它，启动器作为 bundle 层自动应用）：

   ```yaml
   - insert:
     - id: ui-whale-assistant       # 唯一注册点；同一 profile 只允许这一层声明它
       name: '@lengmu-cloud/dsh-whale-assistant'
   ```

### 备选 · 官方一条命令（实验性，需 npm 全局 CLI）

装了 npm 全局引擎的用户（`dsh` 命令可用）也可以用引擎自带的插件管理命令，对已有
profile 等价于路径 B 的全部三件（依赖 + bundles + 实体一次完成，且带官方版本兼容
守卫）：

```powershell
dsh plugin --profile web add <repo>\whale-assistant
```

⚠️ 它对**从未运行过 DSH 的全新 profile** 只会初始化出缺 `dsh-web-app` 的最小骨架
（webServer 起不来、插件一直 pending）——所以无论走哪条路径，**都先跑一次 DSH**。

### 路径 C · 官方自定义插件索引（实验性，DSH 0.2.1+）

0.2.1 起 DSH 提供实验性「自定义插件索引」（默认关闭）。启用后安装/重装鲸鱼全程在官方 UI 里点，
不碰命令行——**与路径 A/B 二选一**（同一 profile 两套并存 = 双鲸鱼）：

1. DSH 插件页 →「实验性插件」旁 **更多** → 启用 **自定义插件索引**；
2. 切到 **发现** 标签 → 添加索引 URL（推荐 jsDelivr 镜像，可达性好）：

   ```text
   https://cdn.jsdelivr.net/gh/LengMu-Cloud/dsh-whale-assistant@main/market/market-index.json
   ```

3. 找到 **打工小鲸鱼** → 选版本 → 安装 → 重启 DSH，右下角见鲸鱼、管理页出现开关。

注意：experimental 功能——发现页**只提示有更新、不自动升级**（重装即升级）；索引格式
可能随官方版本演进，出问题回退路径 A/B 即可。索引由 `market/market-index.json` 承载
（git 源锁定 commit），发版后 `node scripts/build-market-index.js` 自动追加并按官方
格式 1 规则自检；镜像与字段说明见 `market/README.md`。

**两条路径跑完后的收尾（对路径 A、路径 B 与备选命令通用）**：

1. 构建产物已随仓库提供（`whale.js`）；自行改源码后重建：

   ```text
   node build-whale.js        # 产出 whale.js + whale-map.md（函数导航）
   ```

2. **重启 DSH 服务**让插件挂载：官方桌面用户**重启桌面应用**即可；网页版用户
   结束 DSH 的后台服务进程（node，监听 3080 端口；Windows 用任务管理器，
   macOS/Linux 用 `pkill -f dsh`）后重新运行 `dsh --profile web`（或直接重启电脑）。
   首次安装时若 DSH 服务尚未运行过，先跑一次
   `dsh --profile web`（网页版）或打开官方桌面（桌面版）。浏览器 F5 即可看到鲸鱼。
3. **验证安装**：右下角出现鲸鱼、控制台（F12）有
   `[dsh-whale-assistant] whale loaded from plugin routes` 即成功；一切正常时
   健康自检零痕迹（鲸鱼旁无 ⚠️）。有问题先看下方「常见问题」。

> ⚠️ **包名必须带 scope**（alpha client 的模块清单只聚合带 scope 的包，scope 用谁家的都行）。
> ⚠️ 插件经 `dsh.bundle.patch` 声明注册（由 `dsh.profile.bundles` 引用）——**不要**再往
> profile 的 `cordis.patch.yml` 手工加同 id insert 行：双注册 = 双鲸鱼 = 双份通知
> （`ensure-whale-assistant.ps1` 会自动清退旧版手工行）。

## 自建桌面壳（遗留）

> 官方桌面端已覆盖全部需求（安装即用），本章可整节跳过。仓库旧号 shell/ 与
> scripts/fix-shell.ps1 已退役、不再维护，仅作参考（见 docs/shell-setup.md）。

---

## 升级与卸载

**升级**：

```text
git pull               # 拉最新代码
node build-whale.js    # 仅当改了 src/ 源码才需要（构建产物 whale.js 已随仓库提供）
```

按改动面生效：

- 只动页面半区（`src/`、`whale.js`）：右键菜单 **🔄 刷新页面**（官方桌面端）或浏览器
  **F5** 即生效
- 动了宿主半区（`whale-assistant/lib/index.js`）：**重启 DSH 服务**——官方桌面用户
  重启桌面应用；网页版用户结束 node 服务进程（监听 3080 端口）后重新运行
  `dsh --profile web`，或重启电脑

> **0.4.3 升级注意**：本版**宿主半区与页面半区都有改动**（`lib/index.js|store.js|pet.js`
> + `src/`）——升级后请**重启 DSH**（官方桌面端重启应用）；只刷新页面仅更新页面半区，
> 改名跟随、周报新卡等宿主侧能力要重启后才齐。
>
> **桌面形态更新注意**：右键菜单「🔄 重启小鲸鱼」会重新加载桌宠页（`page.html`/`style.css`/
> `whale.js`）；首次使用需完整重启一次 DSH 注册该菜单项。之后桌宠更新直接点它即可，
> 不需要再重启 DSH。

**换机迁移**（数据不跨机器同步，搬家前手动备份两处）：

- 历史：`~/.dsh/whale-assistant.json`（服务端镜像文件，拷到新机同路径即可）
- 设置/通讯录/提醒/好感度：浏览器 localStorage 里 `dsh-whale:` 开头的全部键
  （DevTools → Application → Local Storage 逐条导出再导入；`dsh-whale:evseq`/
  `clearAt` 拷过去也无害——bootId 不匹配会自动全量重同步）

**卸载**（删干净三处即完全移除；历史数据 `~/.dsh/whale-assistant.json` 与浏览器
localStorage 可留可删）：

1. profile `package.json` 里的 `@lengmu-cloud/dsh-whale-assistant` 依赖行 +
   `dsh.profile.bundles` 数组里的同名条目（或在官方插件管理页「已安装」里直接移除）
2. profile node_modules 里的 junction / 软链
3. 若 profile `cordis.patch.yml` 里有旧版手工 `ui-whale-assistant` 注册行，一并删掉

## 工作原理（为什么说它是"只读"的）

插件分两半：

- **宿主半区** `whale-assistant/lib/index.js`：以 cordis 插件挂在 DSH 服务上，新增 17 条
  仅本机回环的 HTTP 路由（状态 / 历史存取 / 事件轮询 / SSE 实时推送 / 静态资源 /
  调试取证 / 标题回填，以及桌宠页的 page、whale.js、style.css、feed、history、config、
  state、ctrl 八条；外加开发诊断用的 `dev-say`——默认不注册，需以 `DSH_WHALE_DEV=1` 启动
  DSH），从 DSH 自身事件总线与投影订阅任务事件、
  镜像任务历史——**不拦截、不修改任何任务行为**。
- **页面半区** `src/`（35 模块构建为 `whale.js`）：在 Web 页面里消费事件流（SSE 实时 +
  轮询兜底）并渲染鲸鱼 UI，DOM 只读采集用量数据；会话跳转经 DSH 官方 sessions 服务
  完成（0.4.0 起，见「组件关系」）。

全部数据落在你本机（`~/.dsh/whale-assistant.json` + 浏览器 localStorage），插件自身
不发起任何外部网络请求。

## 开发与测试

```text
node build-whale.js      # 重建 whale.js + whale-map.md，并同步发布副本到 whale-assistant/lib/
                         # 构建时强制：顶层声明重复断言 / menu 热点 guard / KNOWN-COUPLING 登记表
node test-whale.js       # vm 沙箱单元测试，1282 断言
node test-chip-gate.js   # 芯片闸门纯函数测试，19 断言
node test-host-store.js  # 宿主半区账本测试（临时目录驱动），235 检查
node scripts/audit-deps.js        # 静态架构审计（作用域/依赖边/缝清单/时序契约 lint，自检前置）
node check-dsh-compat.js --static "<DSH安装目录>"   # DSH 升级前：对新版包扫耦合点特征
node check-dsh-compat.js --live [--cdp]             # DSH 升级后：对运行实例探活（接口/调试口）
node scripts/run-e2e.js  # CDP 端到端四场景（调试口 9222 不可达时自动跳过；官方桌面需带 --remote-debugging-port=9222 启动）
```

调试与测试用的导出缝清单见 [docs/seams.md](docs/seams.md)。
分层、准入规则与债务登记见 [docs/architecture.md](docs/architecture.md)。

## 目录导航

| 路径 | 内容 |
|---|---|
| `src/` + `build-whale.js` | 插件源码（35 模块）与构建脚本 |
| `whale-map.md` | **构建时自动生成**的模块/函数导航（Agent 与人类共用） |
| `docs/architecture.md` | 架构与分层：作用域三层、三档准入规则、债务登记与触发线 |
| `whale-assistant/` | 插件包（宿主半区 lib/index.js + 页面半区 client.js + 注册样本） |
| `install.ps1` | 一键安装：克隆（或定位本地仓库）+ 注册 + junction + 体检，支持 `-TargetProfile web\|both`、`-Repo <本地路径>` |
| `ensure-whale-assistant.ps1` | 插件注册脚本（写 profile 依赖 + 注册行，幂等）；`-Check` 只读体检 / `-Remove` 对称卸载 |
| `parts/style.css` | 鲸鱼全部样式 |
| `test-whale.js` / `test-chip-gate.js` / `test-host-store.js` | 单元测试（vm 沙箱 1282 断言 / 闸门纯函数 19 断言 / 宿主半区 235 检查） |
| `FEATURES.md` / `CHANGELOG.md` / `docs/seams.md` | 用户功能手册 / 版本变更记录 / 调试与测试导出缝清单 |
| `README.en.md` | 英文入口（English summary / comparison / install） |
| `shell/` + `scripts/fix-shell.ps1` | 旧桌面瘦壳源码与安装脚本（**已退役**，官方桌面端覆盖其全部增量；保留供参考） |
| `docs/shell-setup.md` | 桌面壳手动安装指南（遗留参考） |

## 常见问题

- **装完右下角什么都没有（鲸鱼不出现）** —— 按顺序查：① DSH 服务在跑吗（重启 DSH，
  右下角仍无鲸鱼 = 插件没挂上）② F12 控制台有没有
  `[dsh-whale-assistant] whale loaded from plugin routes`——有 = 已加载，
  `[dsh-whale-assistant] whale load failed` = 页面拿不到插件路由：多半是注册三件套缺件，
  跑 `ensure-whale-assistant.ps1 -Check` 体检（缺件会明确指出是哪一件）③ 修完注册后
  **重启 DSH**，浏览器 Ctrl+F5 / 桌面端右键菜单 🔄 刷新页面。
- **出现两只鲸鱼 / 通知双份** —— 插件被注册了两次：现行注册 = 包 manifest
  `dsh.bundle.patch` + profile `dsh.profile.bundles` 引用（一处即够）；若 profile
  `cordis.patch.yml` 里还有旧版手工 `insert: ui-whale-assistant` 行，删掉它
  （`ensure-whale-assistant.ps1` 重跑会自动清退）。
- **点历史条目 / 双击通知没有跳转** —— 0.4.0 起跳转已内置（经 DSH 官方 sessions 服务），
  升级到 0.4.0 即可（0.3.x 依赖一个未随仓库分发的补丁，对 GitHub 用户不可用）；
  0.4.1 起官方桌面端走 `uiWorkspace.openSession` 桥。仍无效就刷新页面后重试
  （桌面端右键菜单 🔄 刷新页面 / 浏览器 Ctrl+F5）。
- **后台任务的完成通知不来 / 迟到** —— 0.4.0 起网页版走 SSE 实时推送，正常不再迟到；
  若通知彻底消失，多半是标签页被浏览器「内存节省」功能丢弃了（重开标签页即可）。
- **鲸鱼旁出现 ⚠️** —— 健康自检发现依赖失效，点开看逐项明细，多数一次 Ctrl+F5 恢复
  （见下"健康自检"）。
- **没有声音** —— 右键菜单「🔊 声音」是一键开关；音色、免打扰时段在 DSH 侧边栏的设置页里；逐项排查见
  FEATURES.md 音效系统一节。
- **清空历史后对话名会丢吗** —— 不会：真名存在独立的"通讯录"（localStorage
  `dsh-whale:titles`，与历史分离），清空历史不影响鲸鱼认名。
- **历史突然变空了** —— 0.4.2 起账本损坏会自动隔离重建：`~/.dsh/` 下会出现
  `whale-assistant.json.corrupt-时间戳` 备份文件。想救回旧记录：关闭 DSH → 把该文件
  名末尾的 `.corrupt-时间戳` 后缀删掉、恢复原名 → 再启动。
- **小鲸鱼怎么从界面里出来到桌面上 / 怎么回去** —— 0.4.2 起（仅 Windows 官方桌面端）
  打开 DSH 后小鲸鱼自动出现在桌面并常驻（退出 DSH 时一起消失）：右键点桌面小鲸鱼 →「🎭 切换形态」菜单「🐋 完整形态 / 🪟 缩成小窗 /
  🙈 隐藏小鲸鱼」（隐藏后变成角落一枚小气泡，点一下破裂就回来）；桌面形态在岗时 DSH 界面里的
  页内鲸鱼自动休眠让位，桌面形态不可用时页鲸自动回归，无需手动切换；退出 DSH 约 1 秒内跟随消失。
- **桌面小鲸鱼更新没生效 / 怎么让桌宠吃到新版本** —— 右键菜单 **🔄 重启小鲸鱼**：
  字面重启桌宠进程，桌宠页（`page.html`/`style.css`/`whale.js`）重新从磁盘加载——
  「🔄 刷新页面」只刷 DSH 页面/页鲸，碰不到桌宠页。首次使用需完整重启一次 DSH
  注册该菜单项；之后桌宠页更新用它即可。

## 健康自检

鲸鱼每 60 秒自检一次依赖（服务端事件轮询与 SSE 推送 / 用量 DOM 读取 / 会话跳转桥）。
一切正常时**零痕迹**；检测到失效会在鲸鱼旁出现 ⚠️ 小图标，点开看逐项明细；
控制台同步输出 `[🐋] Health check: {...}`。多数失效一次刷新即可恢复
（桌面端右键菜单 🔄 刷新页面 / 浏览器 Ctrl+F5）。

## 生态与收录（怎么找到这个插件）

- **GitHub 生态话题**：仓库在 About → Topics 标注 `dsh-plugin` 等话题；第三方市场/目录
  （dshbase、DSH Agent Market 一类聚合器）按 topic 抓取，可自动发现本插件。
- **社区精选清单**：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  等 DSH 插件精选清单（收录后在对应清单页可见；部分第三方市场只允许安装清单内的源）。
- **自建索引**：`market/market-index.json` 可被任意 DSH「发现」页添加（jsDelivr / GitHub raw
  两个镜像），第三方市场也可复用该索引作为来源。
- **npm**：包名 `@lengmu-cloud/dsh-whale-assistant`。

## 作者与许可

- 作者：**LengMu-Cloud**（[github.com/LengMu-Cloud](https://github.com/LengMu-Cloud)）
- 许可：[MIT](LICENSE)
- 鲸鱼形象主体为 DeepSeek 官方鲸鱼标志的原始矢量路径（权利归 DeepSeek 及其权利人所有，本仓库不主张任何权利，仅作非官方插件图标之用）；安全帽/咖啡杯装饰为本仓库自绘

## 免责声明

本项目是 DeepSeek Harness（DSH）的**第三方非官方插件**，与 DeepSeek 官方无关。
插件仅通过 DSH 公开插件接口与公开 HTTP 路由工作，**不含、不分发 DSH 的任何代码**。
MIT 许可证只覆盖本仓库的原创代码（含安全帽/咖啡杯装饰）；**鲸鱼形象主体为 DeepSeek 官方鲸鱼标志**，非本仓库原创，其权利归 DeepSeek 及其权利人所有。DSH 是 DeepSeek 的产品，其权利归其权利人所有。

---
