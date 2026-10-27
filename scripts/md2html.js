#!/usr/bin/env node
/** Markdown→HTML converter for the 设计总结汇报 documents (self-contained
 * single-file output: sticky TOC + scrollspy + progress bar + back-to-top,
 * role-classified blockquotes, dark-mode via prefers-color-scheme).
 * Supports exactly the constructs those docs use: h1-h4, hr, blockquote,
 * GFM tables (with \| escapes), fenced code, ordered/unordered lists,
 * bold / inline code / links, and emoji. Everything else passes through
 * as a paragraph. Usage: node scripts/md2html.js <in.md> <out.html> [title]
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
	out = out.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
	out = out.replace(/\*\*([^*]+)\*\*/g, function (_, c) { return '<strong>' + c + '</strong>'; });
	out = out.replace(/\*([^*\n]+)\*/g, function (_, c) { return '<em>' + c + '</em>'; });
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, u) {
		return '<a href="' + u.replace(/"/g, '%22') + '">' + t + '</a>';
	});
	return out;
}
/** Plain text for TOC entries (strip inline markers). */
function plainText(s) {
	return s.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1');
}

/* ---------- CSS ---------- */
const CSS = `
:root{
  --bg:#ffffff; --fg:#1f2937; --muted:#64748b;
  --accent:#1d4ed8; --accent-soft:#dbeafe; --th-fg:#1e3a8a;
  --border:#e2e8f0; --border-strong:#cbd5e1;
  --code-bg:#f1f5f9; --zebra:#f8fafc; --toc-bg:#f8fafc;
  --pre-bg:#0f172a; --pre-fg:#e2e8f0;
  --note-bg:#fffbeb; --note-bar:#d97706;
  --brief-bg:#f0fdf4; --brief-bar:#16a34a;
  --lead-bar:#94a3b8; --lead-fg:#475569;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;display:flex;background:var(--bg);color:var(--fg);
  font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',system-ui,sans-serif;
  font-size:16px;line-height:1.8}
main{flex:1 1 auto;min-width:0}
.wrap{max-width:54em;margin:0 auto;padding:40px 28px 96px;width:100%;min-width:0}
p{margin:.85em 0}
ul,ol{padding-left:1.5em;margin:.6em 0}
li{margin:.35em 0}
li::marker{color:var(--accent)}
hr{border:none;border-top:1px dashed var(--border-strong);margin:2.2em 0}
em{color:var(--muted)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

h1{font-size:1.9em;line-height:1.45;text-align:center;color:var(--accent);
  border-bottom:3px solid var(--accent);padding-bottom:16px;margin:.2em 0 .8em}
h2{font-size:1.42em;line-height:1.55;color:var(--accent);
  border-left:5px solid var(--accent);border-bottom:1px solid var(--border);
  padding:2px 0 10px 14px;margin:2.6em 0 1em}
h3{font-size:1.16em;line-height:1.6;margin:2em 0 .6em}
h4{font-size:1.05em;margin:1.5em 0 .5em}
h2,h3,h4{scroll-margin-top:16px}

.tbl-wrap{overflow-x:auto;margin:1.2em 0;border:1px solid var(--border);
  border-radius:8px;-webkit-overflow-scrolling:touch}
/* burst = top-level tables only: a negative margin on a table inside a
 * blockquote drags it out across the quote's border (green line through
 * the table) */
@media (min-width:1101px){ .wrap > .tbl-wrap{margin-inline:-2.5em} }
table{border-collapse:separate;border-spacing:0;width:100%;min-width:620px;
  font-size:.88em;line-height:1.65}
th,td{padding:8px 12px;text-align:left;vertical-align:top;overflow-wrap:break-word;
  border-bottom:1px solid var(--border);border-right:1px solid var(--border)}
th:last-child,td:last-child{border-right:none}
tr:last-child td{border-bottom:none}
th{background:var(--accent-soft);color:var(--th-fg);font-weight:600}
tr:nth-child(even) td{background:var(--zebra)}

code{font-family:Consolas,'Cascadia Mono','Courier New',monospace;
  background:var(--code-bg);border:1px solid var(--border);border-radius:4px;
  padding:.08em .4em;font-size:.86em}
pre{background:var(--pre-bg);color:var(--pre-fg);border:none;border-radius:8px;
  padding:14px 18px;margin:1.2em 0;font-size:.86em;line-height:1.6;
  white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:auto}
pre code{background:none;border:none;padding:0;color:inherit;font-size:1em}

blockquote{margin:1.3em 0;padding:12px 18px;border-radius:0 8px 8px 0}
blockquote p{margin:.45em 0}
blockquote.bq-plain{background:var(--code-bg);border-left:4px solid var(--border-strong)}
blockquote.bq-note{background:var(--note-bg);border-left:4px solid var(--note-bar)}
blockquote.bq-brief{background:var(--brief-bg);border-left:4px solid var(--brief-bar)}
blockquote.bq-lead{background:transparent;border-left:4px solid var(--lead-bar);
  color:var(--lead-fg);font-size:.95em}
blockquote.bq-note::before,
blockquote.bq-brief::before,
blockquote.bq-lead::before{display:block;font-size:.72em;font-weight:700;
  letter-spacing:.12em;margin-bottom:6px}
blockquote.bq-note::before{content:'补记 · UPDATE';color:var(--note-bar)}
blockquote.bq-brief::before{content:'速览';color:var(--brief-bar)}
blockquote.bq-lead::before{content:'缘起';color:var(--lead-bar)}
blockquote table{font-size:.84em}
blockquote ul,blockquote ol{margin:.4em 0}

/* —— 侧栏目录（桌面常驻 sticky，窄屏抽屉） —— */
#toc{flex:0 0 272px;width:272px;position:sticky;top:0;height:100vh;overflow-y:auto;
  background:var(--toc-bg);border-right:1px solid var(--border);
  padding:18px 10px 48px;font-size:13px;line-height:1.5;scrollbar-width:thin}
#toc .toc-head{font-weight:700;color:var(--muted);font-size:12px;letter-spacing:.14em;margin:2px 10px 10px}
#toc a{display:block;color:var(--fg);text-decoration:none;padding:5px 10px;
  border-left:3px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#toc a.toc-h3{padding-left:26px;color:var(--muted);font-weight:400}
#toc a:hover{background:var(--accent-soft)}
#toc a.active{border-left-color:var(--accent);color:var(--accent);
  background:var(--accent-soft);font-weight:600}
#toc .no{color:var(--muted);font-weight:600;margin-right:6px}
#toc a.active .no{color:inherit}

#progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:80;pointer-events:none}
#progress-bar{height:100%;background:var(--accent);transform:scaleX(0);transform-origin:0 50%}
#backtop{position:fixed;right:22px;bottom:26px;width:42px;height:42px;border-radius:50%;
  border:1px solid var(--border);background:var(--bg);color:var(--fg);font-size:17px;
  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.14);z-index:60}
#backtop:hover{color:var(--accent);border-color:var(--accent)}
#toc-toggle{display:none;position:fixed;top:12px;left:12px;z-index:90;padding:6px 12px;
  border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--fg);cursor:pointer}
#toc-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:85}
@media (max-width:1100px){
  #toc-toggle{display:block}
  #toc{position:fixed;left:0;top:0;width:280px;z-index:95;
    transform:translateX(-102%);transition:transform .22s ease;box-shadow:0 0 24px rgba(0,0,0,.25)}
  body.toc-open #toc{transform:none}
  body.toc-open #toc-backdrop{display:block}
  .wrap{padding-top:64px}
}
.h-anchor{opacity:0;margin-left:10px;font-weight:400;text-decoration:none;color:var(--muted)}
h1:hover .h-anchor,h2:hover .h-anchor,h3:hover .h-anchor,h4:hover .h-anchor{opacity:.55}
h2:target,h3:target{background:var(--accent-soft)}

@media (prefers-color-scheme:dark){ :root{
  --bg:#111827; --fg:#d1d5db; --muted:#9ca3af;
  --accent:#60a5fa; --accent-soft:rgba(96,165,250,.14); --th-fg:#bfdbfe;
  --border:#374151; --border-strong:#4b5563;
  --code-bg:#1f2937; --zebra:#182236; --toc-bg:#0d1424;
  --pre-bg:#0b1120; --pre-fg:#cbd5e1;
  --note-bg:rgba(217,119,6,.10); --brief-bg:rgba(22,163,74,.10);
} }
@media print{#toc,#toc-toggle,#backtop,#progress{display:none}body{display:block}.wrap{max-width:none;padding:0}}
`;

/* ---------- runtime JS ---------- */
const JS = `
(function(){
'use strict';
var toc=document.getElementById('toc');
var links=toc?[].slice.call(toc.querySelectorAll('a')):[];
var byId={};
links.forEach(function(a){byId[a.hash.slice(1)]=a;});
var heads=links.map(function(a){return document.getElementById(a.hash.slice(1));}).filter(Boolean);
var activeId=null;
function setActive(id){
  if(id===activeId||!id)return;
  activeId=id;
  links.forEach(function(a){a.classList.toggle('active',a.hash==='#'+id);});
  var el=byId[id];
  if(el&&toc){
    var top=el.offsetTop;
    if(top<toc.scrollTop+32||top>toc.scrollTop+toc.clientHeight-64){
      toc.scrollTop=top-toc.clientHeight*0.4;
    }
  }
  try{ if(location.hash!=='#'+id) history.replaceState(null,'','#'+id); }catch(_){}
}
if('IntersectionObserver' in window&&heads.length){
  var io=new IntersectionObserver(function(entries){
    for(var k=0;k<entries.length;k++){
      var en=entries[k];
      if(en.isIntersecting&&en.boundingClientRect.top<innerHeight*0.3){
        setActive(en.target.id);
      }
    }
  },{rootMargin:'0px 0px -70% 0px',threshold:0});
  heads.forEach(function(h){io.observe(h);});
}
var bar=document.getElementById('progress-bar');
var btn=document.getElementById('backtop');
var docH=1,ticking=false;
function measure(){docH=Math.max(1,document.documentElement.scrollHeight-innerHeight);}
function onScroll(){
  if(ticking)return; ticking=true;
  requestAnimationFrame(function(){
    var y=window.pageYOffset||0;
    bar.style.transform='scaleX('+Math.min(1,y/docH)+')';
    btn.hidden=y<800;
    ticking=false;
  });
}
window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('resize',function(){measure();onScroll();},{passive:true});
measure(); onScroll();
btn.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
var tg=document.getElementById('toc-toggle'), bd=document.getElementById('toc-backdrop');
function closeToc(){document.body.classList.remove('toc-open');}
if(tg)tg.addEventListener('click',function(){document.body.classList.toggle('toc-open');});
if(bd)bd.addEventListener('click',closeToc);
links.forEach(function(a){a.addEventListener('click',closeToc);});
})();
`;

/* ---------- parsing ---------- */
const lines = raw.split(/\r?\n/);
let hSeq = 0;
const tocEntries = [];

/** blockquote role by content features (checked on raw, pre-escape text) */
function quoteClass(buf) {
	const first = (buf.find(function (b) { return b.trim(); }) || '').trim();
	const all = buf.join('\n');
	if (first.indexOf('📣') === 0) return 'bq-note';
	if (all.indexOf('缘起') !== -1) return 'bq-lead';
	if (all.indexOf('➡') !== -1 || all.indexOf('速览') !== -1) return 'bq-brief';
	return 'bq-plain';
}

/** Recursive block renderer: blockquotes re-enter the same parser so
 * tables / lists / code inside quotes render structurally. */
function renderBlocks(srcLines) {
	const out = [];
	let i = 0;
	let inCode = false, codeBuf = [];
	let listType = null, listBuf = [];
	let paraBuf = [];

	function flushPara() {
		if (paraBuf.length) {
			out.push('<p>' + paraBuf.map(inline).join('<br>') + '</p>');
			paraBuf = [];
		}
	}
	function flushList() {
		if (listBuf.length) {
			out.push('<' + listType + '>' + listBuf.map(function (li) { return '<li>' + inline(li) + '</li>'; }).join('') + '</' + listType + '>');
			listBuf = []; listType = null;
		}
	}

	while (i < srcLines.length) {
		const line = srcLines[i];

		if (line.startsWith('```')) {
			flushPara(); flushList();
			if (!inCode) { inCode = true; codeBuf = []; }
			else { inCode = false; out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); }
			i++; continue;
		}
		if (inCode) { codeBuf.push(line); i++; continue; }

		if (/^#{1,4} /.test(line)) {
			flushPara(); flushList();
			const level = line.match(/^#+/)[0].length;
			const rawText = line.slice(level + 1).trim();
			const id = 'sec-' + (++hSeq);
			const plain = plainText(rawText);
			if (level === 2 || (level === 3 && /^\d+\.\d+/.test(plain))) {
				tocEntries.push({ id: id, level: level, text: plain });
			}
			const anchor = '<a class="h-anchor" href="#' + id + '" aria-hidden="true">#</a>';
			out.push('<h' + level + ' id="' + id + '">' + inline(esc(rawText)) + anchor + '</h' + level + '>');
			i++; continue;
		}
		if (/^(---+|\*\*\*+)$/.test(line.trim())) {
			flushPara(); flushList(); out.push('<hr>'); i++; continue;
		}
		if (line.startsWith('>')) {
			flushPara(); flushList();
			const buf = [];
			while (i < srcLines.length && srcLines[i].startsWith('>')) {
				buf.push(srcLines[i].replace(/^>\s?/, '')); i++;
			}
			out.push('<blockquote class="' + quoteClass(buf) + '">' + renderBlocks(buf).join('\n') + '</blockquote>');
			continue;
		}
		// table
		if (line.trim().startsWith('|') && i + 1 < srcLines.length && /^\s*\|[\s:|-]+\|\s*$/.test(srcLines[i + 1])) {
			flushPara(); flushList();
			const header = line.trim().slice(1, -1).split(/(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
			i += 2;
			const rows = [];
			while (i < srcLines.length && srcLines[i].trim().startsWith('|')) {
				rows.push(srcLines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, '|').trim(); }));
				i++;
			}
			let t = '<table><tr>' + header.map(function (h) { return '<th>' + inline(esc(h)) + '</th>'; }).join('') + '</tr>';
			for (const r of rows) {
				t += '<tr>' + r.map(function (c) { return '<td>' + inline(esc(c)) + '</td>'; }).join('') + '</tr>';
			}
			out.push('<div class="tbl-wrap">' + t + '</div>');
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
	return out;
}

const body = renderBlocks(lines);

/* ---------- TOC ---------- */
const labelRe = /^(第[0-9一二三四五六七八九十百]+章|[一二三四五六七八九十]+、|附录[A-Z][0-9]?、|\d+\.\d+)\s*/;
const tocHtml = tocEntries.length ? ['<nav id="toc" aria-label="目录">', '<div class="toc-head">目 录</div>']
	.concat(tocEntries.map(function (t) {
		const m = t.text.match(labelRe);
		const label = m ? '<b class="no">' + esc(m[1]) + '</b>' + esc(t.text.slice(m[0].length)) : esc(t.text);
		return '<a class="toc-h' + t.level + '" href="#' + t.id + '">' + label + '</a>';
	}), ['</nav>']).join('\n') : '';

const title = titleArg || '设计总结汇报';
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="progress"><div id="progress-bar"></div></div>
<button id="toc-toggle" aria-label="打开目录">☰ 目录</button>
${tocHtml}
<div id="toc-backdrop"></div>
<main><div class="wrap">

${body.join('\n')}

</div></main>
<button id="backtop" hidden title="回到顶部">↑</button>
<script>
${JS}
</script>
</body>
</html>
`;
fs.writeFileSync(outPath, html, 'utf8');
console.log('written', outPath, html.length, 'chars,', body.length, 'blocks,', tocEntries.length, 'toc entries');
