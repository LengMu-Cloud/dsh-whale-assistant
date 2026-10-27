/* One-off: splice the history-drawer group out of src/ui/menu.js into
 * src/ui/drawers.js (architecture.md §7 trigger line reached at 1471 lines).
 * Block A = L533-642 (history infra), Block B = L696-1113 (reminders + report
 * + export + openHistory + closeCtxHistory). Node only — no BOM, LF kept. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const menuPath = path.join(ROOT, 'src', 'ui', 'menu.js');
const drawersPath = path.join(ROOT, 'src', 'ui', 'drawers.js');

const lines = fs.readFileSync(menuPath, 'utf8').split('\n');
const A_START = 533, A_END = 642;   /* 1-based inclusive */
const B_START = 696, B_END = 1113;

const slice = (a, b) => lines.slice(a - 1, b);
/* sanity anchors — refuse to run if the file drifted */
if (!lines[A_START - 1].includes('History drawer')) throw new Error('A start anchor mismatch: ' + lines[A_START - 1]);
if (!lines[A_END - 1].includes("var historySearch = '';")) throw new Error('A end anchor mismatch: ' + lines[A_END - 1]);
if (!lines[B_START - 1].includes('⏰ 提醒')) throw new Error('B start anchor mismatch: ' + lines[B_START - 1]);
if (!lines[B_END - 1].trim().startsWith('}')) throw new Error('B end anchor mismatch: ' + lines[B_END - 1]);

const header = [
	'/* ---- ui/drawers.js —— 历史抽屉群（architecture.md §7，2026-10-27 从 menu.js 拆出） ----',
	' * 内容仍拼接在 uiInit 闭包体内（bootstrap.js 开、drag.js 合），本文件全部',
	' * var/function 声明与 menu.js 共享同一函数作用域，跨文件引用靠提升，无 import。',
	' * 成员：历史抽屉基建（ctxHistory/historyIcon/indexOfCI/setHighlightText/',
	' *       fillHistoryList/historySearch）+ 提醒（loadReminders/saveReminders/',
	' *       openReminders/20s 触发环）+ 周报 openReport + 导出 exportHistory +',
	' *       历史抽屉 openHistory/closeCtxHistory。 */',
	''
].join('\n');

const drawers = header + slice(A_START, A_END).join('\n') + '\n\n' + slice(B_START, B_END).join('\n') + '\n';

const tombstone = [
	'',
	'		/* ———— 历史抽屉群已拆至 ui/drawers.js（§7 触发线到达，2026-10-27 K3） ———— */',
	''
].join('\n');

const menu = lines.slice(0, A_START - 1).join('\n')
	+ tombstone
	+ lines.slice(A_END, B_START - 1).join('\n')
	+ tombstone
	+ lines.slice(B_END).join('\n');

fs.writeFileSync(drawersPath, drawers, 'utf8');
fs.writeFileSync(menuPath, menu, 'utf8');
console.log('drawers.js written:', drawers.split('\n').length, 'lines');
console.log('menu.js now:', menu.split('\n').length, 'lines');
