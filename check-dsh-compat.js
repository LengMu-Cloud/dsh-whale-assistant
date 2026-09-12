#!/usr/bin/env node
'use strict';
/* check-dsh-compat.js — DSH upgrade compatibility checker for the whale plugin.
 *
 * Scripts the "插件耦合点全景" inventory (升级方案-DSH-0.1.5.md §2): the plugin
 * depends on DSH internals that are NOT a stable public API (DOM shape, event
 * frame names, projection keys, localStorage layout, hook anchors). Run this
 * BEFORE/AFTER every DSH upgrade instead of walking the manual checklist:
 *
 *   node check-dsh-compat.js --static "<DSH安装目录>"       upgrade BEFORE: scan the new package for every coupled symbol
 *   node check-dsh-compat.js --live [--port 3080] [--token T] [--cdp]   upgrade AFTER: probe the RUNNING instance
 *
 * Exit code 0 = all green; 1 = at least one ⚠️ (finish with the human steps in
 * 升级方案 附录 C: short-task live regression + bubble vision check).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined;
};
const has = (name) => args.includes(name);

/* ---------- static mode: symbol scan over the new DSH package ---------- */
/* mode 'all' = every pattern must appear somewhere; 'any' = at least one.
 * D-layer text patterns assume the bundle keeps CJK literals unescaped —
 * a ⚠️ there means grep the bundle manually (maybe \\uXXXX escaped) before
 * concluding breakage. */
const STATIC_CHECKS = [
	{ id: 'A1', layer: 'A 宿主半区', desc: 'webServer.register 路由注册点', mode: 'all', patterns: ['webServer.register'] },
	{ id: 'A2', layer: 'A 宿主半区', desc: "ctx.on('session/event') 订阅面", mode: 'all', patterns: ['session/event'] },
	{ id: 'A3', layer: 'A 宿主半区', desc: 'sessionProjections 投影', mode: 'all', patterns: ['sessionProjections'] },
	{ id: 'A4', layer: 'A 宿主半区', desc: 'sessionController（dev-say）', mode: 'all', patterns: ['sessionController'] },
	{ id: 'B1', layer: 'B 客户端加载', desc: '__ModuleLoader__.load 注入点', mode: 'all', patterns: ['__ModuleLoader__'] },
	{ id: 'C1', layer: 'C 服务事件', desc: '任务帧 turn/start · turn/end', mode: 'all', patterns: ['turn/start', 'turn/end'] },
	{ id: 'C2', layer: 'C 服务事件', desc: '标题/工具/消息帧', mode: 'all', patterns: ['session/title', 'tool/call', 'assistant/message'] },
	{ id: 'C3', layer: 'C 服务事件', desc: '投影帧 tokenUsage · contextPressure', mode: 'all', patterns: ['session/projection', 'tokenUsage', 'contextPressure'] },
	{ id: 'C4', layer: 'C 服务事件', desc: '活跃信号 agent/inbox(/spliced)', mode: 'all', patterns: ['agent/inbox'] },
	{ id: 'D1', layer: 'D DOM 适配（最脆）', desc: "localStorage 'dsh.sessions.current'", mode: 'all', patterns: ['dsh.sessions.current'] },
	{ id: 'D2', layer: 'D DOM 适配', desc: "localStorage 'dsh.conversation(.chat).'", mode: 'any', patterns: ['dsh.conversation.chat.', 'dsh.conversation.'] },
	{ id: 'D3', layer: 'D DOM 适配', desc: 'DOM 属性 data-chat-flow', mode: 'all', patterns: ['data-chat-flow'] },
	{ id: 'D4', layer: 'D DOM 适配', desc: 'data-tool / data-chat-call-id / data-state', mode: 'all', patterns: ['data-tool', 'data-chat-call-id', 'data-state'] },
	{ id: 'D5', layer: 'D DOM 适配', desc: '用量文本（bundle 转义时漏报，人工复核）', mode: 'any', patterns: ['用量', '上下文已用'] },
	{ id: 'D6', layer: 'D DOM 适配', desc: 'document.title 后缀 DeepSeek Harness', mode: 'all', patterns: ['DeepSeek Harness'] },
	{ id: 'E1', layer: 'E 跳转钩子', desc: '锚点 const sessions = ctx.sessions', mode: 'all', patterns: ['const sessions = ctx.sessions'] },
	{ id: 'E2', layer: 'E 跳转钩子', desc: 'sessions.loadOlder（加载更早）', mode: 'all', patterns: ['loadOlder'] },
];

function scanStatic(rootDir) {
	const abs = path.resolve(rootDir);
	if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
		console.log('目录不存在: ' + abs);
		process.exit(1);
	}
	const files = [];
	(function walk(dir, depth) {
		if (depth > 8) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (e.name === 'node_modules' || e.name === '.git') continue;
			const p = path.join(dir, e.name);
			if (!path.resolve(p).startsWith(abs)) continue; /* boundary check */
			if (e.isDirectory()) walk(p, depth + 1);
			else if (/\.(js|mjs|cjs|html)$/i.test(e.name) && e.size < 5 * 1024 * 1024) files.push(p);
		}
	})(abs, 0);
	console.log('扫描 ' + files.length + ' 个文件（' + abs + '）\n');
	const bodies = files.map((f) => {
		try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
	});
	let warn = 0;
	for (const c of STATIC_CHECKS) {
		const hits = c.patterns.filter((pt) => bodies.some((b) => b.includes(pt)));
		const ok = c.mode === 'any' ? hits.length > 0 : hits.length === c.patterns.length;
		const missing = c.patterns.filter((pt) => !hits.includes(pt));
		if (ok) console.log('[✅] ' + c.id + ' ' + c.layer + ' — ' + c.desc);
		else { warn++; console.log('[⚠️] ' + c.id + ' ' + c.layer + ' — ' + c.desc + '（未命中: ' + missing.join(' , ') + '）'); }
	}
	console.log('\n静态扫描: ' + (warn === 0 ? '全部命中 — 耦合面完好，可继续升级流程' : warn + ' 项未命中 — 升级前先读 升级方案-DSH-0.1.5.md §3/§4 评估适配，⚠️ 项人工 grep 确认（bundle 可能转义 CJK）'));
	process.exit(warn === 0 ? 0 : 1);
}

/* ---------- live mode: probe the running instance ---------- */
function req(port, urlPath) {
	return new Promise((resolve, reject) => {
		const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, timeout: 5000 }, (res) => {
			let buf = '';
			res.on('data', (c) => (buf += c));
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
		});
		r.on('error', (e) => reject(e));
		r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
		r.end();
	});
}

async function scanLive(port, token, cdp) {
	let warn = 0;
	const mark = (ok, msg) => { if (!ok) warn++; console.log((ok ? '[✅] ' : '[⚠️] ') + msg); };

	/* 1. DSH web up? 200/302 = open; 401 = up and asking for auth — all fine. Only
	 *    connection errors / 404+ mean the web server is not the one we expect. */
	try {
		const home = await req(port, '/');
		mark(home.status === 200 || home.status === 302 || home.status === 401, 'DSH web 响应 / → ' + home.status + (home.status === 401 ? '（服务在，要求认证）' : ''));
	} catch (e) { mark(false, 'DSH web 不可达（127.0.0.1:' + port + '）：' + e.message + ' — 实例没起或端口不同'); }

	/* 2. plugin routes exist? 404 = route gone (upgrade breakage); 401/303 = exists, auth needed */
	const cookie = [];
	if (token) {
		try {
			const auth = await req(port, '/?token=' + encodeURIComponent(token));
			(auth.headers['set-cookie'] || []).forEach((c) => cookie.push(c.split(';')[0]));
		} catch (e) { /* reported below per-route */ }
	}
	const cookieHeader = cookie.length ? { cookie: cookie.join('; ') } : {};
	for (const route of ['/api/whale-assistant/state', '/api/whale-assistant/events']) {
		try {
			const res = await req(port, route + (route.includes('?') ? '&' : '?') + '_=' + Date.now());
			if (res.status === 404) { mark(false, route + ' → 404 路由消失（宿主半区未注册/升级破坏）'); continue; }
			if (res.status === 401 || res.status === 303) { mark(true, route + ' → ' + res.status + ' 路由存在（需认证；要深度校验请加 --token）'); continue; }
			if (res.status === 200) {
				try {
					const json = JSON.parse(res.body);
					if (route.endsWith('/state')) mark(Array.isArray(json.history), route + ' → 200 且 history 字段为' + (Array.isArray(json.history) ? '数组（' + json.history.length + ' 条记录）' : '缺失⚠️'));
					else mark(json && Array.isArray(json.events), route + ' → 200 且 events 字段为' + (json && Array.isArray(json.events) ? '数组（seq 最大 ' + Math.max(0, ...json.events.map((f) => f.seq || 0)) + '）' : '缺失⚠️'));
				} catch (e) { mark(false, route + ' → 200 但响应不是 JSON'); }
				continue;
			}
			mark(false, route + ' → ' + res.status + '（人工确认）');
		} catch (e) { mark(false, route + ' 不可达：' + e.message); }
	}

	/* 3. shell debug port */
	if (cdp) {
		try {
			const ver = await req(9222, '/json/version');
			mark(ver.status === 200, '壳 CDP 9222 可达（' + JSON.parse(ver.body).Browser + '）');
			const list = await req(9222, '/json/list');
			const targets = JSON.parse(list.body).map((t) => t.url).filter((u) => u && !u.startsWith('devtools'));
			console.log('    targets: ' + (targets.join(' | ') || '(无页面)'));
		} catch (e) { mark(true, '壳 CDP 9222 不可达（' + e.message + '）— 壳未运行时属正常，DOM 级检查改跑 scripts/run-e2e.js'); }
	}

	console.log('\n存活探针: ' + (warn === 0 ? '全部通过 — 接下来按 升级方案 附录 C 做真机回归（短任务 3~5 轮 + 气泡识图）' : warn + ' 项 ⚠️ — 先人工复核再当日常用'));
	process.exit(warn === 0 ? 0 : 1);
}

if (has('--static')) scanStatic(flag('--static'));
else if (has('--live')) scanLive(Number(flag('--port')) || 3080, flag('--token') || process.env.DSH_TOKEN || '', has('--cdp'));
else {
	console.log('用法:\n  node check-dsh-compat.js --static "<DSH安装目录>"\n  node check-dsh-compat.js --live [--port 3080] [--token XXX] [--cdp]');
	process.exit(2);
}
