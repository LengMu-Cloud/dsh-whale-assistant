# 🐋 dsh-whale-assistant — DeepSeek Harness 的小鲸鱼助手插件

住在 DeepSeek Harness（DSH）Web 界面右下角的打工小鲸鱼，功能包括：
①实时任务通知（开工/完成/失败/中止/截断/提问/审核，每种独立音效）；
②Token 用量报告（每轮任务消耗 + 全对话累计 + 上下文压力百分比）；
③跨会话后台通知（切换对话后仍能收到任务状态）；
④长任务计时（>2 分钟自动显示运行时长）；
⑤历史记录搜索、范围清空（全部/仅7天前/仅30天前），历史条目支持单击跳转到对应对话节点；
⑥任务周报（近7天按日统计 + Markdown/CSV导出）；
⑦定时提醒（倒计时或指定时刻到点响铃）；
⑧陪伴系统（摸摸头好感度、爱心特效、班味情绪）；
⑨每日装饰成就（咖啡杯/红色安全帽）；
⑩内置完整使用说明手册（支持搜索过滤）。
**只读事件流，不拦截、不修改任何任务行为。**

> **定位一句话**：本仓库的核心交付物是 **DSH 的 Web UI 插件**（`src/` + `whale-assistant/`）；
> `shell/` 里的桌面壳是**可选的DSH桌面封装**——插件只要求 DSH web 在跑，用浏览器直开、
> 你自制的 Electron 封装、PWA 或本仓库的壳，装上都能用。

---

## 环境要求

| 组件 | 要求 |
|---|---|
| DeepSeek Harness | 实测版本 **0.1.5-rc.2**（2026-09-11，由 0.1.2-rc.1 升级）；兼容下限见 `whale-assistant/package.json` 的 `dsh.engines`；插件只走公开插件接口与 HTTP 路由。0.1.5 起「上下文已用 N%」已从 UI 移除，前台压力色可能降级 |
| Node.js | 跟随 DSH 自身要求即可（开发机 v24 实测）；仅改源码/构建/跑测试时需要 |
| 操作系统 | 插件本体为纯 JS，跨平台；自动化脚本为 PowerShell（Windows），macOS/Linux 按下文手动步骤 |
| 运行载体 | 任意现代浏览器；Electron 桌面壳为可选增强 |

## 能力矩阵（先看这个再安装）

| 能力 | 网页版（浏览器访问 dsh web） | 桌面封装版（Electron 壳） |
|---|---|---|
| 任务通知 / 用量面板 / 运行计时 / 历史（搜索·范围清空·单击跳转对话） / 周报 / 提醒 | ✅ 开箱即用 | ✅ 开箱即用 |
| 陪伴系统（摸头好感 / 爱心 / 班味情绪 / 装饰成就 / 使用手册） | ✅ | ✅ |
| 多窗口/多端历史同步（同一台机器） | ✅ 服务端镜像，自动合并 | ✅ 同左 |
| 后台任务通知延迟 | ⚠️ 标签页隐藏时受浏览器限流（积压会在切回后补达，并自动折叠成摘要） | ✅ 实时（壳已关闭后台限流） |
| 冷启动黑屏防护 / 崩溃自恢复 | 不适用（浏览器自己管） | ✅ 壳补丁提供 |
| 跨机器同步 | ❌ 明确不支持（历史存在各自机器的 `~/.dsh/whale-assistant.json`） | ❌ 同左 |

> 其余细节功能两版完全一致，完整清单见 [FEATURES.md](FEATURES.md)。
> 小鲸鱼插件本体**不包含、也不依赖**任何桌面壳补丁。壳补丁是"桌面封装"这个形态
> 的可选增强，只影响上表中标 ✅ 的两项桌面体验。

---

## 安装（网页版 / 桌面版通用第一步）

插件以 DSH cordis 插件形式安装到 DSH 服务（不是 npm 公共包，当前为开发版分发）。
DSH 的 profile 目录默认在 `~/.dsh/profiles/web`（DSH 首次运行后生成），注册共三件套：
**package.json 依赖 + node_modules 实体 + cordis.patch.yml 注册行**，缺一不可。

1. 把本仓库放到任意固定目录（下称 `<repo>`）。
2. **注册插件到 profile**（Windows 推荐用自带脚本，幂等可重复执行）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File <repo>\ensure-whale-assistant.ps1
   ```

   脚本自动完成其中两件：profile `package.json` 写入 `link:` 依赖、`cordis.patch.yml`
   追加注册行。剩下一件是把插件实体挂进 profile 的 node_modules（Windows junction）：

   ```powershell
   New-Item -ItemType Directory -Force ~\.dsh\profiles\web\node_modules\@lengmu-cloud | Out-Null
   New-Item -ItemType Junction -Force -Path ~\.dsh\profiles\web\node_modules\@lengmu-cloud\dsh-whale-assistant -Target <repo>\whale-assistant
   ```

   **macOS / Linux**（手动等价操作）：

   ```bash
   # profile package.json 的 dependencies 里加一行：
   #   "@lengmu-cloud/dsh-whale-assistant": "link:<repo>/whale-assistant"
   mkdir -p ~/.dsh/profiles/web/node_modules/@lengmu-cloud
   ln -s <repo>/whale-assistant ~/.dsh/profiles/web/node_modules/@lengmu-cloud/dsh-whale-assistant
   ```

   **注册行**（由脚本自动写入，手动编辑 `~/.dsh/cordis.patch.yml` 时照此格式——
   注意是顶层 FLAT 数组，不要包在 `patch:` 里）：

   ```yaml
   - insert:
       - id: ui-whale-assistant     # 唯一注册点；不要重复注册（会双鲸鱼双通知）
         name: '@lengmu-cloud/dsh-whale-assistant'
   ```

3. 构建产物已随仓库提供（`whale.js`）；自行改源码后重建：

   ```text
   node build-whale.js        # 产出 whale.js + whale-map.md（函数导航）
   ```

4. 重启 DSH 服务（或整机重启），浏览器 F5 即可看到鲸鱼。

> ⚠️ **包名必须带 scope**（alpha client 的模块清单只聚合带 scope 的包，scope 用谁家的都行）。
> ⚠️ 不要把插件同时注册进包内 `dsh.bundle.patch` 和 profile patch —— 双注册 =
> 双鲸鱼 = 双份通知。

## 桌面封装版第二步（可选增强）

> **如果你已有自己喜欢的封装方式**（自制 Electron 壳、Edge/Chrome PWA、
> 或干脆浏览器直开），**本节整节跳过**——上面的安装完成后插件即已完整可用。

如果你想把 DSH 封装成 Electron 桌面应用（任何壳都行），鲸鱼照常工作；但壳需要
自己处理两件事：**认证 URL 的读取**（dsh web 启动时打印一次性 token URL）与
**后台限流关闭**（`backgroundThrottling: false`）。

- 使用与我们同款瘦壳：运行 `scripts/fix-shell.ps1`（见 `docs/shell-setup.md`）。
- **macOS / Linux**：暂无自动脚本，请按 `docs/shell-setup.md` 手动操作。

---

## 升级与卸载

**升级**：

```text
git pull               # 拉最新代码
node build-whale.js    # 仅当改了 src/ 源码才需要（构建产物 whale.js 已随仓库提供）
```

按改动面生效：

- 只动页面半区（`src/`、`whale.js`）：浏览器 **F5** 即生效
- 动了宿主半区（`whale-assistant/lib/index.js`）：**重启 DSH 服务**（关壳重开，或重启 dsh web 进程）

**卸载**（删干净三处即完全移除；历史数据 `~/.dsh/whale-assistant.json` 与浏览器
localStorage 可留可删）：

1. profile `cordis.patch.yml` 里的 `ui-whale-assistant` 注册行
2. profile `package.json` 里的 `@lengmu-cloud/dsh-whale-assistant` 依赖行
3. profile node_modules 里的 junction / 软链

## 工作原理（为什么说它是"只读"的）

插件分两半：

- **宿主半区** `whale-assistant/lib/index.js`：以 cordis 插件挂在 DSH 服务上，新增 7 条
  仅本机回环的 HTTP 路由（状态 / 历史存取 / 事件轮询 / 静态资源，外加 1 条开发诊断用的
  `dev-say`），从 DSH 自身事件总线订阅任务事件、镜像任务历史——**不拦截、不修改任何任务行为**。
- **页面半区** `src/`（31 模块构建为 `whale.js`）：在 Web 页面里消费事件流并渲染鲸鱼 UI，
  DOM 只读采集用量数据。

全部数据落在你本机（`~/.dsh/whale-assistant.json` + 浏览器 localStorage），插件自身
不发起任何外部网络请求。

## 开发与测试

```text
node build-whale.js      # 重建 whale.js + whale-map.md，并同步发布副本到 whale-assistant/lib/
                         # 构建时强制：顶层声明重复断言 / menu 热点 guard / KNOWN-COUPLING 登记表
node test-whale.js       # vm 沙箱单元测试，640+ 断言
node test-chip-gate.js   # 芯片闸门纯函数测试，19 断言
node scripts/audit-deps.js        # 静态架构审计（作用域/依赖边/缝清单/时序契约 lint，自检前置）
node check-dsh-compat.js --static "<DSH安装目录>"   # DSH 升级前：对新版包扫耦合点特征
node check-dsh-compat.js --live [--cdp]             # DSH 升级后：对运行实例探活（接口/调试口）
node scripts/run-e2e.js  # CDP 端到端四场景（桌面壳调试口 9222 不可达时自动跳过）
```

调试与测试用的导出缝清单见 [docs/seams.md](docs/seams.md)。
分层、准入规则与债务登记见 [docs/architecture.md](docs/architecture.md)。

## 目录导航

| 路径 | 内容 |
|---|---|
| `src/` + `build-whale.js` | 插件源码（32 模块）与构建脚本 |
| `whale-map.md` | **构建时自动生成**的模块/函数导航（Agent 与人类共用） |
| `docs/architecture.md` | 架构与分层：作用域三层、三档准入规则、债务登记与触发线 |
| `whale-assistant/` | 插件包（宿主半区 lib/index.js + 页面半区 client.js + 注册样本） |
| `ensure-whale-assistant.ps1` | 插件注册脚本（写 profile 依赖 + 注册行，幂等） |
| `parts/style.css` | 鲸鱼全部样式 |
| `test-whale.js` / `test-chip-gate.js` | 单元测试（vm 沙箱 640+ 断言 / 闸门纯函数 19 断言） |
| `FEATURES.md` / `CHANGELOG.md` / `docs/seams.md` | 用户功能手册 / 版本变更记录 / 调试与测试导出缝清单 |
| `shell/` + `scripts/fix-shell.ps1` | 桌面瘦壳源码与安装脚本（可选增强） |
| `docs/shell-setup.md` | 桌面壳手动安装指南 |

## 常见问题

- **出现两只鲸鱼 / 通知双份** —— 插件被注册了两次：确认 profile `cordis.patch.yml`
  只有一行 `ui-whale-assistant` 注册，且没有同时启用包内 bundle patch。
- **后台任务的完成通知不来 / 迟到** —— 浏览器版标签页隐藏时受浏览器限流（积压会在
  切回后补达并折叠成摘要）；要实时通知就用桌面壳。
- **鲸鱼旁出现 ⚠️** —— 健康自检发现依赖失效，点开看逐项明细，多数一次 Ctrl+F5 恢复
  （见下"健康自检"）。
- **没有声音** —— 检查免打扰时段、音量与音色设置（右键菜单 → 声音）；逐项排查见
  FEATURES.md 音效系统一节。
- **清空历史后对话名会丢吗** —— 不会：真名存在独立的"通讯录"（localStorage
  `dsh-whale:titles`，与历史分离），清空历史不影响鲸鱼认名。

## 健康自检

鲸鱼每 60 秒自检一次依赖（服务端事件轮询 / 用量 DOM 读取 / 跳转钩子）。
一切正常时**零痕迹**；检测到失效会在鲸鱼旁出现 ⚠️ 小图标，点开看逐项明细；
控制台同步输出 `[🐋] Health check: {...}`。多数失效一次 Ctrl+F5 即可恢复。

## 作者与许可

- 作者：**LengMu-Cloud**（[github.com/LengMu-Cloud](https://github.com/LengMu-Cloud)）
- 许可：[MIT](LICENSE)

## 免责声明

本项目是 DeepSeek Harness（DSH）的**第三方非官方插件**，与 DeepSeek 官方无关。
插件仅通过 DSH 公开插件接口与公开 HTTP 路由工作，**不含、不分发 DSH 的任何代码**。
MIT 许可证只覆盖本仓库的原创代码。DSH 是 DeepSeek 的产品，其权利归其权利人所有。

---
