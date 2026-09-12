#!/usr/bin/env node
'use strict';
/* audit-deps.js — static architecture audit for the whale.js module set.
 *
 * Concatenates src/ in manifest order (the modules tile the original single-file
 * whale.js, so the concatenation IS the real runtime scope layout) and reports:
 *   A   module surface by scope (depth 1 = IIFE-global, depth>=2 = closure-local)
 *   A2  same-name declarations (REAL collision = both at depth 1 — silent shadowing)
 *   B   dependency edges, scope-correct (closure-private defs only visible in-span)
 *   C   direction check: core consuming ui/input defs
 *   D   shared depth-1 vars: readers and writers (incl. .set/.push mutators)
 *   E   window.__dshWhale seam inventory (exports / defensive reads / dynamic-key scans)
 *   F   sessionTitles timing-contract lint (every consumer read must have a fallback)
 *   G   literal-interference self-check (template literals / regex literals / comment
 *       braces) — MUST be clean or the depth-based conclusions above are invalid
 *
 * Usage: node scripts/audit-deps.js
 * History: v1 (2026-09-13) used a min-indent heuristic and produced three false
 * conclusions (a phantom shared 'bubble' var, "FALLBACK_ID double-declaration
 * shadowing", "openHealthPanel dead code"); v3 switched to exact brace-depth
 * tracking over the concatenation and reverted all three. See docs/architecture.md §8.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.normalize(path.join(__dirname, '..'));
const { MANIFEST } = require('../whale-manifest.js');

/* reads are whitelisted to manifest files with a root-boundary check */
const content = {};
for (const m of MANIFEST) {
	const p = path.normalize(path.join(ROOT, m.file));
	if (!p.startsWith(ROOT + path.sep)) throw new Error('path escape rejected: ' + m.file);
	content[m.file] = fs.readFileSync(p, 'utf8');
}
const ORDER = MANIFEST.map((m) => m.file);

const fileOfLine = [];
const joined = [];
for (const f of ORDER) for (const l of content[f].split('\n')) { fileOfLine.push(f); joined.push(l); }
function stripLine(l) {
	let t = l.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
	t = t.replace(/`(?:[^`\\]|\\.)*`/g, '``');
	return t.replace(/\/\/.*$/, '');
}
const noBlock = joined.join('\n').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map(stripLine);

/* ---- section G FIRST: if stripping assumptions break, depth results are void ---- */
const rawAll = joined.join('\n');
let inTpl = false;
const tplLines = [];
joined.forEach((l, i) => { for (const ch of l) { if (ch === '`') inTpl = !inTpl; } if (inTpl) tplLines.push(fileOfLine[i] + ':' + (i + 1)); });
let reBad = 0;
for (const m of rawAll.matchAll(/(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/[gimsuy]*/g)) {
	const body = m[1];
	const balanced = ((body.match(/\{/g) || []).length) === ((body.match(/\}/g) || []).length);
	if (!balanced || /['"`]/.test(body)) reBad++;
}
const interference = tplLines.length > 0 || reBad > 0;

/* ---- depth + closures ---- */
const depthAtLine = [];
let depth = 0;
noBlock.forEach((l) => {
	depthAtLine.push(depth);
	for (const ch of l) { if (ch === '{') depth++; else if (ch === '}') depth--; }
});
const spans = [];
{
	let open = null;
	noBlock.forEach((l, i) => {
		if (depthAtLine[i] >= 2 && !open) open = { start: i, files: new Set([fileOfLine[i]]) };
		if (open) open.files.add(fileOfLine[i]);
		if (open && depthAtLine[i] >= 2 && (i + 1 >= depthAtLine.length || depthAtLine[i + 1] < 2)) { open.end = i; spans.push(open); open = null; }
	});
}
const spanOf = (i) => spans.find((s) => i >= s.start && i <= s.end) || null;

/* ---- declarations ---- */
const declRe = /^(\s*)(function|var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const defs = {};
const surface = {};
for (const f of ORDER) surface[f] = { topFns: 0, topVars: 0, cloFns: 0, cloVars: 0 };
noBlock.forEach((l, i) => {
	const m = l.match(declRe);
	if (!m || m[1].trim() !== '') return;
	const d = depthAtLine[i], file = fileOfLine[i];
	const kind = m[2] === 'function' ? 'fn' : m[2];
	(defs[m[3]] = defs[m[3]] || []).push({ file, line: i + 1, depth: d, kind, span: spanOf(i) });
	if (d === 1) (kind === 'fn' ? surface[file].topFns++ : surface[file].topVars++);
	else (kind === 'fn' ? surface[file].cloFns++ : surface[file].cloVars++);
});

console.log('== 0) depth sanity ==');
console.log(depth === 0 && Math.min(...depthAtLine) === 0
	? '(concatenated source balances to depth 0, min depth 0)'
	: 'PROBLEM: ends at ' + depth + ', min ' + Math.min(...depthAtLine));

console.log('\n== A) module surface (top=IIFE-global, clo=closure-local) ==');
for (const f of ORDER) {
	const s = surface[f];
	console.log(f.padEnd(30), '| top fns', String(s.topFns).padStart(3), 'vars', String(s.topVars).padStart(3),
		'| clo fns', String(s.cloFns).padStart(3), 'vars', String(s.cloVars).padStart(3));
}

console.log('\n== A2) same-name declarations (REAL collision = both depth 1) ==');
if (interference) console.log('!! literal interference detected — collision conclusions are UNRELIABLE (see section G) !!');
let real = 0;
for (const n of Object.keys(defs).sort()) {
	const ds = defs[n];
	if (ds.length < 2) continue;
	const tops = ds.filter((d) => d.depth === 1);
	if (tops.length > 1) { real++; console.log('REAL COLLISION:', n, JSON.stringify(tops.map((t) => t.file + ':' + t.line))); }
	else console.log('same-name, distinct scopes (ok):', n, JSON.stringify(ds.map((t) => t.file + ':' + t.line + '@d' + t.depth)));
}
if (!real) console.log('(no depth-1 collisions)');

/* ---- edges ---- */
console.log('\n== B) dependency edges (scope-correct): consumer -> definer ==');
const CLOSURE_OK = (consumer, site) => site.depth === 1 || (site.span && site.span.files.has(consumer));
const edges = {};
const seamSuspects = [];
for (const rel of ORDER) {
	const text = noBlock.map((l, i) => (fileOfLine[i] === rel ? l : '')).join('\n');
	for (const name of Object.keys(defs)) {
		const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
		if (!re.test(text)) continue;
		for (const site of defs[name]) {
			if (site.file === rel) continue;
			if (!CLOSURE_OK(rel, site)) { seamSuspects.push(rel + ' -> ' + site.file + '::' + name + ' (closure-private @ ' + site.file + ':' + site.line + ')'); continue; }
			const cnt = (text.match(new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
			const e = (edges[rel] = edges[rel] || {});
			const t = (e[site.file] = e[site.file] || { fns: [], vars: [] });
			(site.kind === 'fn' ? t.fns : t.vars).push(name + 'x' + cnt);
		}
	}
}
let totalEdges = 0;
for (const c of Object.keys(edges).sort()) {
	for (const d of Object.keys(edges[c]).sort()) {
		const t = edges[c][d];
		totalEdges++;
		console.log(c.padEnd(30), '->', d.padEnd(30),
			'fns:' + String(t.fns.length).padStart(3), '[' + t.fns.slice(0, 8).join(',') + (t.fns.length > 8 ? ',…' : '') + ']',
			t.vars.length ? 'vars:[' + t.vars.join(',') + ']' : '');
	}
}
console.log('TOTAL module-level edges:', totalEdges);

console.log('\n== B2) out-of-scope references to closure-private defs (should be seam calls; common local names may noise this up) ==');
console.log(seamSuspects.length ? seamSuspects.join('\n') : '(none)');

console.log('\n== C) DIRECTION CHECK: core consumes ui/input defs ==');
let bad = 0;
for (const c of Object.keys(edges)) if (/^src\/core\//.test(c)) {
	for (const d of Object.keys(edges[c])) if (/^src\/(ui|input)\//.test(d)) { bad++; console.log('EDGE:', c, '->', d, JSON.stringify(edges[c][d])); }
}
console.log(bad === 0 ? '(none)' : bad + ' edge(s)');

console.log('\n== D) shared depth-1 vars: readers and writers (seam export lines excluded) ==');
for (const name of Object.keys(defs)) {
	const site = defs[name].find((d) => d.depth === 1 && d.kind !== 'fn');
	if (!site) continue;
	const readers = [], writers = [];
	for (const rel of ORDER) {
		if (rel === site.file) continue;
		let wrote = false, read = false;
		noBlock.forEach((l, i) => {
			if (fileOfLine[i] !== rel || !l || l.includes('__dshWhale')) return;
			if (new RegExp('\\b' + name + '\\s*(=[^=]|\\.set\\(|\\.push\\(|\\.delete\\(|\\.pop\\(|\\.shift\\()').test(l)) wrote = true;
			if (new RegExp('\\b' + name + '\\b').test(l)) read = true;
		});
		if (wrote) writers.push(rel);
		if (read) readers.push(rel);
	}
	if (readers.length || writers.length) {
		console.log((site.file + '::' + name).padEnd(48),
			'read:', readers.length ? readers.join(' ') : '-',
			'| written:', writers.length ? writers.join(' ') : '-');
	}
}

console.log('\n== E) seam inventory: export lines per file ==');
for (const f of ORDER) {
	const n = noBlock.filter((l, i) => fileOfLine[i] === f && /__dshWhale\s*\.\s*[A-Za-z_$][\w$]*\s*=[^=]/.test(l)).length;
	if (n) console.log(f.padEnd(30), n, 'export lines');
}
console.log('\n== E2) defensive seam reads (guard-style) ==');
for (const f of ORDER) {
	const reads = [];
	noBlock.forEach((l, i) => {
		if (fileOfLine[i] !== f) return;
		if (/window\.__dshWhale\s*&&\s*window\.__dshWhale\.\w+/.test(l) || /typeof window\.__dshWhale\.\w+/.test(l)) reads.push((i + 1) + ': ' + l.trim().slice(0, 90));
	});
	if (reads.length) console.log(f, '\n  ' + reads.join('\n  '));
}
console.log('\n== E3) dynamic-key / dynamic-iteration scans (10 patterns) ==');
const dynPatterns = [
	[/Object\.keys\(\s*window\.__dshWhale/, 'Object.keys traversal'],
	[/Object\.(?:entries|values|getOwnPropertyNames)\(\s*window\.__dshWhale/, 'Object.entries/values/getOwnPropertyNames'],
	[/Reflect\.ownKeys\(\s*window\.__dshWhale/, 'Reflect.ownKeys'],
	[/for\s*\(\s*(?:var|let)\s+\w+\s+in\s+window\.__dshWhale/, 'for-in traversal'],
	[/with\s*\(\s*window\.__dshWhale\s*\)/, 'with statement'],
	[/__dshWhale\s*\[\s*['"`]?\s*\+/, 'bracket + concatenation'],
	[/__dshWhale\s*\[\s*[A-Za-z_$][\w$]*\s*\]/, 'bracket variable access'],
	[/(?:var|let|const)\s*\{[^}]*\}\s*=\s*window\.__dshWhale/, 'destructuring'],
	[/\.\.\.\s*window\.__dshWhale/, 'spread'],
	[/JSON\.(?:parse|stringify)\s*\(\s*window\.__dshWhale/, 'JSON round-trip'],
];
let dynFound = 0;
for (const [re, label] of dynPatterns) {
	const hits = [];
	noBlock.forEach((l, i) => { if (re.test(l)) hits.push(fileOfLine[i] + ':' + (i + 1)); });
	if (hits.length) { dynFound++; console.log('FOUND', label, '->', hits.join(' ')); }
}
console.log(dynFound === 0 ? '(all 10 dynamic-access patterns zero — seam namespace statically enumerable under this pattern set)' : dynFound + ' dynamic pattern(s)');

console.log('\n== F) sessionTitles timing-contract lint (consumer reads need a fallback chain) ==');
let lintBad = 0;
noBlock.forEach((l, i) => {
	const m = l.match(/\bsessionTitles\s*\.\s*(set|get)\b/);
	if (!m) return;
	const file = fileOfLine[i], ln = i + 1;
	if (m[1] === 'set') { console.log('ok (write)  ', file + ':' + ln, l.trim().slice(0, 80)); return; }
	const owner = file === 'src/core/frames.js';
	const fallback = /\|\|/.test(l);
	const preWrite = /\.set\(/.test(l); /* get-then-set check */
	if (!owner && !fallback && !preWrite) { lintBad++; console.log('LINT FAIL  ', file + ':' + ln, l.trim().slice(0, 80)); }
	else console.log('ok (read)   ', file + ':' + ln, l.trim().slice(0, 80));
});
console.log(lintBad === 0
	? '(lint clean: every non-owner read goes through a fallback chain or a get-then-set guard)'
	: lintBad + ' read(s) WITHOUT fallback — a new consumer assuming pre-filled titles. Fix or extend the contract in docs/architecture.md §6.');

console.log('\n== G) literal-interference self-check (must be clean for depth results to hold) ==');
console.log('(1) unterminated template literal lines:', tplLines.length ? tplLines.join(' ') : '(none)');
console.log('(2) regex literals unbalanced/unquotated:', reBad);
console.log('(3) verdict:', interference ? '!! INTERFERENCE — treat A2/B/C depth conclusions as unreliable !!' : 'clean — depth tracking is sound on this tree');
