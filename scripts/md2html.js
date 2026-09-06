#!/usr/bin/env node
/** Minimal Markdown→HTML converter for the 设计总结汇报 documents.
 * Supports exactly the constructs those docs use: h1-h4, hr, blockquote,
 * GFM tables (with \| escapes), fenced code, ordered/unordered lists,
 * bold / inline code / links, and emoji. Everything else passes through
 * as a paragraph. Usage: node scripts/md2html.js <in.md> <out.html> <title>
 */
'use strict';
const fs = require('fs');

const [, , inPath, outPath, titleArg] = process.argv;
if (!inPath || !outPath) {
	console.error('usage: node scripts/md2html.js <in.md> <out.html> [title]');
	process.exit(1);
}
const raw = fs.readFileSync(inPath, 'utf8');

/** Escape HTML specials, restore markdown's escaped pipes. */
function esc(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Inline formatting on already-escaped text. */
function inline(s) {
	let out = s;
	out = out.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	return out;
}

const CSS = `body{font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-size:11pt;line-height:1.75;color:#1f2937;max-width:960px;margin:0 auto;padding:24px 32px;background:#fff}
h1{font-size:22pt;color:#1d4ed8;text-align:center;border-bottom:3px solid #1d4ed8;padding-bottom:12px}
h2{font-size:15pt;color:#1d4ed8;border-left:5px solid #3b82f6;padding-left:10px;margin-top:28px}
h3{font-size:12.5pt;color:#334155;margin-top:22px}
h4{font-size:11.5pt;color:#475569;margin-top:16px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:10.5pt}
th,td{border:1px solid #9ca3af;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#dbeafe;color:#1e3a8a;font-weight:600}
tr:nth-child(even) td{background:#f8fafc}
code,pre{font-family:Consolas,'Courier New',monospace;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px}
code{padding:1px 5px;font-size:10pt}
pre{padding:10px 14px;font-size:10pt;line-height:1.6;overflow:auto;white-space:pre-wrap}
blockquote{background:#fef9c3;border-left:4px solid #facc15;margin:10px 0;padding:8px 14px}
hr{border:none;border-top:1px dashed #cbd5e1;margin:20px 0}
ul,ol{padding-left:22px}
li{margin:4px 0}
em{color:#64748b}
.foot{color:#64748b;text-align:center;margin-top:32px;font-size:10.5pt}`;

const lines = raw.split(/\r?\n/);
const body = [];
let i = 0;
let inCode = false, codeBuf = [];
let listType = null, listBuf = [];
let paraBuf = [];

function flushPara() {
	if (paraBuf.length) {
		body.push('<p>' + paraBuf.map(inline).join('<br>') + '</p>');
		paraBuf = [];
	}
}
function flushList() {
	if (listBuf.length) {
		body.push('<' + listType + '>' + listBuf.map((li) => '<li>' + inline(li) + '</li>').join('') + '</' + listType + '>');
		listBuf = []; listType = null;
	}
}

while (i < lines.length) {
	const line = lines[i];

	if (line.startsWith('```')) {
		flushPara(); flushList();
		if (!inCode) { inCode = true; codeBuf = []; }
		else { inCode = false; body.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); }
		i++; continue;
	}
	if (inCode) { codeBuf.push(line); i++; continue; }

	if (/^#{1,4} /.test(line)) {
		flushPara(); flushList();
		const level = line.match(/^#+/)[0].length;
		const text = inline(esc(line.slice(level + 1).trim()));
		body.push(`<h${level}>` + text + `</h${level}>`);
		i++; continue;
	}
	if (/^(---+|\*\*\*+)$/.test(line.trim())) {
		flushPara(); flushList(); body.push('<hr>'); i++; continue;
	}
	if (line.startsWith('> ')) {
		flushPara(); flushList();
		const buf = [];
		while (i < lines.length && lines[i].startsWith('>')) {
			buf.push(lines[i].replace(/^>\s?/, '')); i++;
		}
		body.push('<blockquote>' + buf.map((b) => '<p>' + inline(esc(b)) + '</p>').join('') + '</blockquote>');
		continue;
	}
	// table
	if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
		flushPara(); flushList();
		const header = line.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
		i += 2;
		const rows = [];
		while (i < lines.length && lines[i].trim().startsWith('|')) {
			rows.push(lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim()));
			i++;
		}
		let t = '<table><tr>' + header.map((h) => '<th>' + inline(esc(h)) + '</th>').join('') + '</tr>';
		for (const r of rows) {
			t += '<tr>' + r.map((c) => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>';
		}
		body.push(t + '</table>');
		continue;
	}
	// lists
	const ul = line.match(/^\s*[-*] (.*)$/);
	const ol = line.match(/^\s*(\d+)[.、] (.*)$/);
	if (ul || ol) {
		flushPara();
		const want = ul ? 'ul' : 'ol';
		if (listType !== want) flushList();
		listType = want;
		listBuf.push((ul ? ul[1] : ol[2]));
		i++; continue;
	}
	if (line.trim() === '') { flushPara(); flushList(); i++; continue; }

	paraBuf.push(line.trim()); i++;
}
flushPara(); flushList();

const title = titleArg || '设计总结汇报';
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${CSS}
</style>
</head>
<body>

${body.join('\n')}

</body>
</html>
`;
fs.writeFileSync(outPath, html, 'utf8');
console.log('written', outPath, html.length, 'chars,', body.length, 'blocks');
