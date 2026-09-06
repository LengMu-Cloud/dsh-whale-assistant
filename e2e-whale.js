/**
 * End-to-end integration test: runs the REAL whale.js in a vm with REAL
 * WebSocket + REAL fetch against the live host, while a subagent runs.
 * Checks that the label fetch resolves and turn events are reported.
 * Usage: node e2e-whale.js   (spawn a subagent while it runs)
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'whale.js'), 'utf8');

function makeEl(tag) {
	const el = {
		tag, style: {}, title: '', children: [], offsetWidth: 88, offsetHeight: 88,
		textContent: '', _listeners: {}, classSet: new Set(),
		classList: {
			add: (c) => el.classSet.add(c),
			remove: (c) => el.classSet.delete(c),
			contains: (c) => el.classSet.has(c),
		},
		addEventListener(t, f) { (el._listeners[t] = el._listeners[t] || []).push(f); },
		_fire(t, e) { (el._listeners[t] || []).forEach((fn) => fn(e)); },
		appendChild(c) { el.children.push(c); c.parent = el; },
		removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
		querySelector(s) { return el.children.find((c) => c.tag === s) || null; },
		setPointerCapture() {},
	};
	Object.defineProperties(el, {
		offsetLeft: { get() { const v = parseInt(el.style.left, 10); return Number.isFinite(v) ? v : 0; } },
		offsetTop: { get() { const v = parseInt(el.style.top, 10); return Number.isFinite(v) ? v : 0; } },
	});
	return el;
}

const whale = makeEl('div');
const svgFig = makeEl('svg');
whale.appendChild(svgFig);
const body = makeEl('body');
const store = new Map();
const localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
};
let readyCb = null;
const document = {
	readyState: 'loading',
	body,
	addEventListener(t, f) { if (t === 'DOMContentLoaded') readyCb = f; },
	getElementById(id) { return id === 'dsh-whale' ? whale : null; },
	createElement: makeEl,
	querySelector(sel) {
		if (sel === '.dsh-whale-bubble') return whale.children.find((c) => c.className === 'dsh-whale-bubble') || null;
		return null;
	},
};

/* REAL WebSocket and REAL fetch (relative -> absolute like the browser) */
const browserFetch = (url, init) => fetch(new URL(url, 'http://127.0.0.1:3080'), init);

const sandbox = {
	window: null, document, localStorage, WebSocket,
	location: { protocol: 'http:', host: '127.0.0.1:3080' },
	setTimeout, clearTimeout, setInterval, clearInterval, console, Math, JSON, Map, Set, Date,
	performance, innerWidth: 1200, innerHeight: 800,
	matchMedia: () => ({ matches: false }),
	fetch: browserFetch,
	requestAnimationFrame(cb) { return setTimeout(() => cb(performance.now()), 16); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SCRIPT, sandbox, { filename: 'whale.js' });
readyCb();

const bubble = () => whale.children.find((c) => c.className === 'dsh-whale-bubble');

console.log('[e2e] whale running; sockets:', sandbox.__dshWhale.sockets.length);

/* watch the reports as they happen */
const origPush = null; /* nothing to hook; just poll */
setInterval(() => {
	const text = bubble() ? bubble().textContent : '';
	const subs = [...sandbox.__dshWhale.subagentSessions.entries()]
		.map(([id, info]) => id.slice(0, 8) + ':' + JSON.stringify(info));
	const queue = sandbox.__dshWhale.reportQueue().map((r) => r.text);
	console.log('[e2e] bubble:', JSON.stringify(text));
	console.log('[e2e] subagentSessions:', JSON.stringify(subs));
	console.log('[e2e] unread:', sandbox.__dshWhale.unreadCount(), 'queue:', JSON.stringify(queue));
	console.log('[e2e] turnTokens:', sandbox.__dshWhale.turnTokens(),
		'debug:', JSON.stringify(sandbox.__dshWhale.debugCounters));
	console.log('---');
}, 3000);

setTimeout(() => {
	console.log('[e2e] done');
	process.exit(0);
}, 60000);
