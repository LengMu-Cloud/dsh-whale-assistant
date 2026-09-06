/**
 * Mute verification: walks the REAL whale.js through the user's actual path —
 * 1. baseline: a finished task rings the bell
 * 2. right-click -> menu -> sound item -> muted
 * 3. a finished task no longer rings (notifications still show)
 * 4. mute persists across a reload (fresh script reading localStorage)
 * 5. unmuting restores the bell
 * Prints a PASS/FAIL report. Usage: node verify-mute.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'whale.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeAudioContext {
	static instances = [];
	constructor() {
		this.state = 'running';
		this.currentTime = 0;
		this.starts = [];
		FakeAudioContext.instances.push(this);
	}
	resume() { this.state = 'running'; return Promise.resolve(); }
	createOscillator() {
		const ctx = this;
		const osc = {
			type: 'sine',
			frequency: { value: 0 },
			connect() {},
			start() { ctx.starts.push(this.frequency.value); },
			stop() {},
		};
		return osc;
	}
	createGain() {
		return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
	}
	get destination() { return {}; }
}

function makeEnv(initStore) {
	function makeEl(tag) {
		const el = {
			tag, style: {}, title: '', children: [], offsetWidth: 88, offsetHeight: 88,
			_listeners: {}, classSet: new Set(),
			classList: {
				add: (c) => el.classSet.add(c),
				remove: (c) => el.classSet.delete(c),
				contains: (c) => el.classSet.has(c),
			},
			addEventListener(t, f) { (el._listeners[t] = el._listeners[t] || []).push(f); },
			_fire(t, e) { (el._listeners[t] || []).forEach((fn) => fn(e)); },
			appendChild(c) { el.children.push(c); c.parent = el; },
			removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
			contains(node) { return node === el || el.children.some((c) => c.contains && c.contains(node)); },
			querySelector(s) { return el.children.find((c) => c.tag === s) || null; },
			setPointerCapture() {},
		};
		Object.defineProperties(el, {
			offsetLeft: { get() { const v = parseInt(el.style.left, 10); return Number.isFinite(v) ? v : 0; } },
			offsetTop: { get() { const v = parseInt(el.style.top, 10); return Number.isFinite(v) ? v : 0; } },
			textContent: {
				get() { return (el._text || '') + el.children.map((c) => c.textContent || '').join(''); },
				set(v) { el._text = String(v); el.children.length = 0; },
			},
		});
		return el;
	}

	const whale = makeEl('div');
	const svgFig = makeEl('svg');
	svgFig.className = { baseVal: '' };
	const g1 = makeEl('g'); g1.id = 'dsh-whale-gear-helmet'; g1.style.display = 'none';
	const g2 = makeEl('g'); g2.id = 'dsh-whale-gear-coffee'; g2.style.display = 'none';
	svgFig.appendChild(g1);
	svgFig.appendChild(g2);
	whale.appendChild(svgFig);
	const body = makeEl('body');
	const store = new Map(initStore || []);
	const localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
	};
	let readyCb = null;
	const docListeners = {};
	const document = {
		readyState: 'loading',
		body,
		addEventListener(type, fn) {
			(docListeners[type] = docListeners[type] || []).push(fn);
			if (type === 'DOMContentLoaded') readyCb = fn;
		},
		_fire(type, event) { (docListeners[type] || []).forEach((fn) => fn(event)); },
		getElementById(id) {
			if (id === 'dsh-whale') return whale;
			if (id.indexOf('dsh-whale-gear-') === 0) return svgFig.children.find((c) => c.id === id) || null;
			return null;
		},
		createElement: makeEl,
		querySelector(sel) {
			if (sel === '.dsh-whale-bubble') return whale.children.find((c) => c.className === 'dsh-whale-bubble') || null;
			return null;
		},
	};
	const myAudioCtxs = [];
	class EnvAudioContext extends FakeAudioContext {
		constructor() { super(); myAudioCtxs.push(this); }
	}
	const rafQueue = [];
	const sandbox = {
		window: null, document, localStorage, WebSocket: class { constructor(url) { this.url = url; this._l = {}; } addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); } },
		AudioContext: EnvAudioContext,
		location: { protocol: 'http:', host: '127.0.0.1:3080' },
		setTimeout, clearTimeout, setInterval, clearInterval, console, Math, JSON, Map, Set, Date, performance,
		innerWidth: 1200, innerHeight: 800,
		matchMedia: () => ({ matches: false }),
		requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
		fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(SCRIPT, sandbox, { filename: 'whale.js' });
	readyCb();
	return {
		sandbox,
		whale,
		bubble: () => whale.children.find((c) => c.className === 'dsh-whale-bubble'),
		audioStarts: () => (myAudioCtxs.length ? myAudioCtxs[myAudioCtxs.length - 1].starts : []),
	};
}

const results = [];
function check(name, ok, detail) {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
	/* ---- session A: the user path on a fresh page ---- */
	const env = makeEnv();
	const W = env.sandbox.__dshWhale;
	const muxp = (p) => W.handleMuxPayload(p);

	/* 1. baseline: a finished task rings */
	muxp({ type: 'session/projection', sessionId: 'session-mt', key: 'subagentTiming', value: { settledMs: 0 } });
	muxp({ type: 'session/projection', sessionId: 'session-mt', key: 'title', value: '静音测试', seq: 1 });
	muxp({ type: 'session/event', sessionId: 'session-mt', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	await sleep(80);
	check('baseline: task completion rings the bell', env.audioStarts().length > 0,
		`${env.audioStarts().length} osc start(s)`);

	/* 2. right-click -> menu -> click the sound item */
	const rctx = (x, y) => ({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
	await sleep(450);
	env.whale._fire('contextmenu', rctx(100, 100));
	const menuOpen = W.ctxMenuOpen();
	const menuEl = env.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-menu');
	const soundItem = menuEl && menuEl.children.find((c) => c.className === 'dsh-whale-menu-item' && c.textContent.includes('声音'));
	check('right-click opens the menu with the sound item', menuOpen && !!soundItem,
		soundItem ? soundItem.textContent : 'no item');
	soundItem._fire('click', { stopPropagation() {} });
	check('sound item mutes (menu label flipped)', W.soundMuted() === true, 'muted=true');
	check('mute state persisted', env.sandbox.localStorage.getItem('dsh-whale:sound') === 'off',
		`dsh-whale:sound=${env.sandbox.localStorage.getItem('dsh-whale:sound')}`);
	await sleep(450);

	/* 3. a finished task while muted: NO ring, but the notification still shows */
	const before = env.audioStarts().length;
	muxp({ type: 'session/event', sessionId: 'session-mt', event: { type: 'turn/end', seq: 3, time: 2, data: {} } });
	await sleep(80);
	check('muted: task completion rings NOTHING', env.audioStarts().length === before,
		`${env.audioStarts().length - before} new osc start(s)`);
	check('muted: the bubble notification still appears', env.bubble().textContent.includes('完成了'),
		env.bubble().textContent.slice(0, 24) + '…');

	/* ---- session B: reload (fresh script, persisted 'off') ---- */
	const env2 = makeEnv([['dsh-whale:sound', 'off']]);
	check('reload: mute restored from localStorage', env2.sandbox.__dshWhale.soundMuted() === true, 'muted=true');
	env2.sandbox.__dshWhale.playDing('done');
	await sleep(60);
	check('reload: still silent', env2.audioStarts().length === 0, '0 osc starts');

	/* ---- unmute ---- */
	env2.sandbox.__dshWhale.setSoundMuted(false);
	env2.sandbox.__dshWhale.playDing('done');
	await sleep(60);
	check('unmute: bell works again', env2.audioStarts().length > 0, `${env2.audioStarts().length} osc start(s)`);
	check('unmute persisted', env2.sandbox.localStorage.getItem('dsh-whale:sound') === 'on', 'dsh-whale:sound=on');

	const failed = results.filter((r) => !r.ok);
	console.log('\n' + (failed.length === 0 ? 'ALL MUTE CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`));
	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error('VERIFY CRASHED:', e);
	process.exit(1);
});
