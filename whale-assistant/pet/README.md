# pet/ — 桌宠（屏幕级常驻小鲸鱼）第一批

架构 v6 的插件落地（POC：`交接报告-桌宠POC-2026-10-31.md`，用户 10-31 验收 ✅）。

```
DSH 引擎进程 → lib/pet.js: spawn powershell -File pet/pet.ps1（env 传参，token 不进 argv）
  └─ WPF 全工作区无边框窗口（置顶/跳任务栏/互斥体防双开）
       └─ WebView2（独立 userData）→ GET /api/whale-assistant/pet/page（本宿主 HTTP 下发）
            └─ pet 页 = 预置 #dsh-whale（官方 svg）+ style.css + whale.js + 桌宠实色修正层 + 引导层
```

## 文件

| 文件 | 作用 |
|---|---|
| `pet.ps1` | 宿主窗口进程（静态模板，全部配置走环境变量；**token 只经 env**，永不进 argv/URL/日志） |
| `page.html` | pet 页模板（`__WHALE_SVG__` 占位符由 lib/pet.js 在下发时以 whale-logo.svg 填充） |
| `dlls/` | WebView2 固定版托管 DLL 三件（加载器 + Core + Wpf）+ MIT 许可证 |
| `dlls-manifest.json` | SHA-256 钉死清单（`scripts/check-pet.js` 门禁 + CI 盯） |

## 安全边界（四层审查定案）

- token：`randomBytes(32)`，内存持有，重启即失效；env → pet.ps1 → `WebResourceRequested` 头注入（`X-DSH-Pet-Token`）；`timingSafeEqual` 校验；403 → 页面自杀上报，进程退出。
- `/pet/page|whale.js|style.css|feed|state` = 浏览器栅栏 **AND** token（仅桌宠数据通道叠加，绝不全局豁免）；`/pet/ctrl` = 仅栅栏（配置级开关，与 /save 同信任级别）。
- **feed 载荷枚举化**：session/projection 全丢、assistant/message 全丢、tool/call 仅保留 `ask_user_question`、turn/end 仅保留 `reason.kind`；会话名以 `pet-s<N>` 合成「任务 N」。pet profile 磁盘零对话原文/零用量数字。
- title 通道只写矩形坐标（区域 payload），与 POC 相同。

## 环境变量（lib/pet.js → pet.ps1）

`DSH_PET_TOKEN`（机密）、`DSH_PET_PORT`、`DSH_PET_FORM`（full/bubble/hidden）、`DSH_PET_PARENT_PID`（父死亡看护）、`DSH_PET_DLLDIR`、`DSH_PET_USERDATA`、`DSH_PET_LOG`、`WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00FFFFFF`。
