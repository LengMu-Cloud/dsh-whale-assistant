# 🐋 dsh-whale-assistant — a whale companion for DeepSeek Harness

![CI](https://github.com/LengMu-Cloud/dsh-whale-assistant/actions/workflows/ci.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@lengmu-cloud/dsh-whale-assistant?label=npm)](https://www.npmjs.com/package/@lengmu-cloud/dsh-whale-assistant)

A third-party plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
A small whale companion lives in the bottom-right corner of DSH. In the web UI it turns task events into
tidy little panels next to the whale; on the Windows desktop app it can swim out of the app and float right
on your wallpaper (it appears with DSH and leaves with it). It turns
DSH's **read-only event stream** into notifications, usage reports, history, weekly stats and reminders — click a notification or a history row to jump back to that conversation; with the desktop pet, it also brings the DSH window to the front for you.

> **Read-only**: it never intercepts or modifies agent behavior. All data stays on your machine
> (`~/.dsh/whale-assistant.json` + `localStorage`), and the plugin makes no external network requests.

中文说明见 [README.md](README.md)。

## What it does

- **Cross-session task notifications** — task started / done / needs your review or answer / failed /
  aborted / truncated. Only what needs your attention; sounds can be customized per category or muted.
  Works even after you switch to another conversation.
- **Unread badge** — click to read one, double-click to clear all; it disappears as soon as you read the
  last one.
- **Jump back to the conversation (core)** — double-click a notification bubble or click a history row to
  jump straight to that conversation; on the desktop pet this also **brings the DSH window to the front**,
  so when DSH is minimized or covered, one click takes you back to the right conversation.
- **Usage reports** — per-turn tokens, conversation total, and context-pressure percentage, with a
  configurable pressure warning threshold (20–100%).
- **Task history** — search, clear by range (all / older than 7 days / older than 30 days), and click an
  entry to jump straight back to that conversation.
- **Weekly report** — 7-day stats, a last-night summary card, failures-only view, Markdown / CSV export.
- **Reminders** — countdown or wall-clock time.
- **Companion & desktop pet** — petting & friendship, moods, daily props, sleeping. On the Windows desktop
  the whale floats right on your wallpaper in one of **three looks** you can switch anytime: the **full whale**,
  a **mini glass card** with a line-art whale, or a **hide-and-seek bubble** in the screen corner (click it and
  the whale pops back). A `🖥️ DSH window` menu refreshes the page or brings DSH back to the front, and
  `🔄 Restart pet` reloads the desktop pet.
- **Health self-check** — checks its own dependencies every 60 seconds; anomalies show a ⚠️ chip with
  per-item details, and the desktop pet self-heals / falls back to the in-page whale.
- **Built-in manual** — a searchable usage manual, in the DSH sidebar page ("小鲸鱼助手" → "📖 使用说明" tab).

## Comparison with similar plugins

> Based on the public one-line descriptions in the
> [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) list (2026-11-27).
> `—` means "not mentioned in its public description" (not necessarily unsupported). Differences only;
> no quality judgement.

| Capability | dsh-whale-assistant | dsh-pet (zealot00) | dsh-pet (FlytoMAYDAY80) | dsh-token-pet | dsh-whale-galgame | whale-girl |
|---|---|---|---|---|---|---|
| Form factor | In-page **+ Windows desktop pet** (separate process, 3 forms) | In-page sprite | Desktop (details unspecified) | In-page widget | In-page UI | In-page pet |
| Cross-session task notifications (6 event kinds, customizable sounds) | ✅ + unread badge | — | — | — | — | — |
| Badge interaction (click = read one / double-click = clear all / clears when read) | ✅ | — | — | — | — | — |
| Jump back to the conversation (desktop pet brings the DSH window to front) | ✅ | — | — | — | — | — |
| Usage: per-turn tokens + conversation total + context pressure (20–100% threshold) | ✅ | — | — | ✅ (usage widget) | — | — |
| History: search / range clear / click-to-jump to conversation | ✅ | — | — | — | — | — |
| Weekly report: 7-day / last-night summary / failures-only / Markdown·CSV export | ✅ | — | — | — | — | — |
| Reminders | ✅ countdown / wall clock | ✅ alarm + pomodoro | — | — | — | — |
| Dependency health self-check + desktop-pet self-healing | ✅ | — | — | — | — | — |
| Companion interaction | petting / moods / props / sleep | skins + animation | status-linked | doll + weather | affection / memory / CG | feed / play |
| Read-only (never intercepts agent behavior) | ✅ | unknown | unknown | unknown | unknown | unknown |

**In one line**: most similar projects are "in-page status / companion" plugins. This one focuses on
**complete notification semantics** (7 event kinds + unread badge with jump-to-conversation), **exportable
usage & weekly data**, and a **Windows desktop-pet mode with self-healing** — all strictly read-only.

## Requirements

| Item | Requirement |
|---|---|
| DeepSeek Harness | `dsh.engines` in `whale-assistant/package.json`; tested with 0.1.7-rc.2, 0.2.0-rc.2, 0.2.1-rc.3 and 0.2.2-rc.5 |
| OS | Plugin itself is plain JS (cross-platform); desktop-pet mode is **Windows only** |
| Node.js | Only needed to build from source / run tests |
| Runtime | Official desktop app (recommended) or any modern browser |

## Install (pick ONE route — do not mix, or you get two whales)

1. **DSH plugin market (experimental UI, no command line)** — in DSH open
   *Plugins → Experimental plugins → Custom plugin indexes*, enable it, then go to **Discover → Add index
   source** and paste:

   ```text
   https://cdn.jsdelivr.net/gh/LengMu-Cloud/dsh-whale-assistant@main/market/market-index.json
   ```

   Find **Whale Assistant** (打工小鲸鱼), pick a version, install, restart DSH.

2. **GitHub + scripts (Windows one-liner / manual for macOS & Linux)**:

   ```powershell
   git clone https://github.com/LengMu-Cloud/dsh-whale-assistant.git
   powershell -ExecutionPolicy Bypass -File "<repo>\install.ps1" -Repo "<repo>"
   ```

   Then restart DSH. Manual steps for macOS/Linux and troubleshooting are documented in the Chinese
   [README.md](README.md).

3. **npm package** — `@lengmu-cloud/dsh-whale-assistant` (published since 0.4.3):

   ```text
   dsh plugin --profile web add @lengmu-cloud/dsh-whale-assistant
   ```

After installing, restart DSH once (the host half must be loaded), then the whale appears in the
bottom-right corner. Right-click it for settings, history, weekly report, reminders and the mode menu.

## Safety & privacy

- Consumes DSH's public event stream and projections **read-only**; never intercepts or rewrites tasks.
- Server half adds local loopback HTTP routes only; no external requests, no telemetry, no analytics.
- Data lives in `~/.dsh/whale-assistant.json` (server-side mirror) and browser `localStorage`; nothing is
  synced across machines.
- The whale body is the DeepSeek whale mark (rights belong to DeepSeek); this project is unofficial and
  not affiliated with DeepSeek.

## Development

```text
node build-whale.js       # rebuild whale.js from src/ (35 modules) and sync release copies
node test-whale.js        # vm sandbox unit tests (1282 assertions)
node test-chip-gate.js    # chip gate pure functions (19 assertions)
node test-host-store.js   # host-side ledger tests (235 checks)
node scripts/audit-deps.js
```

See [docs/architecture.md](docs/architecture.md) and [docs/seams.md](docs/seams.md) (Chinese).

## Links

- Chinese README (full docs): [README.md](README.md)
- Features: [FEATURES.md](FEATURES.md) (Chinese)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- License: [MIT](LICENSE)

---

*Third-party, unofficial plugin for DeepSeek Harness. DSH and the DeepSeek whale mark belong to DeepSeek
and their respective owners; this repository only provides an unofficial plugin icon.*
