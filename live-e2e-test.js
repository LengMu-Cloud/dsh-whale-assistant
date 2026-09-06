/**
 * Live end-to-end test for the whale notification pipeline (2026-09-02).
 * Drives the REAL DSH server over its HTTP RPC bridge and observes frame
 * generation latency + the whale's own reaction (history records), with an
 * exactly-once check.
 * Usage: DSH_TOKEN=<token> node live-e2e-test.js
 */
const http = require('http');

const PORT = 3080;
const SID = 'session-20b7a2cf-3762-4d9e-85b9-4a7c0dcd197c';

function req(method, urlPath, body, cookie) {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const r = http.request({
			host: '127.0.0.1', port: PORT, method, path: urlPath,
			headers: Object.assign(
				{ 'content-type': 'application/json' },
				data ? { 'content-length': Buffer.byteLength(data) } : {},
				cookie ? { cookie } : {}
			),
		}, (res) => {
			let buf = '';
			res.on('data', (c) => (buf += c));
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
		});
		r.on('error', reject);
		if (data) r.write(data);
		r.end();
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	const token = process.env.DSH_TOKEN || '';
	if (!token) { console.log('FATAL: DSH_TOKEN env missing'); process.exit(1); }
	const auth = await req('GET', '/?token=' + encodeURIComponent(token), null, null);
	const setCookie = auth.headers['set-cookie'] || [];
	const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
	console.log('auth:', auth.statusCode, cookie ? 'cookie ok' : 'NO COOKIE');

	const events = async () => JSON.parse((await req('GET', '/api/whale-assistant/events', null, cookie)).body);
	const state = async () => JSON.parse((await req('GET', '/api/whale-assistant/state', null, cookie)).body);

	const base = await state();
	const baseCount = base.history.filter((h) => h.sessionId === SID).length;
	const baseMaxSeq = Math.max(0, ...(await events()).events.map((f) => f.seq || 0));
	console.log('baseline: records for SID =', baseCount, '| maxSeq =', baseMaxSeq);

	const t0 = Date.now();
	console.log('[T0] sending prompt 1 (plain reply) via whale dev-say...');
	const p1 = await req('POST', '/api/whale-assistant/dev-say', {
		sessionId: SID,
		text: '链路测试A：请只回复 OK 两个字母，不要使用任何工具，不要解释。',
	}, cookie);
	console.log('[T+' + (Date.now() - t0) + 'ms] dev-say response:', p1.status, p1.body.slice(0, 120));

	let sawStart = 0, sawEnd = 0, endReason = null, lastSeq = baseMaxSeq;
	const deadline = t0 + 90000;
	while (Date.now() < deadline && !(sawStart && sawEnd)) {
		await sleep(400);
		for (const f of (await events()).events) {
			if (!f || typeof f.seq !== 'number' || f.seq <= lastSeq) continue;
			lastSeq = f.seq;
			if (f.sessionId !== SID) continue;
			const e = f.event || {};
			if (e.type === 'turn/start' && !sawStart) {
				sawStart = e.time || Date.now();
				console.log('[T+' + (sawStart - t0) + 'ms] turn/start frame generated');
			}
			if (e.type === 'turn/end' && !sawEnd) {
				sawEnd = e.time || Date.now();
				endReason = e.data && e.data.reason && e.data.reason.kind;
				console.log('[T+' + (sawEnd - t0) + 'ms] turn/end frame generated, reason=' + endReason);
			}
		}
	}
	if (!sawEnd) { console.log('FAIL: no turn/end within 90s'); process.exit(1); }

	let rec = null;
	const wDeadline = Date.now() + 20000;
	while (Date.now() < wDeadline && !rec) {
		await sleep(700);
		const mine = (await state()).history.filter((h) => h.sessionId === SID);
		if (mine.length > baseCount) rec = mine[mine.length - 1];
	}
	if (rec) {
		console.log('[T+' + (rec.at - t0) + 'ms] whale history record: kind=' + rec.kind +
			' title=' + rec.title + ' turnTokens=' + rec.turnTokens);
		await sleep(4000);
		const mine2 = (await state()).history.filter((h) => h.sessionId === SID && h.at > t0 - 2000);
		console.log('records since T0:', mine2.length, mine2.map((h) => h.kind + '@' + (h.at - t0) + 'ms').join(', '));
		console.log(mine2.length === 1 && mine2[0].kind === 'done' ? 'TEST1 PASS' : 'TEST1 CHECK NEEDED');
	} else {
		console.log('TEST1 FAIL: whale pushed no history record within 20s of turn end');
	}

	const t1 = Date.now();
	console.log('[T1] sending prompt 2 (ask_user_question) via whale dev-say...');
	const p2 = await req('POST', '/api/whale-assistant/dev-say', {
		sessionId: SID,
		text: '链路测试B：请使用 ask_user_question 工具问我一个问题："选哪个方案？"，选项：甲、乙。不要做别的。',
	}, cookie);
	console.log('[T1+' + (Date.now() - t1) + 'ms] dev-say response:', p2.status, p2.body.slice(0, 120));

	const qBase = (await state()).history.filter((h) => h.sessionId === SID && h.kind === 'question').length;
	let qRec = null, toolCallAt = 0;
	const qDeadline = t1 + 120000;
	while (Date.now() < qDeadline && !qRec) {
		await sleep(500);
		for (const f of (await events()).events) {
			const e = f.event || {};
			if (f.sessionId !== SID) continue;
			if (e.type === 'tool/call' && e.data && e.data.name === 'ask_user_question' && !toolCallAt) {
				toolCallAt = e.time || 0;
				console.log('[T1+' + (toolCallAt - t1) + 'ms] ask_user_question tool/call frame');
			}
		}
		const qs = (await state()).history.filter((h) => h.sessionId === SID && h.kind === 'question');
		if (qs.length > qBase) qRec = qs[qs.length - 1];
	}
	if (qRec) {
		console.log('[T1+' + (qRec.at - t1) + 'ms] whale question record: title=' + qRec.title);
		await sleep(4000);
		const qs2 = (await state()).history.filter((h) => h.sessionId === SID && h.kind === 'question' && h.at > t1 - 2000);
		console.log('question records since T1:', qs2.length);
		console.log(qs2.length === 1 ? 'TEST2 PASS' : 'TEST2 CHECK NEEDED (duplicates)');
	} else {
		console.log('TEST2 FAIL: no question record (toolCallAt=' + toolCallAt + ')');
	}
	console.log('NOTE: the test conversation is now WAITING on a question.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
