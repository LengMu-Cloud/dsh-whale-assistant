# market/ — 官方自定义插件市场索引

本目录承载 DSH **自定义插件市场**（0.2.1 的 experimental `plugin-market-bundle`）用的索引文件：
`market-index.json`（格式 1）。鲸鱼包 `@lengmu-cloud/dsh-whale-assistant` 以标准 `dsh.bundle`
形态列于其中，安装源为 git+https 锁定 commit（`path:whale-assistant` 子目录）——零 npm 发布负担。

> 索引格式由官方校验器 `@deepseek-ai/dsh-plugin-market-index`（格式 1）定义；Host 侧
> `pluginMarket` 服务读取本文件并标注安装状态与兼容性，安装动作经官方
> `pluginManager.installBundle` 完成。experimental 属性：格式与入口可能随版本变化，
> `install.ps1` 永远是兜底路径。

## 索引 URL（用户添加到「发现」的地址）

| 镜像 | URL | 说明 |
|---|---|---|
| jsDelivr CDN | `https://cdn.jsdelivr.net/gh/LengMu-Cloud/dsh-whale-assistant@main/market/market-index.json` | 国内可达性好；缓存约 12h，发布后延迟可见 |
| GitHub raw | `https://raw.githubusercontent.com/LengMu-Cloud/dsh-whale-assistant/main/market/market-index.json` | 权威源；github.com 被阻断时不可达 |

## 用户启用步骤（0.2.1+）

1. DSH 插件页 → **实验性插件** 旁的 **更多** → 启用 **自定义插件市场**（`dsh-experimental-plugin-market-bundle`，默认关闭）；
2. 插件页切到 **发现** 标签 → 添加上面的索引 URL（推荐 jsDelivr）；
3. 在列表里找到 **打工小鲸鱼** → 安装 → 重启 DSH → 右下角见鲸鱼，管理页出现开关。

⚠️ 与本地 `link:` 安装（ensure 脚本 / install.ps1）**二选一**：同一 profile 两套并存 = 双鲸鱼。
`ensure-whale-assistant.ps1 -Check` 会识别市场安装并提示。

## 维护（发版流程的一步）

打完 tag 后运行 `node scripts/build-market-index.js`——脚本自动把最新 `v*` tag 的
{版本, commit, 发布时间} 追加进 `versions`（去重合并），并按格式 1 关键规则自检
（SemVer/commit 40 hex/URL 规范性/localized en 必含等），然后提交 `market/market-index.json`。

## 字段对照（速查）

| 字段 | 规则要点 |
|---|---|
| `format` | 必须 `1` |
| `title` | 本地化文本，**必含 `en`** |
| `plugins[].name` | 合法 npm 包名（≤214 字符） |
| `plugins[].icon` | `data:` 内联（svg/png/jpeg/webp，解码后 ≤32KiB）或 URL（解析后 https 或同索引 origin） |
| `plugins[].repository` | `url` 规范 https、≥2 段路径、非 tarball；`directory` 相对目录段 `[A-Za-z0-9._@+-]` |
| `versions[].version` | 精确 SemVer，唯一，自动降序 |
| `versions[].publishTimestamp` | Unix 秒整数 `[0, 1e11)` |
| `versions[].source` | `npm`（可选 `registry`）或 `git`（40-hex `commit` + 规范 `url` + 可选 `path`） |
| `versions[].engines.dsh` | SemVer range，禁 `workspace:` |

安装目标生成规则（`marketInstallTarget`）：git 源 →
`git+<url>.git#<commit>&path:/<path>`（`url` 无 `.git` 后缀时自动补）。
