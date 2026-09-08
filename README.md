# 🐋 dsh-whale-assistant — DeepSeek Harness 的小鲸鱼助手插件

住在 DeepSeek Harness（DSH）Web 界面右下角的打工小鲸鱼，功能包括：
①实时任务通知（开工/完成/失败/中止/截断/提问/审核，每种独立音效）；
②Token 用量报告（每轮任务消耗 + 全对话累计 + 上下文压力百分比）；
③跨会话后台通知（切换对话后仍能收到任务状态）；
④长任务计时（>2 分钟自动显示运行时长）；
⑤历史记录搜索、范围清空（全部/仅7天前/仅30天前），历史条目支持单击跳转到对应对话节点；|
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

## 能力矩阵（先看这个再安装）

| 能力 | 网页版（浏览器访问 dsh web） | 桌面封装版（Electron 壳） |
|---|---|---|
| 任务通知 / 用量面板 / 运行计时 / 历史 / 周报 / 提醒 | ✅ 开箱即用 | ✅ 开箱即用 |
| 多窗口/多端历史同步（同一台机器） | ✅ 服务端镜像，自动合并 | ✅ 同左 |
| 后台任务通知延迟 | ⚠️ 标签页隐藏时受浏览器限流（积压会在切回后补达，并自动折叠成摘要） | ✅ 实时（壳已关闭后台限流） |
| 冷启动黑屏防护 / 崩溃自恢复 | 不适用（浏览器自己管） | ✅ 壳补丁提供 |
| 跨机器同步 | ❌ 明确不支持（历史存在各自机器的 `~/.dsh/whale-assistant.json`） | ❌ 同左 |

> 小鲸鱼插件本体**不包含、也不依赖**任何桌面壳补丁。壳补丁是"桌面封装"这个形态
> 的可选增强，只影响上表中标 ✅ 的两项桌面体验。

---

## 安装（网页版 / 桌面版通用第一步）

插件以 DSH cordis 插件形式安装到 DSH 服务（不是 npm 公共包，当前为开发版分发）：

1. 把本仓库放到任意固定目录（下称 `<repo>`）。
2. 将 `whale-assistant/` 软链（Windows junction）到 DSH 可加载的插件目录，或在
   `~/.dsh/cordis.patch.yml` 注册：

   ```yaml
   patch:
     - insert: ui-whale-assistant     # 唯一注册点；不要重复注册（会双鲸鱼双通知）
       plugin: "@lengmu-cloud/dsh-whale-assistant"
   ```

3. 构建产物已随仓库提供（`whale.js`）；自行改源码后重建：

   ```
   node build-whale.js        # 产出 whale.js + whale-map.md（函数导航）
   ```

4. 重启 DSH 服务（或整机重启），浏览器 F5 即可看到鲸鱼。

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

## 目录导航

| 路径 | 内容 |
|---|---|
| `src/` + `build-whale.js` | 插件源码（31 模块）与构建脚本 |
| `whale-map.md` | **构建时自动生成**的模块/函数导航（Agent 与人类共用） |
| `whale-assistant/` | 插件包（宿主半区 lib/index.js + 页面半区 client.js） |
| `parts/style.css` | 鲸鱼全部样式 |
| `test-whale.js` / `test-chip-gate.js` | 单元测试（vm 沙箱 570+ 断言 / 闸门纯函数 19 断言） |
| `FEATURES.md` / `CHANGELOG.md` / `docs/seams.md` | 用户功能手册 / 版本变更记录 / 调试与测试导出缝清单 |
| `shell/` + `scripts/` | 桌面瘦壳源码与安装脚本（可选增强） |
| `docs/shell-setup.md` | 桌面壳手动安装指南 |

## 健康自检

鲸鱼每 60 秒自检一次依赖（服务端事件轮询 / 用量 DOM 读取 / 跳转钩子）。
一切正常时**零痕迹**；检测到失效会在鲸鱼旁出现 ⚠️ 小图标，点开看逐项明细；
控制台同步输出 `[🐋] Health check: {...}`。多数失效一次 Ctrl+F5 即可恢复。

## 作者与许可

- 作者：**LengMu-Cloud**（[github.com/LengMu-Cloud](https://github.com/LengMu-Cloud)）
- 许可：[MIT](LICENSE)

## 免责声明

本项目是 DeepSeek Harness（DSH）的**第三方非官方插件**，与 DeepSeek 官方无关。
插件仅通过 DSH 公开插件接口与公开 HTTP 路由工作，**不含、不分发 DSH 的任何代码**；
MIT 许可证只覆盖本仓库的原创代码。DSH 是 DeepSeek 的产品，其权利归其权利人所有。

---
