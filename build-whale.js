/**
 * Build whale-patch/whale.js from the modular sources in src/.
 *
 * whale-manifest.js declares ONE contiguous line range per src module, in
 * original source order. Each src file is a VERBATIM byte slice of the
 * original whale.js (produced by _split.js), so concatenating them in
 * manifest order and inserting a banner before each module reproduces the
 * original byte-for-byte — verified mechanically at the end of this script.
 *
 * All src files share ONE IIFE scope at runtime: the built file wraps them in
 * a single (function(){ 'use strict'; ... })() so var/function hoisting is
 * identical to the single-file original.
 *
 * 依赖顺序（manifest 顺序即依赖语义，新增 inline 模块按域插入即可；
 * 全 IIFE 共享作用域，函数声明跨模块提升，运行时顺序无关）:
 *   入口/常量/存储 → core(config/history/gate/adapter/dedup/server-events/health) →
 *   core 状态机(reports/dings/frames/mood) → ui(status-panel/bubble/bootstrap/menu) →
 *   input(swim/drag) → exports(收尾+诊断缝)
 *
 * Usage:  node build-whale.js   (writes whale-patch/whale.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const { MANIFEST } = require('./whale-manifest.js');
const ROOT = __dirname;

function build() {
	let out = '';
	for (const mod of MANIFEST) {
		out += '/* ---- module: ' + mod.file + ' ---- */\n';
		out += fs.readFileSync(path.join(ROOT, mod.file), 'utf8');
	}
	return out;
}

/* === verification: line-sliced modules tile 1..N, order is contiguous;
 * inline modules are authored and bypass range checks. The pristine v1
 * reference (_whale.orig.js) is a local dev artifact, NOT part of the
 * repository — a release clone verifies manifest self-consistency only. */
const ORIG_PATH = path.join(ROOT, '_whale.orig.js');
const ORIG = fs.existsSync(ORIG_PATH) ? fs.readFileSync(ORIG_PATH, 'utf8') : null;
const N = ORIG ? ORIG.split('\n').length : 0;
const sliced = MANIFEST.filter((m) => !m.inline);
{
	if (ORIG) {
		const covered = new Array(N + 1).fill(false);
		for (const mod of sliced) {
			const { start, end } = mod;
			if (start < 1 || end > N || start > end) throw new Error(`${mod.file}: bad range ${start}-${end}`);
			for (let i = start; i <= end; i++) {
				if (covered[i]) throw new Error(`overlap at line ${i} (${mod.file})`);
				covered[i] = true;
			}
		}
		for (let i = 1; i <= N; i++) if (!covered[i]) throw new Error(`gap at line ${i}`);
	} else {
		for (const mod of sliced) {
			if (mod.start > mod.end) throw new Error(`${mod.file}: bad range ${mod.start}-${mod.end}`);
		}
	}
	for (let i = 1; i < sliced.length; i++) {
		if (sliced[i - 1].end + 1 !== sliced[i].start) {
			throw new Error(`manifest order gap: ${sliced[i - 1].file} ends ${sliced[i - 1].end}, ${sliced[i].file} starts ${sliced[i].start}`);
		}
	}
}

/* rebuild from the src slices; auto-split if no sliced src files exist */
const PENDING = MANIFEST.filter((m) => !m.inline && !fs.existsSync(path.join(ROOT, m.file)));
if (PENDING.length === sliced.length) {
	require('./_split.js');
} else if (PENDING.length > 0) {
	throw new Error('partial src tree; run `node _split.js` first. missing: ' + PENDING.map((m) => m.file).join(', '));
}

const out = build();
/* M5.1: build-time version override — `PATCH_VERSION=0.4.0 node build-whale.js`
 * rewrites the default in constants.js; otherwise the in-source default stands */
const envVer = process.env.PATCH_VERSION;
const finalOut = envVer
	? out.replace(/var PATCH_VERSION = '[^']*';/, `var PATCH_VERSION = '${String(envVer).replace(/[^0-9A-Za-z.\-]/g, '')}';`)
	: out;
fs.writeFileSync(path.join(ROOT, 'whale.js'), finalOut);

/* M5.2 release layout: whale-assistant/lib/ is the plugin package's first-hit
 * source for the served script/assets (lib/index.js whaleSources/assetSources).
 * Sync copies on every build so a shipped repo is self-contained — it never
 * falls through to the dev-tree fallback paths — and a rebuild can never be
 * shadowed by a stale package copy. */
{
	const libDir = path.join(ROOT, 'whale-assistant', 'lib');
	fs.mkdirSync(path.join(libDir, 'parts'), { recursive: true });
	fs.writeFileSync(path.join(libDir, 'whale.js'), fs.readFileSync(path.join(ROOT, 'whale.js'), 'utf8'));
	fs.writeFileSync(path.join(libDir, 'parts', 'style.css'), fs.readFileSync(path.join(ROOT, 'parts', 'style.css'), 'utf8'));
	fs.writeFileSync(path.join(libDir, 'whale-logo.svg'), fs.readFileSync(path.join(ROOT, 'whale-logo.svg'), 'utf8'));
	console.log('release copies synced: whale-assistant/lib/{whale.js, parts/style.css, whale-logo.svg}');
}

/* P1⑦: regenerate the Agent navigation map so it can never drift */
require('./scripts/generate-map.js')();

/* helper: rebuild WITHOUT inline modules (only line-sliced projection) */
function slicedOnlySource() {
	let out2 = '';
	for (const mod of sliced) {
		out2 += '/* ---- module: ' + mod.file + ' ---- */\n';
		out2 += fs.readFileSync(path.join(ROOT, mod.file), 'utf8');
	}
	return out2;
}

/* mechanical acceptance:
 * - structural checks above are ALWAYS enforced (tiles + contiguous order)
 * - byte-identity with the pristine original holds ONLY while no slice has
 *   been edited since the split (e.g. constant/rename refactors intentionally
 *   diverge); it is reported, not a hard failure — behaviour is verified by
 *   test-whale.js instead. */
const slicedOnly = slicedOnlySource().replace(/^\/\* ---- module: .* ---- \*\/\n/gm, '');
const identicalSliced = ORIG ? slicedOnly === ORIG : null;
console.log('whale.js rebuilt: %d bytes from %d modules (%d line-sliced %d inline)',
	out.length, MANIFEST.length, sliced.length, MANIFEST.length - sliced.length);
if (identicalSliced === null) {
	console.log('pristine reference (_whale.orig.js) not present (release clone): manifest checks only');
} else if (identicalSliced) {
	console.log('line-sliced parts byte-identical to original: true');
} else {
	const a = slicedOnly.split('\n');
	const b = ORIG.split('\n');
	let diffs = 0;
	let firstAt = -1;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (a[i] !== b[i]) {
			if (firstAt === -1) firstAt = i + 1;
			diffs++;
		}
	}
	console.log('line-sliced parts differ from pristine original: %d lines (first at L%d) — expected if slices were edited (run test-whale.js for behaviour)',
		diffs, firstAt);
}