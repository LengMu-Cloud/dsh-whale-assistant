# 桌面壳安装指南（可选增强）

> 适用对象：把 DeepSeek Harness（DSH）用 Electron 封装成桌面应用的用户。
> 小鲸鱼插件本体不依赖本指南——这只是让桌面形态多两样东西：
> **冷启动不再黑屏** + **窗口隐藏时通知不再被浏览器限流**。
> Windows 有自动脚本（`scripts/fix-shell.ps1`）；macOS / Linux 按本文手动操作。
> **浏览器直开 / 已有自己的封装（自制壳、PWA）？整篇跳过即可**——小鲸鱼插件
> 按 README「安装」一节装好后照常工作，与本指南无关。

## 这个壳做了什么（与认证的关系）

1. **认证加载（不是绕过认证）**：dsh 0.1.2 起 web 界面启用一次性 token 认证，
   服务启动时向 stdout/日志打印形如
   `http://127.0.0.1:3080/?token=<一次性token>` 的 URL，浏览器访问后换取 30 天
   cookie。壳做的是**从服务日志读取最新 token URL、验证真实可用后再加载**——
   认证流程原样发生，壳只是自动化了"取号 → 验号 → 打开"。
2. **就绪验证**：端口通了 ≠ 应用就绪（cordis 插件挂载晚于端口）。壳在加载 UI
   前真实请求一次页面 + 插件金丝雀路由（`/api/whale-assistant/state`），避免黑屏。
3. **后台不限流**：`webPreferences.backgroundThrottling: false`——否则窗口隐藏时
   Chromium 把定时器压到 ~1 次/分钟，后台任务通知分钟级延迟。
4. **稳定性杂项**：禁 GPU 加速 / no-sandbox、崩溃自动重载（连续崩溃重启应用）、
   服务守护（dsh web 挂了自动拉起）、单实例、F5 刷新、CDP 调试口 9222。

## 手动安装步骤（macOS / Linux / 任何壳）

前置：`npm install -g @deepseek-ai/dsh` 已完成；本仓库已取到本地（`<repo>`）。

1. **定位壳资源**：找到你的 Electron 封装的 `resources/app.asar`
   （macOS 一般在 `<你的壳>.app/Contents/Resources/app.asar`）。
2. **备份原始包**（只备份一次，保留真正的原始版）：
   ```bash
   cp app.asar app.asar.orig
   ```
3. **解包**：
   ```bash
   npx @electron/asar extract app.asar /tmp/shell-unpacked
   ```
4. **合并壳源码**：`<repo>/shell/main.js` 是我们维护的完整壳入口（文件头有
   `// whale-patch: shell v1` 标记）。两种用法二选一：
   - **你的壳就是本仓库的瘦壳**：直接用 `shell/main.js` 覆盖
     `/tmp/shell-unpacked/main.js`（还需 `shell/loading.html` 等伴生文件，见仓库）。
   - **你已有自己的壳**：把下面三段合并进你的 main.js：
     a. `app.commandLine.appendSwitch('no-sandbox')` + `app.disableHardwareAcceleration()`
     b. `webPreferences: { backgroundThrottling: false }`
     c. 认证加载逻辑（参考 `shell/main.js` 的 `readTokenUrlFromLog` /
        `httpOk` / `loadUiWithAuth` 三个函数：读日志最新 token URL → 验证
        HTTP 200/303 → `loadURL`）
5. **重打包**：
   ```bash
   npx @electron/asar pack /tmp/shell-unpacked app.asar
   ```
6. **重启壳**，观察：窗口先显示加载页，数秒内进入 DSH 界面即成功。
   排障日志在壳的 userData 目录（`DeepSeek Harness.log` / `dsh-server.log`）。

## Windows 自动脚本

```
powershell -ExecutionPolicy Bypass -File scripts/fix-shell.ps1
```

- 自动定位已安装的壳（可用 `-ShellRoot` 显式指定）；
- 幂等：已打过补丁（main.js 含 `// whale-patch: shell` 标记且版本一致）时输出
  `already patched, skipped` 直接退出；
- 首次执行会把原始 app.asar 备份为 `app.asar.bak`（永不覆盖已有备份）。

## 常见问题

| 症状 | 处置 |
|---|---|
| 窗口黑屏 | 看壳日志；多为插件未挂载完成或 token 轮换，重启壳即可 |
| 通知延迟数分钟 | 壳未打 backgroundThrottling 补丁，或用的是浏览器标签页（见 README 能力矩阵） |
| 双份通知/双鲸鱼 | 插件被注册了两次（profile patch + 包内 patch），删掉一处 |
