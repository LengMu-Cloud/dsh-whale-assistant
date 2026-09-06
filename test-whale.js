/**
 * Unit test for whale.js — runs the real script in a vm sandbox with a fake
 * DOM / WebSocket / localStorage / rAF, then feeds the whale's OWN mux socket
 * the frames the host would push, and drives the swim animation frame by frame.
 *
 * Notification model under test:
 * - sub-tasks (background jobs) NEVER notify (no bubble/unread/sound)
 * - spawned subagents (bare-UUID sessions) NEVER notify either: their
 *   turn/start + turn/end are sub-task activity and stay silent
 * - the main task (conversation turns on `session-`-prefixed ids) notifies:
 *   [title]开工了/完成了 + bell
 * - attention requests (approval/question) notify for ANY session:
 *   [title]需要你审核/回答 + chime (the user must act, even for subagents)
 * - sub-tasks only move workload/mood and feed the click summary
 * Usage: node test-whale.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'whale.js'), 'utf8');
const { performance } = require('perf_hooks');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fake AudioContext recording every started oscillator's frequency. */
class FakeAudioContext {
	static instances = [];
	constructor() {
		this.state = 'running';
		this.currentTime = 0;
		this.starts = [];
		this.resumeCalls = 0;
		FakeAudioContext.instances.push(this);
	}
	resume() {
		this.resumeCalls++;
		this.state = 'running';
		return Promise.resolve();
	}
	createOscillator() {
		const ctx = this;
		const osc = {
			type: 'sine',
			frequency: { value: 0 },
			connect() {},
			start() {
				ctx.starts.push(this.frequency.value);
			},
			stop() {},
		};
		return osc;
	}
	createGain() {
		return {
			gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
			connect() {},
		};
	}
	get destination() {
		return {};
	}
}

function makeEnv(initStore) {
	function makeEl(tag) {
		const el = {
			tag,
			style: {},
			title: '',
			dataset: {},
			children: [],
			offsetWidth: 88,
			offsetHeight: 88,
			_listeners: {},
			classSet: new Set(),
			classList: {
				add: (c) => el.classSet.add(c),
				remove: (c) => el.classSet.delete(c),
				contains: (c) => el.classSet.has(c),
				toggle: (c, force) => {
					if (force === undefined) {
						if (el.classSet.has(c)) { el.classSet.delete(c); return false; }
						el.classSet.add(c);
						return true;
					}
					if (force) el.classSet.add(c);
					else el.classSet.delete(c);
					return !!force;
				},
			},
			addEventListener(type, fn) {
				(el._listeners[type] = el._listeners[type] || []).push(fn);
			},
			_fire(type, event) {
				(el._listeners[type] || []).forEach((fn) => fn(event));
			},
			appendChild(child) {
				el.children.push(child);
				child.parent = el;
			},
			removeChild(child) {
				const at = el.children.indexOf(child);
				if (at >= 0) el.children.splice(at, 1);
			},
			contains(node) {
				if (node === el) return true;
				return el.children.some((c) => c.contains && c.contains(node));
			},
			querySelector(sel) {
				return el.children.find((c) => c.tag === sel) || null;
			},
			setPointerCapture() {},
		};
		/* mirror style.left/top into offsetLeft/offsetTop like the real DOM */
		Object.defineProperties(el, {
			offsetLeft: {
				get() {
					const v = parseInt(el.style.left, 10);
					return Number.isFinite(v) ? v : 0;
				},
			},
			offsetTop: {
				get() {
					const v = parseInt(el.style.top, 10);
					return Number.isFinite(v) ? v : 0;
				},
			},
			/* like the real DOM: setting textContent replaces ALL children,
			 * reading it concatenates own text + every descendant's */
			textContent: {
				get() {
					return (el._text || '') + el.children.map((c) => c.textContent || '').join('');
				},
				set(v) {
					el._text = String(v);
					el.children.length = 0;
				},
			},
		});
		return el;
	}

	const whale = makeEl('div');
	const svgFig = makeEl('svg');
	/* real DOM: an SVG element's className is SVGAnimatedString (an object
	 * without indexOf) — any code walking whale.children must handle that */
	svgFig.className = { baseVal: '' };
	/* gear groups live inside the whale SVG (like whale-logo.svg) */
	const gearHelmet = makeEl('g');
	gearHelmet.id = 'dsh-whale-gear-helmet';
	gearHelmet.style.display = 'none';
	const gearCoffee = makeEl('g');
	gearCoffee.id = 'dsh-whale-gear-coffee';
	gearCoffee.style.display = 'none';
	svgFig.appendChild(gearHelmet);
	svgFig.appendChild(gearCoffee);
	whale.appendChild(svgFig); /* inline whale logo, as in the real page */
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
		/* minimal root so applyPressureHue can drive the CSS variable */
		documentElement: {
			style: {
				_props: {},
				setProperty(k, v) { this._props[k] = String(v); },
			},
		},
		addEventListener(type, fn) {
			(docListeners[type] = docListeners[type] || []).push(fn);
			if (type === 'DOMContentLoaded') readyCb = fn;
		},
		_fire(type, event) {
			(docListeners[type] || []).forEach((fn) => fn(event));
		},
		getElementById(id) {
			if (id === 'dsh-whale') return whale;
			if (id.indexOf('dsh-whale-gear-') === 0) {
				return svgFig.children.find((c) => c.id === id) || null;
			}
			return null;
		},
		createElement(tag) {
			return makeEl(tag);
		},
		createTextNode(text) {
			const t = makeEl('#text');
			t._text = String(text);
			return t;
		},
		getElementsByTagName(tag) {
			const out = [];
			const walk = (n) => (n.children || []).forEach((c) => {
				if ((c.tag || '').toLowerCase() === String(tag).toLowerCase()) out.push(c);
				walk(c);
			});
			walk(body);
			return out;
		},
		querySelector(sel) {
			if (sel === '.dsh-whale-bubble') {
				return whale.children.find((c) => c.className === 'dsh-whale-bubble') || null;
			}
			return null;
		},
	};

	class FakeWebSocket {
		static CONNECTING = 0;
		static OPEN = 1;
		static CLOSING = 2;
		static CLOSED = 3;
		constructor(url) {
			this.url = url;
			this.readyState = FakeWebSocket.OPEN;
			this._listeners = {};
		}
		addEventListener(type, fn) {
			(this._listeners[type] = this._listeners[type] || []).push(fn);
		}
		_emit(type, event) {
			(this._listeners[type] || []).forEach((fn) => fn(event));
		}
	}

	let rafQueue = [];
	let fetchStub = null;
	/* env-scoped AudioContext: every env records into its own instance list,
	 * so a silent env never sees another env's rings */
	const myAudioCtxs = [];
	class EnvAudioContext extends FakeAudioContext {
		constructor() {
			super();
			myAudioCtxs.push(this);
		}
	}
	const sandbox = {
		window: null,
		document,
		localStorage,
		WebSocket: FakeWebSocket,
		AudioContext: EnvAudioContext,
		location: { protocol: 'http:', host: '127.0.0.1:3080' },
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		console,
		Math,
		JSON,
		Map,
		Set,
		Date,
		performance,
		innerWidth: 1200,
		innerHeight: 800,
		matchMedia: () => ({ matches: false }),
		CSS: { supports: () => false }, /* no color-mix: exercise the JS fallback */
		requestAnimationFrame(cb) {
			rafQueue.push(cb);
			return rafQueue.length;
		},
		fetch(url, init) {
			if (fetchStub) return fetchStub(url, init);
			return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
		},
	};
	sandbox.window = sandbox;

	vm.createContext(sandbox);
	vm.runInContext(SCRIPT, sandbox, { filename: 'whale.js' });

	const bubble = () => whale.children.find((c) => c.className === 'dsh-whale-bubble');
	const badge = () => whale.children.find((c) => c.className === 'dsh-whale-badge');
	const socket = () => sandbox.__dshWhale.sockets[0];
	const rippleLayer = () => body.children.find((c) => c.className === 'dsh-whale-ripple-layer') || null;

	return {
		sandbox,
		whale,
		svgFig,
		bubble,
		badge,
		socket,
		rippleLayer,
		audioStarts: () => (myAudioCtxs.length ? myAudioCtxs[myAudioCtxs.length - 1].starts : []),
		audioCtxs: () => myAudioCtxs,
		ready: () => readyCb && readyCb(),
		docFire: (type, event) => document._fire(type, event),
		docListeners: (type) => docListeners[type] || [],
		stepRaf: (ts) => {
			const queue = rafQueue;
			rafQueue = [];
			for (const cb of queue) cb(ts);
		},
		rafPending: () => rafQueue.length > 0,
		setFetch: (fn) => {
			fetchStub = fn;
		},
		mux(env) {
			socket()._emit('message', { data: JSON.stringify(env) });
		},
		frame(payload) {
			this.mux({ rpcId: 'test', payload });
		},
	};
}

async function main() {
	const t = performance.now();

	/* ---- env 1: full lifecycle ---- */
	const env = makeEnv();
	env.ready();
	const { whale, svgFig, bubble, badge, socket } = env;

	/* 1. mux socket connects and reports the live channel */
	assert.ok(socket(), 'own mux socket created');
	assert.ok(String(socket().url).includes('/api/events.mux'), 'mux url correct');
	socket()._emit('open', {});
	assert.ok(bubble().textContent.includes('通道已连接'), `connected notice: ${bubble().textContent}`);

	/* 2. baseline jobs are silent */
	env.frame({ type: 'session/subscribed', sessionId: 's1', lastSeq: 0 });
	env.frame({
		type: 'session/jobs',
		sessionId: 's1',
		jobs: [
			{ id: 'pwsh-1', kind: 'pwsh', label: 'old job', status: 'completed', startedAt: 1, finishedAt: 2 },
		],
	});
	assert.ok(!bubble().textContent.includes('old job'), 'baseline jobs stay silent');

	/* 3. sub-tasks NEVER notify: no bubble, no badge, no sound */
	env.frame({
		type: 'session/jobs',
		sessionId: 's1',
		jobs: [
			{ id: 'bash-1', kind: 'bash', label: 'git push', status: 'running', startedAt: 3 },
		],
	});
	assert.ok(!bubble().textContent.includes('开工了'), 'sub-task start not announced');
	assert.ok(!bubble().textContent.includes('Git 推送'), 'no sub-task text in the bubble');
	assert.strictEqual(badge().style.display, 'none', 'no badge for sub-tasks');
	env.frame({
		type: 'session/jobs',
		sessionId: 's1',
		jobs: [
			{ id: 'bash-1', kind: 'bash', label: 'git push', status: 'completed', startedAt: 3, finishedAt: 4 },
		],
	});
	assert.ok(!bubble().textContent.includes('完成了'), 'sub-task completion not announced');
	env.frame({
		type: 'session/jobs',
		sessionId: 's1',
		jobs: [
			{ id: 'bash-2', kind: 'bash', label: 'npm build', status: 'completed', startedAt: 5, finishedAt: 6, detail: 'exit code: 1' },
		],
	});
	assert.ok(!bubble().textContent.includes('失败了'), 'sub-task failure not announced');
	/* keep one sub-task running so the click summary has something to show */
	env.frame({
		type: 'session/jobs',
		sessionId: 's1',
		jobs: [
			{ id: 'bash-3', kind: 'bash', label: 'npm run dev', status: 'running', startedAt: 7 },
		],
	});
	assert.strictEqual(env.sandbox.__dshWhale.unreadCount(), 0, 'no unread from sub-tasks');

	/* 4. the main task (conversation turn) DOES notify, with the bell */
	const muxp = env.sandbox.__dshWhale.handleMuxPayload;
	env.setFetch(() => Promise.resolve({
		ok: true,
		json: () => Promise.resolve({
			rpcId: 'x',
			result: {
				ok: true,
				value: {
					events: [],
					hasMore: false,
					projections: { asOfSeq: 1, values: { title: '小鲸鱼UI插件设计' } },
				},
			},
		}),
	}));
	muxp({ type: 'session/projection', sessionId: 'session-mt1', key: 'subagentTiming', value: { settledMs: 0 } });
	await sleep(30); /* label/title fetch settles */
	muxp({ type: 'session/event', sessionId: 'session-mt1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	assert.ok(bubble().textContent.includes('[小鲸鱼UI插件设计]开工了'), `main task start: ${bubble().textContent}`);
	assert.ok(badge().textContent === '' || badge().style.display === 'none', 'start does NOT count into the badge (user request)');
	muxp({ type: 'session/event', sessionId: 'session-mt1', event: { type: 'turn/end', seq: 5, time: 1, data: {} } });
	assert.ok(bubble().textContent.includes('[小鲸鱼UI插件设计]完成了'), `main task end: ${bubble().textContent}`);
	assert.strictEqual(badge().textContent, '1', 'badge 1 after main task end');
	assert.deepStrictEqual(env.audioStarts().map(Math.round), [1319, 2638], 'turn/end plays the single ding (default scheme)');

	/* 5. click reads one unread report (newest first); the item being shown
	 * still counts in the badge until it is dismissed */
	const pt = (id, x, y) => ({ pointerId: id, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
	const click = async () => {
		whale._fire('pointerdown', pt(1, 100, 100));
		whale._fire('pointerup', pt(1, 100, 100));
		await sleep(320);
	};
	await click();
	assert.ok(bubble().textContent.includes('[小鲸鱼UI插件设计]完成了'), `read #1 (newest): ${bubble().textContent}`);
	assert.strictEqual(badge().textContent, '1', 'badge keeps counting the item being read');
	env.sandbox.__dshWhale._dismissBubble();
	assert.strictEqual(badge().style.display, 'none', 'badge gone after reading all');
	await click();
	assert.ok(bubble().textContent.includes('任务进行中'), `click summary after queue empty: ${bubble().textContent}`);
	/* the status panel follows EVERY click interaction (not just reads):
	 * here there is no token data yet, so the panel is never created —
	 * verify the click path does not throw without data */
	const statusEl1 = () => env.whale.children.find((c) => c.className === 'dsh-whale-status');
	assert.ok(!statusEl1() || !statusEl1().textContent.includes('消耗'), 'no token line without data (ok)');

	/* 6. drag moves the whale and persists position */
	whale._fire('pointerdown', pt(2, 100, 100));
	whale._fire('pointermove', pt(2, 180, 140));
	whale._fire('pointerup', pt(2, 180, 140));
	assert.strictEqual(whale.style.left, '80px', 'dragged left');
	assert.strictEqual(whale.style.top, '40px', 'dragged top');
	assert.strictEqual(whale.style.right, 'auto', 'right cleared after drag');
	const saved = JSON.parse(env.sandbox.localStorage.getItem('dsh-whale:pos'));
	assert.deepStrictEqual(saved, { v: 1, data: { x: 80, y: 40 } }, 'position persisted (v1 envelope)');

	/* 7. double-click swims back to the corner: directional, with ripples */
	whale._fire('dblclick', {});
	const swimState = () => env.sandbox.__dshWhale.swimState();
	assert.ok(swimState(), 'swim started');
	assert.ok(whale.classList.contains('dsh-whale-swimming'), 'swimming class on');
	let ts = swimState().start;
	let midChecked = false;
	let guard = 0;
	while (swimState() && guard++ < 5000) {
		ts += 16;
		env.stepRaf(ts);
		if (!midChecked && guard > 20) {
			midChecked = true;
			assert.ok(svgFig.style.transform.includes('scaleX(-1)'), 'figure mirrored while swimming');
			assert.ok(svgFig.style.transform.includes('rotate('), 'figure has a heading');
			assert.ok(env.rippleLayer() && env.rippleLayer().children.length > 0, 'ripple trail spawned');
		}
	}
	assert.ok(guard < 5000, 'swim finished in bounded frames');
	assert.strictEqual(whale.style.left, '1094px', 'swam to corner x (1200-88-18)');
	assert.strictEqual(whale.style.top, '694px', 'swam to corner y (800-88-18)');
	assert.ok(!whale.classList.contains('dsh-whale-swimming'), 'swimming class removed at arrival');
	assert.strictEqual(env.sandbox.localStorage.getItem('dsh-whale:pos'), null, 'pos cleared');
	assert.ok(bubble().textContent.includes('游回角落'), `arrival msg: ${bubble().textContent}`);
	let splashGuard = 0;
	while (env.rafPending() && splashGuard++ < 40) {
		ts += 16;
		env.stepRaf(ts);
	}
	const rings = env.rippleLayer().children.filter((c) => c.className === 'dsh-whale-waterring');
	const jets = env.rippleLayer().children.filter((c) => c.className === 'dsh-whale-jet');
	const sprays = env.rippleLayer().children.filter((c) => c.className === 'dsh-whale-spray');
	assert.ok(rings.length > 0, 'elliptical water rings spawned');
	assert.ok(jets.length > 0, 'water jets spawned');
	assert.ok(sprays.length > 0, 'spray droplets spawned');
	assert.ok(rings[0].style.opacity !== '0', 'rings animate (opacity set)');
	assert.ok(rings[0].style.transform.includes('scaleX'), 'rings expand elliptically');
	assert.ok(jets[0].style.transform.includes('translateX'), 'jets shoot outward');
	assert.ok(sprays[0].style.transform.includes('translate('), 'spray arcs');

	/* 8. grabbing the whale mid-swim gives catch feedback */
	whale._fire('pointerdown', pt(3, 300, 300));
	whale._fire('pointermove', pt(3, 200, 200));
	whale._fire('pointerup', pt(3, 200, 200));
	assert.strictEqual(whale.style.left, '994px', 'moved away for catch test (1094-100)');
	assert.strictEqual(whale.style.top, '594px', 'moved away for catch test (694-100)');
	whale._fire('dblclick', {});
	assert.ok(swimState(), 'swim restarted');
	ts = swimState().start;
	let catchGuard = 0;
	while (swimState() && catchGuard++ < 10) {
		ts += 16;
		env.stepRaf(ts);
	}
	assert.ok(swimState(), 'swim still in flight when grabbed');
	whale._fire('pointerdown', pt(4, 300, 300));
	assert.ok(!swimState(), 'swim cancelled by the grab');
	assert.ok(
		env.sandbox.__dshWhale.catchLines.includes(bubble().textContent) ||
		env.sandbox.__dshWhale.tiredCatch.includes(bubble().textContent),
		`catch line shown: ${bubble().textContent}`
	);
	const grabbedX = parseInt(whale.style.left, 10);
	whale._fire('pointerup', pt(4, 300, 300));
	await sleep(350);
	assert.ok(
		env.sandbox.__dshWhale.catchLines.includes(bubble().textContent) ||
		env.sandbox.__dshWhale.tiredCatch.includes(bubble().textContent),
		`catch bubble persists (not overwritten): ${bubble().textContent}`
	);
	whale._fire('pointerdown', pt(5, 300, 300));
	whale._fire('pointermove', pt(5, 200, 250));
	whale._fire('pointerup', pt(5, 200, 250));
	assert.strictEqual(parseInt(whale.style.left, 10), grabbedX - 100, 'draggable after catch');

	/* 9. session/subscribed resets that session's job mirror */
	env.frame({
		type: 'session/jobs',
		sessionId: 's2',
		jobs: [
			{ id: 'sub-1', kind: 'subagent', label: 'research', status: 'running', startedAt: 10 },
		],
	});
	assert.strictEqual(env.sandbox.__dshWhale.known.size >= 2, true, 'jobs tracked internally');
	env.frame({ type: 'session/subscribed', sessionId: 's2', lastSeq: 0 });
	assert.strictEqual(env.sandbox.__dshWhale.known.size, 4, 'session reset clears its job mirror (s1 keeps 4)');

	/* 10. sub-task job frames only move the workload (班味), never notify */
	const mood0 = env.sandbox.__dshWhale.mood();
	env.frame({
		type: 'session/jobs',
		sessionId: 's3',
		jobs: [
			{ id: 'm-1', kind: 'bash', label: 'git status', status: 'running', startedAt: 20 },
			{ id: 'm-2', kind: 'bash', label: 'git log', status: 'completed', startedAt: 21, finishedAt: 22, detail: 'exit code: 1' },
		],
	});
	assert.ok(env.sandbox.__dshWhale.workLoad() > env.sandbox.__dshWhale.workLoad() - 3, 'workload moves');
	assert.strictEqual(env.sandbox.__dshWhale.unreadCount(), 0, 'still no unread from sub-tasks');

	/* 11. first message of a brand-new conversation: the LLM title arrives
	 * seconds later; the start report waits for it, and a late title also
	 * rewrites already-spoken fallback reports */
	const envNew = makeEnv();
	envNew.ready();
	const N = envNew.sandbox.__dshWhale;
	const muxpNew = (payload) => N.handleMuxPayload(payload);
	envNew.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })); /* no label, no title yet */
	N._setHoldMs(400); /* simulate the (shortened) title wait */
	muxpNew({ type: 'session/projection', sessionId: 'session-sn1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpNew({ type: 'session/event', sessionId: 'session-sn1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	assert.ok(!envNew.bubble().textContent.includes('sn1'), 'start report held for the title');
	await sleep(120);
	muxpNew({ type: 'session/projection', sessionId: 'session-sn1', key: 'title', value: '帮我做一个VS Code插件', seq: 2 });
	await sleep(50);
	assert.ok(envNew.bubble().textContent.includes('[帮我做一个VS Code插件]开工了'),
		`title captured while held: ${envNew.bubble().textContent}`);
	/* late title after the fallback was already spoken gets corrected in place */
	N._setHoldMs(150);
	muxpNew({ type: 'session/projection', sessionId: 'session-sn2', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpNew({ type: 'session/event', sessionId: 'session-sn2', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	await sleep(250); /* held 150ms -> falls back */
	assert.ok(envNew.bubble().textContent.includes('未命名任务'), 'sn2 start fell back while title unknown');
	muxpNew({ type: 'session/projection', sessionId: 'session-sn2', key: 'title', value: '帮我做一个VS Code插件（改名）', seq: 2 });
	await sleep(30);
	assert.ok(envNew.bubble().textContent.includes('（改名）'), `visible bubble corrected: ${envNew.bubble().textContent}`);
	/* the start report no longer enters the queue (不进红标): nothing to
	 * rewrite there — only the live bubble gets the late title */
	assert.strictEqual(N.reportQueue().filter((r) => r.sessionId === 'session-sn2').length, 0, 'start stays out of the unread queue');
	N._setHoldMs(null);

	/* 12. attention frames: distinctive chime; the bracket names the
	 * conversation (its title); unknown titles stay on the neutral
	 * 未命名任务 placeholder (question/reason text no longer impersonates
	 * the name — it read as a lost name and polluted history titles, 09-05).
	 * NOTE: sb/sc/sd use bare-UUID ids on purpose — attention requests
	 * notify for ANY session, including spawned subagents (the user must
	 * approve/answer them). */
	const envAtt = makeEnv();
	envAtt.ready();
	const A = envAtt.sandbox.__dshWhale;
	const roundedAtt = () => envAtt.audioStarts().map(Math.round);
	A.handleMuxPayload({ type: 'session/projection', sessionId: 'session-sa', key: 'title', value: '小鲸鱼UI插件设计', seq: 1 });
	envAtt.audioStarts().length = 0;
	A._resetDing();
	A.handleMuxPayload({ type: 'approval/requested', sessionId: 'session-sa', approvalId: 'app-1', toolName: 'pwsh', reason: '需要危险权限写入桌面文件' });
	assert.deepStrictEqual(roundedAtt(), [784, 1046], 'attention sound: soft rising pair (chime scheme)');
	assert.ok(envAtt.bubble().textContent.includes('[小鲸鱼UI插件设计]需要你审核'), `approval names the conversation: ${envAtt.bubble().textContent}`);
	assert.strictEqual(A.unreadCount(), 1, 'approval counts as unread');
	A._resetDing();
	envAtt.audioStarts().length = 0;
	A.handleMuxPayload({ type: 'question/requested', sessionId: 'session-sa', questions: [{ id: 'q1', question: '提示音要选哪种风格？', header: '测试' }] });
	assert.deepStrictEqual(roundedAtt(), [784, 1046], 'question also chimes');
	assert.ok(envAtt.bubble().textContent.includes('[小鲸鱼UI插件设计]需要你选择'), `question names the conversation: ${envAtt.bubble().textContent}`);
	assert.strictEqual(A.unreadCount(), 2, 'question counts as unread');
	assert.ok(!envAtt.whale.children.some((c) => c.className === 'dsh-whale-status'),
		'attention shows NO token panel — usage waits for completion (09-05 用户反馈)');
	/* unknown conversation: neutral 未命名任务 placeholder (09-05 用户报告:
	 * question/reason text used to stand in and pollute history titles) */
	A.handleMuxPayload({ type: 'approval/requested', sessionId: 'sb', approvalId: 'app-2', toolName: 'bash' });
	await sleep(60);
	assert.ok(envAtt.bubble().textContent.includes('[未命名任务]需要你审核'), `approval without a known title: ${envAtt.bubble().textContent}`);
	A.handleMuxPayload({ type: 'question/requested', sessionId: 'sc', questions: [{ id: 'q2', question: '换个声音？' }] });
	await sleep(60);
	assert.ok(envAtt.bubble().textContent.includes('[未命名任务]需要你选择'), `question without a known title: ${envAtt.bubble().textContent}`);
	assert.ok(!envAtt.bubble().textContent.includes('换个声音'), 'question text never surfaces in the bubble');
	/* late title: the 未命名任务 placeholder self-corrects EVERYWHERE once
	 * the LLM name arrives — live bubble, queued unread, history row */
	A.handleMuxPayload({ type: 'session/projection', sessionId: 'sc', key: 'title', value: '真的对话名', seq: 9 });
	await sleep(30);
	assert.ok(envAtt.bubble().textContent.includes('[真的对话名]需要你选择'), `live bubble corrected: ${envAtt.bubble().textContent}`);
	const scRep = A.reportQueue().filter((r) => r.sessionId === 'sc')[0];
	assert.ok(scRep && scRep.text.indexOf('真的对话名') >= 0, `queued unread corrected: ${scRep && scRep.text}`);
	const scHist = A.historyList().filter((h) => h.sessionId === 'sc')[0];
	assert.ok(scHist && scHist.title === '真的对话名', `history row corrected (was 未命名任务): ${scHist && scHist.title}`);
	/* reading an attention report from the red badge replays TEXT ONLY —
	 * no token panel (09-06 用户反馈: the read path resurrected the panel
	 * that the auto-popup no longer shows) */
	envAtt.whale._fire('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envAtt.whale._fire('pointerup', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.ok(!envAtt.whale.children.some((c) => c.className === 'dsh-whale-status' && c.classList.contains('show')),
		'read-back of an attention report shows NO token panel');
	assert.ok(envAtt.bubble().textContent.includes('需要你选择'), `read-back replays the attention text: ${envAtt.bubble().textContent}`);
	/* rc.1 real channel (09-06 真机注测①): titles arrive as session/title
	 * EVENTS on the polled stream — ctx.sessionProjections.onChanged never
	 * fires on this DSH build (0 projection frames all boot). The event must
	 * translate into the same projection rewrite (bubble/unread/history). */
	A.handleMuxPayload({ type: 'question/requested', sessionId: 'sce', questions: [{ id: 'q2e', question: '事件流提问' }] });
	await sleep(60);
	assert.ok(envAtt.bubble().textContent.includes('[未命名任务]需要你选择'), 'event-path question starts unnamed');
	A._feedEventFrame({ sessionId: 'sce', seq: 500, time: Date.now(), event: { type: 'session/title', data: { title: '事件流真名', messageSeqs: [7] } } });
	await sleep(30);
	assert.ok(envAtt.bubble().textContent.includes('[事件流真名]需要你选择'), `session/title event rewrites the bubble: ${envAtt.bubble().textContent}`);
	const sceRep = A.reportQueue().filter((r) => r.sessionId === 'sce')[0];
	assert.ok(sceRep && sceRep.text.indexOf('事件流真名') >= 0, `session/title event rewrites the unread row: ${sceRep && sceRep.text}`);
	const sceHist = A.historyList().filter((h) => h.sessionId === 'sce')[0];
	assert.ok(sceHist && sceHist.title === '事件流真名', `session/title event rewrites history: ${sceHist && sceHist.title}`);
	/* on-demand: the title is fetched from history when the page just loaded */
	envAtt.setFetch(() => Promise.resolve({
		ok: true,
		json: () => Promise.resolve({
			rpcId: 'x',
			result: {
				ok: true,
				value: {
					events: [],
					hasMore: false,
					projections: { asOfSeq: 1, values: { title: '分析AI_Software目录' } },
				},
			},
		}),
	}));
	A.handleMuxPayload({ type: 'question/requested', sessionId: 'sd', questions: [{ id: 'q3', question: '选一个方案' }] });
	await sleep(60);
	assert.ok(envAtt.bubble().textContent.includes('[分析AI_Software目录]需要你选择'), `on-demand title fetch: ${envAtt.bubble().textContent}`);

	/* 13. 班味: workload builds gradually across mood stages, completions relieve */
	const envMood = makeEnv();
	envMood.ready();
	const W = envMood.sandbox.__dshWhale;
	assert.strictEqual(W.mood(), 'fresh', 'starts fresh');
	W.bumpWork(4);
	assert.strictEqual(W.mood(), 'warm', '4 -> warm');
	W.bumpWork(5);
	assert.strictEqual(W.mood(), 'tired', '9 -> tired');
	W.bumpWork(7);
	assert.strictEqual(W.mood(), 'burnt', '16 -> burnt');
	W.bumpWork(-7);
	assert.strictEqual(W.mood(), 'tired', 'relief moves back gradually');
	assert.strictEqual(W.workLoad(), 9, 'workload tracked');
	/* mood-flavored idle lines join the pool without replacing it entirely */
	const moodPool = Object.values(W.moodLines).flat();
	const idlePool = [...W.idleLines, ...moodPool];
	let moodLineSeen = false;
	for (let i = 0; i < 40; i++) {
		const line = W.pickIdleLine();
		assert.ok(idlePool.includes(line), `idle line from pool: ${line}`);
		if (moodPool.includes(line)) moodLineSeen = true;
	}
	assert.ok(moodLineSeen, 'mood lines appear once tired');
	W.bumpWork(7); /* back to burnt (9 + 7 = 16) */
	assert.strictEqual(W.mood(), 'burnt', 'burnt again');
	/* workload also moves via real sub-task frames (start +1, complete -0.5) */
	const loadBefore = W.workLoad();
	envMood.frame({
		type: 'session/jobs',
		sessionId: 's9',
		jobs: [
			{ id: 'bash-90', kind: 'bash', label: 'git add', status: 'running', startedAt: 50 },
			{ id: 'bash-91', kind: 'bash', label: 'git commit', status: 'completed', startedAt: 51, finishedAt: 52 },
		],
	});
	assert.strictEqual(W.workLoad(), loadBefore + 0.5, 'frames bump workload (start +1, complete -0.5)');
	assert.strictEqual(W.unreadCount(), 0, 'sub-task frames never notify');

	/* 14. exit-code failures classify as tiring (+1 start, +1 fail), no notice */
	const envFail = makeEnv();
	envFail.ready();
	const F = envFail.sandbox.__dshWhale;
	const load0 = F.workLoad();
	envFail.frame({
		type: 'session/jobs',
		sessionId: 's11',
		jobs: [
			{ id: 'pwsh-x1', kind: 'pwsh', label: 'Start-Sleep -Seconds 2; Write-Error "boom"; exit 1', status: 'running', startedAt: 1 },
		],
	});
	envFail.frame({
		type: 'session/jobs',
		sessionId: 's11',
		jobs: [
			{ id: 'pwsh-x1', kind: 'pwsh', label: 'Start-Sleep -Seconds 2; Write-Error "boom"; exit 1', status: 'completed', startedAt: 1, finishedAt: 2, detail: 'exit code: 1' },
		],
	});
	assert.strictEqual(F.workLoad(), load0 + 2, 'failure counts as tiring (+1 start, +1 fail)');
	assert.strictEqual(F.unreadCount(), 0, 'failure never notifies');

	/* 15. completion ding: synthesized tones, queued sequentially */
	const envDing = makeEnv();
	envDing.ready();
	const D = envDing.sandbox.__dshWhale;
	const rounded = () => envDing.audioStarts().map(Math.round);
	envDing.audioStarts().length = 0;
	D.playDing('done');
	assert.deepStrictEqual(rounded(), [1319, 2638], 'done ding: single strike (default scheme)');
	D.playDing('done');
	assert.strictEqual(envDing.audioStarts().length, 2, 'second ding queued, not overlapping');
	D._resetDing(); /* the queued ding never renders */
	D.playDing('fail');
	assert.deepStrictEqual(rounded().slice(2), [550, 415], 'fail ding: dull descending pair');
	/* sequential playback: a second ding still plays, after the first finished */
	D._resetDing();
	envDing.audioStarts().length = 0;
	D.playDing('done');
	D.playDing('fail');
	assert.deepStrictEqual(rounded(), [1319, 2638], 'first ding plays immediately');
	await sleep(2000); /* DING_GAP_MS 1900: the queued ding fires after the full decay */
	assert.deepStrictEqual(rounded().slice(2), [550, 415], 'second ding plays after the first finished');

	/* 16. the unread counter keeps accumulating (no small cap) */
	const envCap = makeEnv();
	envCap.ready();
	const C = envCap.sandbox.__dshWhale;
	const muxpCap = (payload) => C.handleMuxPayload(payload);
	muxpCap({ type: 'session/projection', sessionId: 'session-cap1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpCap({ type: 'session/projection', sessionId: 'session-cap1', key: 'title', value: '批量任务', seq: 1 });
	for (let i = 0; i < 105; i++) {
		muxpCap({ type: 'session/event', sessionId: 'session-cap1', event: { type: 'turn/end', seq: i + 1, time: i, data: {} } });
	}
	assert.strictEqual(C.unreadCount(), 105, 'count grows beyond 99 (end reports queue; starts stay out)');
	assert.strictEqual(envCap.badge().textContent, '99+', 'badge display caps at 99+');

	/* 17. main task turn/end plays the bell even with a long conversation title */
	const envLong = makeEnv();
	envLong.ready();
	const L = envLong.sandbox.__dshWhale;
	const muxpLong = (payload) => L.handleMuxPayload(payload);
	const LONG_TITLE = '独一无二的超长子代理任务描述，这段内容包含了许多不同的词语和句子来确保字符串每个部分都是唯一的，不会出现重复片段，同时这也是为了验证截断逻辑的可靠性，确保通知气泡里的消息保持紧凑且超出部分被省略号优雅截断' + '【尾部特殊标记XYZ987】';
	muxpLong({ type: 'session/projection', sessionId: 'session-lt1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpLong({ type: 'session/projection', sessionId: 'session-lt1', key: 'title', value: LONG_TITLE, seq: 1 });
	muxpLong({ type: 'session/event', sessionId: 'session-lt1', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	const longMsg = envLong.bubble().textContent;
	assert.ok(longMsg.includes('…'), 'long title ellipsized');
	assert.ok(longMsg.length < 64, `message stays compact (${longMsg.length} chars)`);
	assert.ok(!longMsg.includes('【尾部特殊标记XYZ987】'), 'title tail not shown');
	assert.ok(longMsg.includes('完成了'), 'turn/end reported');

	/* 18. badge interactions: single click reads one, double-click clears all;
	 * right-click is reserved (context menu prevented, placeholder bubble) */
	const envBadge = makeEnv();
	envBadge.ready();
	const B = envBadge.sandbox.__dshWhale;
	const muxpBadge = (payload) => B.handleMuxPayload(payload);
	muxpBadge({ type: 'session/projection', sessionId: 'session-bg1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpBadge({ type: 'session/projection', sessionId: 'session-bg1', key: 'title', value: '徽标测试', seq: 1 });
	for (let i = 0; i < 3; i++) {
		muxpBadge({ type: 'session/event', sessionId: 'session-bg1', event: { type: 'turn/end', seq: i + 1, time: i, data: {} } });
	}
	assert.strictEqual(B.unreadCount(), 3, 'three unread reports (end reports; starts stay out)');
	const badgeEl = envBadge.badge();
	const stop = () => ({ stopPropagation() {} });
	/* single click on the badge reads one (queue 2 + reading 1 = 3) */
	badgeEl._fire('pointerdown', stop());
	badgeEl._fire('pointerup', stop());
	await sleep(320);
	assert.strictEqual(B.unreadCount(), 3, 'single badge click reads one (still counting the read item)');
	envBadge.sandbox.__dshWhale._dismissBubble();
	assert.strictEqual(B.unreadCount(), 2, 'after dismissing, 2 remain');
	/* double-click on the badge clears everything at once */
	const beforeClear = B.unreadCount();
	badgeEl._fire('dblclick', stop());
	assert.strictEqual(B.unreadCount(), 0, 'double-click clears all unread');
	assert.strictEqual(envBadge.badge().style.display, 'none', 'badge hidden after clear');
	/* clear feedback (#10): faint note WITH the count, not a bubble */
	const noteEl = envBadge.whale.children.find((c) => (c.className || '') === 'dsh-whale-note');
	assert.ok(noteEl, 'clear note element exists');
	assert.ok(noteEl && noteEl.textContent.includes('已清空 ' + beforeClear + ' 条通知'),
		`clear note shows the count: ${noteEl && noteEl.textContent}`);
	/* badge clicks never drag the whale */
	const beforeLeft = envBadge.whale.style.left;
	badgeEl._fire('pointerdown', stop());
	assert.strictEqual(envBadge.whale.style.left, beforeLeft, 'badge pointerdown does not move the whale');
	/* right-click is reserved for the menu: silent bubble, context menu
	 * prevented (the menu itself is covered by group 35) */
	let prevented = false;
	envBadge.whale._fire('contextmenu', { preventDefault() { prevented = true; }, stopPropagation() {} });
	assert.ok(prevented, 'context menu prevented on right-click');
	const beforeRight = envBadge.bubble().textContent;
	envBadge.whale._fire('pointerdown', { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
	envBadge.whale._fire('pointerup', { pointerId: 9, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.strictEqual(envBadge.bubble().textContent, beforeRight, 'right-click produces no interaction bubble');
	/* 18c. badge: right-click NEVER reads (menu-only; it used to pop a
	 * report on top of the right-click menu — 09-05 用户报告), left reads */
	const envBd = makeEnv();
	envBd.ready();
	const BD = envBd.sandbox.__dshWhale;
	envBd.setFetch(() => Promise.resolve({
		ok: true,
		json: () => Promise.resolve({ rpcId: 'x', result: { ok: true, value: { events: [], hasMore: false, projections: { asOfSeq: 1, values: { title: '红标右键测试' } } } } }),
	}));
	BD.handleMuxPayload({ type: 'session/projection', sessionId: 'session-bd', key: 'subagentTiming', value: { settledMs: 0 } });
	await sleep(30);
	BD.handleMuxPayload({ type: 'session/event', sessionId: 'session-bd', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	BD.handleMuxPayload({ type: 'session/event', sessionId: 'session-bd', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	await sleep(60);
	BD._dismissBubble(); /* hide the auto bubble: clean canvas */
	const bdBefore = BD.unreadCount();
	assert.ok(bdBefore >= 1, 'badge right-click test: an unread is queued');
	const bdEl = envBd.badge();
	bdEl._fire('pointerup', { pointerId: 7, pointerType: 'mouse', button: 2, clientX: 0, clientY: 0, stopPropagation() {} });
	await sleep(320);
	assert.strictEqual(BD.unreadCount(), bdBefore, 'right-click on the badge does NOT read');
	assert.ok(!envBd.bubble().classList.contains('show'), 'right-click on the badge pops nothing');
	bdEl._fire('pointerup', { pointerId: 8, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, stopPropagation() {} });
	await sleep(320);
	assert.ok(envBd.bubble().classList.contains('show') && envBd.bubble().textContent.includes('红标右键测试'),
		`left-click on the badge reads: ${envBd.bubble().textContent}`);

	/* 18d. cross-channel completion dedup (09-06 用户报告: the question-answer
	 * flow raced the active-session detection and the SAME end announced
	 * twice — once by the chip adapter, once by the polled frame). The DOM
	 * side records its end-fire; the polled frame for the SAME event time
	 * (±8s) must stay silent, while a genuinely later end still announces. */
	const envDd = makeEnv();
	envDd.ready();
	const DX = envDd.sandbox.__dshWhale;
	envDd.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	DX._setHoldMs(50);
	DX.handleMuxPayload({ type: 'session/projection', sessionId: 'session-dd', key: 'subagentTiming', value: { settledMs: 0 } });
	await sleep(30);
	const tEnd = Date.now();
	DX._dedup.seeEndFire('session-dd', 'success', tEnd); /* the chip adapter just spoke */
	DX._feedEventFrame({ sessionId: 'session-dd', seq: 1, time: tEnd + 500, event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(30);
	assert.ok(!envDd.bubble().textContent.includes('完成了'), 'same-end polled frame stays silent (cross-channel dedup)');
	DX._feedEventFrame({ sessionId: 'session-dd', seq: 2, time: tEnd + 60000, event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(140);
	assert.ok(envDd.bubble().textContent.includes('完成了'), `a real later completion still announces: ${envDd.bubble().textContent}`);

	/* 18e. the contact book (dsh-whale:titles): real names survive 清空历史,
	 * LRU-capped at 500, 未命名任务 never enters, and a book-only name
	 * resolves an attention immediately (no placeholder, no hold) */
	const envTb = makeEnv();
	envTb.ready();
	const TB = envTb.sandbox.__dshWhale;
	const tbRaw = () => JSON.parse(envTb.sandbox.localStorage.getItem('dsh-whale:titles') || '{}');
	TB.handleMuxPayload({ type: 'session/projection', sessionId: 'session-tb1', key: 'title', value: '通讯录会话', seq: 1 });
	await sleep(30);
	assert.ok(tbRaw()['session-tb1'] && tbRaw()['session-tb1'].t === '通讯录会话', 'real title enters the book');
	/* push 160 newer names: the 150-capped MEMORY map evicts session-tb1,
	 * the 500-capped book keeps it — an attention must still resolve the
	 * name from the book instead of showing 未命名任务 */
	for (let fi = 0; fi < 160; fi++) {
		TB.handleMuxPayload({ type: 'session/projection', sessionId: 'session-flood' + fi, key: 'title', value: '灌水' + fi, seq: 10 + fi });
	}
	TB.handleMuxPayload({ type: 'question/requested', sessionId: 'session-tb1', questions: [{ id: 'qb', question: '问题' }], time: Date.now() });
	await sleep(30);
	assert.ok(envTb.bubble().textContent.includes('[通讯录会话]需要你选择'), `book fallback after memory eviction: ${envTb.bubble().textContent}`);
	/* LRU cap: flood past 500 distinct — book stays bounded, newest kept */
	for (let fj = 0; fj < 400; fj++) {
		TB.handleMuxPayload({ type: 'session/projection', sessionId: 'session-wave' + fj, key: 'title', value: '再灌' + fj, seq: 200 + fj });
	}
	const tbCount = Object.keys(tbRaw()).length;
	assert.ok(tbCount <= 500, `book LRU-capped at 500 (got ${tbCount})`);
	assert.ok(tbRaw()['session-wave399'], 'newest entries kept');

	/* 18f. manual stop on the ACTIVE session (09-06 用户报告: 手动停止后
	 * ⏳ 计时仍在走): a killed turn renders no usage chip, so the polled
	 * 'aborted' end is the ONLY stop signal — it must pass the active-
	 * session gate, stop the run timer, and announce 被中止了 ✋ */
	const envAb = makeEnv();
	envAb.ready();
	const AB = envAb.sandbox.__dshWhale;
	envAb.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	AB._setHoldMs(50);
	envAb.sandbox.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-ab1' }));
	AB.handleMuxPayload({ type: 'session/projection', sessionId: 'session-ab1', key: 'title', value: '手动停止实测', seq: 1 });
	await sleep(30);
	AB._feedEventFrame({ sessionId: 'session-ab1', seq: 2, time: Date.now(), event: { type: 'turn/start', data: {} } });
	await sleep(30);
	assert.ok(AB._runTimer.state().active, `run timer follows the active session's turn/start: ${JSON.stringify(AB._runTimer.state())}`);
	assert.ok(envAb.bubble().textContent.includes('开工了'), 'active-session start still announces');
	/* the user stops the turn: reason aborted must NOT be dropped by the
	 * active-session gate (pre-fix it returned here and the timer ran on) */
	AB._feedEventFrame({ sessionId: 'session-ab1', seq: 3, time: Date.now() + 1000, event: { type: 'turn/end', data: { reason: { kind: 'aborted' } } } });
	await sleep(140);
	assert.ok(!AB._runTimer.state().active, `run timer stops on the aborted end: ${JSON.stringify(AB._runTimer.state())}`);
	assert.ok(envAb.bubble().textContent.includes('被中止了'), `中止 announcement fires for the active session: ${envAb.bubble().textContent}`);

	/* B6 (09-06 真机): a completed end dedup-dropped by the ±8s window (the
	 * DOM chip announced first) must STILL stop the run timer — the stop
	 * used to live below the announcement gating, so a 2s dev-say turn
	 * (chip fired, polled end dedup-dropped) leaked a 1h ⏳ row */
	const envB6 = makeEnv();
	envB6.ready();
	const B6W = envB6.sandbox.__dshWhale;
	envB6.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	B6W._setHoldMs(50);
	envB6.sandbox.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b6' }));
	B6W._feedEventFrame({ sessionId: 'session-b6', seq: 1, time: Date.now(), event: { type: 'turn/start', data: {} } });
	await sleep(30);
	assert.ok(B6W._runTimer.state().active, 'B6: slot starts for the active session');
	B6W._dedup.seeEndFire('session-b6', 'success', Date.now()); /* the chip announced first */
	B6W._feedEventFrame({ sessionId: 'session-b6', seq: 2, time: Date.now(), event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(60);
	assert.ok(!B6W._runTimer.state().active, `B6: dedup-dropped completed end still stops the timer: ${JSON.stringify(B6W._runTimer.state())}`);

	/* 18i. B3 (09-06 真机): a completion whose turn started BEFORE the page
	 * load (adapter never armed → its chip can never fire) used to be LOST
	 * for the visible session — the poll gate dropped 'completed' while
	 * trusting a DOM signal that did not exist. The polled frame now speaks;
	 * a duplicate of the same end (±8s) stays silent. */
	const envB3 = makeEnv();
	envB3.ready();
	const B3W = envB3.sandbox.__dshWhale;
	envB3.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	B3W._setHoldMs(50);
	envB3.sandbox.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-b3' }));
	B3W.handleMuxPayload({ type: 'session/projection', sessionId: 'session-b3', key: 'title', value: '重载前开工的轮次', seq: 1 });
	await sleep(30);
	const tEndB3 = Date.now();
	B3W._feedEventFrame({ sessionId: 'session-b3', seq: 10, time: tEndB3, event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(140);
	assert.ok(envB3.bubble().textContent.includes('[重载前开工的轮次]完成了'), `unarmed visible completion still announces: ${envB3.bubble().textContent}`);
	assert.strictEqual(B3W.historyList().filter((h) => h.sessionId === 'session-b3').length, 1, 'B3 completion recorded once');
	B3W._feedEventFrame({ sessionId: 'session-b3', seq: 11, time: tEndB3 + 2000, event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(140);
	assert.strictEqual(B3W.historyList().filter((h) => h.sessionId === 'session-b3').length, 1, 'duplicate end within ±8s never double-records');

	/* 18g. multi-task run timer (09-06 用户拍板方案): ONE NAMED row per
	 * running session — no more anonymous newest-start-wins slot; long
	 * names are pixel-capped with …; a live report panel is NOT trampled
	 * by the tick (rows resume after it expires); 🔧 lines carry the
	 * session name only when 2+ tasks run at once */
	const envMt = makeEnv();
	envMt.ready();
	const MT = envMt.sandbox.__dshWhale;
	envMt.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	MT._setHoldMs(50);
	MT.handleMuxPayload({ type: 'session/projection', sessionId: 'session-mt1', key: 'title', value: '写周报', seq: 1 });
	MT.handleMuxPayload({ type: 'session/projection', sessionId: 'session-mt2', key: 'title', value: '这是一个相当相当相当相当相当长的会话名字', seq: 2 });
	MT._feedEventFrame({ sessionId: 'session-mt1', seq: 3, time: Date.now(), event: { type: 'turn/start', data: {} } });
	/* session-mt2 was already mid-flight when the page loaded: no polled
	 * start frame exists, so the test starts its slot directly (backdated
	 * past the 2-minute gate) */
	MT._runTimer.start('session-mt2', Date.now() - 180000);
	await sleep(30);
	const mtState = MT._runTimer.state();
	assert.ok(mtState.active && mtState.count === 2, `two concurrent runs tracked: ${JSON.stringify(mtState)}`);
	const mtRows = MT._runTimer.rows(Date.now() + 180000); /* both slots mature */
	assert.strictEqual(mtRows.length, 2, `both sessions get a row once mature: ${JSON.stringify(mtRows)}`);
	assert.ok(mtRows[0].indexOf('⏳ [写周报]') === 0, `row carries the session name: ${mtRows[0]}`);
	assert.ok(mtRows[1].includes('…') && !mtRows[1].includes('相当长的会话名字'), `long name pixel-capped with …: ${mtRows[1]}`);
	const mtPanel = () => {
		const el = envMt.whale.children.find((c) => String(c.className).indexOf('dsh-whale-status') === 0);
		return el ? el.textContent : '';
	};
	/* mt1 finishes with usage: its report must survive mt2's timer tick */
	MT.handleMuxPayload({ type: 'session/event', sessionId: 'session-mt1', event: { type: 'assistant/message', data: { usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 } } } });
	MT._feedEventFrame({ sessionId: 'session-mt1', seq: 5, time: Date.now(), event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
	await sleep(60);
	assert.ok(mtPanel().includes('此次任务消耗'), `mt1 report on screen: ${mtPanel()}`);
	await sleep(1150); /* ≥1 tick of mt2's mature slot */
	assert.ok(mtPanel().includes('此次任务消耗'), `tick must NOT trample a live report: ${mtPanel()}`);
	/* the timer rows resume once the report expires (6s lifetime) — poll
	 * with slack: under load both the report's expiry timer and the 1s
	 * tick can fire late, a fixed sleep races them (was flaky) */
	let resumed = false;
	for (let i = 0; i < 40 && !resumed; i++) {
		await sleep(150);
		resumed = mtPanel().includes('⏳ [');
	}
	assert.ok(resumed, `timer row resumes after the report expires: ${mtPanel()}`);
	/* 🔧 with a single running task: no name tag */
	MT.handleMuxPayload({ type: 'session/event', sessionId: 'session-mt2', event: { type: 'tool/call', data: { name: 'bash', callId: 'mt-c1' } } });
	await sleep(30);
	assert.ok(mtPanel().includes('🔧 正在跑：bash') && !mtPanel().includes('['), `single task keeps the tool line clean: ${mtPanel()}`);
	/* a second task joins → live status lines carry the session name */
	MT._runTimer.start('session-mt1', Date.now());
	await sleep(2100); /* pass the 2s live-status throttle */
	MT.handleMuxPayload({ type: 'session/event', sessionId: 'session-mt1', event: { type: 'tool/call', data: { name: 'pwsh', callId: 'mt-c2' } } });
	await sleep(30);
	assert.ok(mtPanel().includes('[写周报]🔧 正在跑：pwsh'), `multi-task tool line carries the name: ${mtPanel()}`);
	MT._runTimer.stop('session-mt1');
	MT._runTimer.stop('session-mt2');
	assert.ok(!MT._runTimer.state().active, 'both slots stopped cleanly');

	/* 19. spawned SUBAGENTS (bare-UUID sessions) are sub-tasks: their turns
	 * never announce — no bubble, no unread, no bell, no workload bump */
	const envSub = makeEnv();
	envSub.ready();
	const S = envSub.sandbox.__dshWhale;
	const muxpSub = (payload) => S.handleMuxPayload(payload);
	envSub.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })); /* no title info */
	S._setHoldMs(50);
	const SUB_ID = 'b78588fd-9b42-43a8-8f55-bc1544ed83fb'; /* bare UUID, like real spawned subagents */
	const loadSub0 = S.workLoad();
	muxpSub({ type: 'session/projection', sessionId: SUB_ID, key: 'subagentTiming', value: { settledMs: 0, active: { since: 1, through: 1 } } });
	muxpSub({ type: 'session/projection', sessionId: SUB_ID, key: 'title', value: '请调用 pwsh 工具执行命令 Start-', seq: 1 });
	muxpSub({ type: 'session/event', sessionId: SUB_ID, event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	await sleep(120); /* past the hold window — still nothing */
	assert.ok(!envSub.bubble().textContent.includes('开工了'), 'subagent turn/start is silent');
	assert.strictEqual(S.unreadCount(), 0, 'subagent turn/start adds no unread');
	muxpSub({ type: 'session/event', sessionId: SUB_ID, event: { type: 'turn/end', seq: 5, time: 1, data: {} } });
	await sleep(30);
	assert.ok(!envSub.bubble().textContent.includes('完成了'), 'subagent turn/end is silent');
	assert.strictEqual(S.unreadCount(), 0, 'subagent turn/end adds no unread');
	assert.strictEqual(envSub.audioStarts().length, 0, 'subagent turns play no bell');
	assert.strictEqual(S.workLoad(), loadSub0, 'subagent turns do not move the workload');
	/* subagent turns never appear in the click summary either */
	envSub.whale._fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envSub.whale._fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.ok(!envSub.bubble().textContent.includes('开工了') && !envSub.bubble().textContent.includes('完成了'),
		`click summary ignores subagent turns: ${envSub.bubble().textContent}`);
	S._setHoldMs(null);

	/* 20. baseline markers EXPIRE: a subscribed frame with no jobs must not
	 * swallow the workload of a later brand-new job */
	const envTtl = makeEnv();
	envTtl.ready();
	const T = envTtl.sandbox.__dshWhale;
	const muxpTtl = (payload) => T.handleMuxPayload(payload);
	T._setBaselineTtl(60);
	/* fresh baseline: the jobs frame inside the TTL window is silent */
	muxpTtl({ type: 'session/subscribed', sessionId: 'session-ttl1', lastSeq: 0 });
	const loadTtl0 = T.workLoad();
	muxpTtl({
		type: 'session/jobs',
		sessionId: 'session-ttl1',
		jobs: [{ id: 't-1', kind: 'pwsh', label: 'old job', status: 'running', startedAt: 1 }],
	});
	assert.strictEqual(T.workLoad(), loadTtl0, 'jobs inside the TTL window are a silent baseline');
	/* stale marker (subscribed with NO jobs): the next job is NOT a baseline */
	muxpTtl({ type: 'session/subscribed', sessionId: 'session-ttl2', lastSeq: 0 });
	await sleep(120); /* marker expires */
	const loadTtl1 = T.workLoad();
	muxpTtl({
		type: 'session/jobs',
		sessionId: 'session-ttl2',
		jobs: [{ id: 't-2', kind: 'pwsh', label: 'brand new job', status: 'running', startedAt: 2 }],
	});
	assert.strictEqual(T.workLoad(), loadTtl1 + 1, 'expired baseline: the new job still counts as work');
	T._setBaselineTtl(null);

	/* 21. `stopping` is a transient mid-state and must not double-count a
	 * job's start: running(+1) -> stopping(+0) -> completed(-0.5) = +0.5 */
	const envStop = makeEnv();
	envStop.ready();
	const ST = envStop.sandbox.__dshWhale;
	const muxpStop = (payload) => ST.handleMuxPayload(payload);
	const loadStop0 = ST.workLoad();
	muxpStop({
		type: 'session/jobs',
		sessionId: 'session-st1',
		jobs: [{ id: 'st-1', kind: 'bash', label: 'npm run dev', status: 'running', startedAt: 1 }],
	});
	assert.strictEqual(ST.workLoad(), loadStop0 + 1, 'running +1');
	muxpStop({
		type: 'session/jobs',
		sessionId: 'session-st1',
		jobs: [{ id: 'st-1', kind: 'bash', label: 'npm run dev', status: 'stopping', startedAt: 1 }],
	});
	assert.strictEqual(ST.workLoad(), loadStop0 + 1, 'stopping does not double-count the start');
	muxpStop({
		type: 'session/jobs',
		sessionId: 'session-st1',
		jobs: [{ id: 'st-1', kind: 'bash', label: 'npm run dev', status: 'completed', startedAt: 1, finishedAt: 3 }],
	});
	assert.strictEqual(ST.workLoad(), loadStop0 + 0.5, 'full lifecycle nets +0.5 (was +1.5 before the fix)');
	assert.strictEqual(ST.unreadCount(), 0, 'stopping lifecycle never notifies');

	/* 22. autoplay suspension: a ding requested while the context is
	 * suspended survives via async resume + re-pump */
	const envRes = makeEnv();
	envRes.ready();
	const RR = envRes.sandbox.__dshWhale;
	RR.playDing('done'); /* creates the (running) context */
	RR._resetDing(); /* cancel that ring + playing state; context stays */
	const ac = envRes.audioCtxs()[0];
	assert.ok(ac, 'audio context created lazily');
	envRes.audioStarts().length = 0;
	ac.state = 'suspended'; /* simulate autoplay policy before a real ring */
	const resumeCallsBefore = ac.resumeCalls;
	RR.playDing('done');
	assert.ok(ac.resumeCalls > resumeCallsBefore, 'suspended context gets resumed');
	await sleep(80); /* resume().then -> re-pump */
	assert.strictEqual(envRes.audioStarts().length, 2, 'the ring plays after the async resume');

	/* 23. a late title rewrites THIS session's queued report, but never the
	 * bubble of ANOTHER session that is currently on screen */
	const envFix = makeEnv();
	envFix.ready();
	const FX = envFix.sandbox.__dshWhale;
	const muxpFix = (payload) => FX.handleMuxPayload(payload);
	envFix.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	FX._setHoldMs(40);
	/* session A: end report falls back to 未命名任务 and shows on screen */
	muxpFix({ type: 'session/projection', sessionId: 'session-fxA', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpFix({ type: 'session/event', sessionId: 'session-fxA', event: { type: 'turn/end', seq: 1, time: 0, data: {} } });
	await sleep(90);
	assert.ok(envFix.bubble().textContent.includes('未命名任务'), 'A fell back to 未命名任务');
	/* session B: another end report queues behind it (B owns the bubble now) */
	muxpFix({ type: 'session/projection', sessionId: 'session-fxB', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpFix({ type: 'session/event', sessionId: 'session-fxB', event: { type: 'turn/end', seq: 1, time: 0, data: {} } });
	await sleep(90);
	assert.ok(envFix.bubble().textContent.includes('未命名任务'), 'B fell back too');
	/* A's title arrives late: its QUEUE item is rewritten, B's bubble is not */
	muxpFix({ type: 'session/projection', sessionId: 'session-fxA', key: 'title', value: '会话A的标题', seq: 2 });
	await sleep(30);
	const qA = FX.reportQueue().filter((r) => r.sessionId === 'session-fxA');
	assert.ok(qA.length > 0 && qA.every((r) => r.text.includes('会话A的标题')), 'A queue item rewritten with A title');
	assert.ok(envFix.bubble().textContent.includes('未命名任务'), 'B bubble NOT rewritten with A title');
	FX._setHoldMs(null);

	/* 24. mixed stress: interleaved jobs + turns + attention + resubscribe
	 * keep every counter consistent */
	const envMix = makeEnv();
	envMix.ready();
	const MX = envMix.sandbox.__dshWhale;
	const muxpMix = (payload) => MX.handleMuxPayload(payload);
	envMix.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	MX._setHoldMs(10);
	/* main session A: 5 turn pairs -> 10 reports */
	muxpMix({ type: 'session/projection', sessionId: 'session-mxA', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpMix({ type: 'session/projection', sessionId: 'session-mxA', key: 'title', value: '压力会话A', seq: 1 });
	for (let i = 0; i < 5; i++) {
		muxpMix({ type: 'session/event', sessionId: 'session-mxA', event: { type: 'turn/start', seq: i * 10 + 1, time: i, data: {} } });
		muxpMix({ type: 'session/event', sessionId: 'session-mxA', event: { type: 'turn/end', seq: i * 10 + 5, time: i + 1, data: {} } });
	}
	assert.strictEqual(MX.unreadCount(), 5, '5 turn pairs -> 5 unread (starts stay out)');
	/* a spawned subagent interleaves: still fully silent */
	const SUBX = 'd6e19baa-e7b1-4698-a520-fab62e8aff6b';
	muxpMix({ type: 'session/projection', sessionId: SUBX, key: 'subagentTiming', value: { active: { since: 1, through: 2 } } });
	muxpMix({ type: 'session/event', sessionId: SUBX, event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpMix({ type: 'session/event', sessionId: SUBX, event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	assert.strictEqual(MX.unreadCount(), 5, 'subagent turns stay silent in a mix');
	/* jobs of every flavor move only the workload */
	const loadMix0 = MX.workLoad();
	muxpMix({
		type: 'session/jobs',
		sessionId: 'session-mxA',
		jobs: [
			{ id: 'x-1', kind: 'bash', label: 'npm test', status: 'running', startedAt: 1 },
			{ id: 'x-2', kind: 'bash', label: 'git push', status: 'stopping', startedAt: 2 },
			{ id: 'x-3', kind: 'bash', label: 'npm build', status: 'completed', startedAt: 3, finishedAt: 4, detail: 'exit code: 1' },
			{ id: 'x-4', kind: 'bash', label: 'pip install', status: 'killed', startedAt: 5 },
		],
	});
	assert.strictEqual(MX.unreadCount(), 5, 'jobs never add unread in a mix');
	assert.strictEqual(MX.workLoad(), loadMix0 + 1 + 0 + 1 + 0.5, 'workload: +1 run, stopping 0, +1 fail, +0.5 kill');
	/* attention joins the badge */
	muxpMix({ type: 'approval/requested', sessionId: 'session-mxA', approvalId: 'a-1', toolName: 'pwsh' });
	assert.strictEqual(MX.unreadCount(), 6, 'attention counts in a mix');
	/* resubscribe: job mirror resets, the baseline frame is silent, and the
	 * unread reports survive */
	const loadMix1 = MX.workLoad();
	muxpMix({ type: 'session/subscribed', sessionId: 'session-mxA', lastSeq: 99 });
	muxpMix({
		type: 'session/jobs',
		sessionId: 'session-mxA',
		jobs: [{ id: 'x-1', kind: 'bash', label: 'npm test', status: 'completed', startedAt: 1, finishedAt: 6 }],
	});
	assert.strictEqual(MX.unreadCount(), 6, 'resubscribe keeps unread reports');
	assert.strictEqual(MX.workLoad(), loadMix1, 'baseline frame after resubscribe stays silent');
	MX._setHoldMs(null);

	/* 25. mux reconnect: a closed socket schedules a fresh one; state survives */
	const envRe = makeEnv();
	envRe.ready();
	const RE = envRe.sandbox.__dshWhale;
	const s0 = envRe.socket();
	s0._emit('close', { code: 1006, reason: 'gone' }); /* triggers scheduleReconnect */
	await sleep(1150); /* backoff starts at 1s */
	const sockets = RE.sockets;
	assert.ok(sockets.length >= 2, 'reconnect created a new socket');
	const s1 = sockets[sockets.length - 1];
	assert.ok(s1 !== s0, 'new socket instance, not the dead one');
	s1._emit('open', {});
	/* the channel keeps working on the new socket */
	RE.handleMuxPayload({ type: 'session/projection', sessionId: 'session-re1', key: 'subagentTiming', value: { settledMs: 0 } });
	RE.handleMuxPayload({ type: 'session/projection', sessionId: 'session-re1', key: 'title', value: '重连会话', seq: 1 });
	RE.handleMuxPayload({ type: 'session/event', sessionId: 'session-re1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	assert.ok(envRe.bubble().textContent.includes('重连会话'), `post-reconnect channel works: ${envRe.bubble().textContent}`);

	/* 26. ding burst: the queue stays bounded (1 playing + 5 queued max) */
	const envBurst = makeEnv();
	envBurst.ready();
	const BU = envBurst.sandbox.__dshWhale;
	for (let i = 0; i < 50; i++) BU.playDing('done');
	await sleep(80);
	assert.strictEqual(envBurst.audioStarts().length, 2, 'a burst collapses to one playing ring');
	BU._resetDing();
	assert.strictEqual(envBurst.audioStarts().length, 2, 'reset stops the queue, played ring stays recorded');
	BU.playDing('fail');
	await sleep(40);
	assert.ok(envBurst.audioStarts().length > 2, 'queue works after a reset');

	/* 27. live busy status: tool/call + step/start go to the STATUS PANEL
	 * (left/below the whale), throttled, never unread/bell; the speech
	 * bubble stays pure notifications; subagent tool calls stay silent */
	const envStat = makeEnv();
	envStat.ready();
	const ST2 = envStat.sandbox.__dshWhale;
	const muxpStat = (payload) => ST2.handleMuxPayload(payload);
	const statusEl = () => envStat.whale.children.find((c) => c.className === 'dsh-whale-status');
	muxpStat({ type: 'session/event', sessionId: 'session-st2', event: { type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, name: 'pwsh', arguments: '{}' } } });
	assert.ok(statusEl() && statusEl().textContent.includes('正在跑：pwsh'), `tool status in panel: ${statusEl() && statusEl().textContent}`);
	assert.ok(!envStat.bubble().textContent.includes('正在跑'), 'speech bubble untouched by tool status');
	assert.strictEqual(ST2.unreadCount(), 0, 'tool status never adds unread');
	assert.strictEqual(envStat.audioStarts().length, 0, 'tool status never rings');
	/* throttled: a second call within 2s does not overwrite the panel */
	muxpStat({ type: 'session/event', sessionId: 'session-st2', event: { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 1, name: 'bash', arguments: '{}' } } });
	assert.ok(statusEl().textContent.includes('pwsh') && !statusEl().textContent.includes('bash'),
		`status throttled: ${statusEl().textContent}`);
	/* subagent tool calls are silent */
	muxpStat({ type: 'session/event', sessionId: 'd6e19baa-e7b1-4698-a520-fab62e8aff6b', event: { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, name: 'pwsh', arguments: '{}' } } });
	assert.ok(statusEl().textContent.includes('pwsh'), 'subagent tool call silent (panel unchanged)');
	/* after the throttle window a step bubble appears */
	await sleep(2100);
	muxpStat({ type: 'session/event', sessionId: 'session-st2', event: { type: 'step/start', seq: 4, time: 4, data: { turn: 1, step: 3 } } });
	assert.ok(statusEl().textContent.includes('第 3 步'), `step status in panel: ${statusEl().textContent}`);
	assert.strictEqual(ST2.unreadCount(), 0, 'step status never adds unread');

	/* 28. token burn: THIS task's burn (from assistant/message usage) and
	 * the conversation's cumulative burn (tokenUsage projection) + pressure
	 * are reported in the status panel at turn/end, one line each; a
	 * high-pressure projection warns once (no unread) */
	const envTok = makeEnv();
	envTok.ready();
	const TK = envTok.sandbox.__dshWhale;
	const muxpTok = (payload) => TK.handleMuxPayload(payload);
	const statusTok = () => envTok.whale.children.find((c) => c.className === 'dsh-whale-status');
	envTok.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	TK._setHoldMs(200);
	muxpTok({ type: 'session/projection', sessionId: 'session-tk1', key: 'subagentTiming', value: { settledMs: 0 } });
	/* NOTE: no title projection yet — turn/start enters the name-hold, and
	 * model replies arriving DURING the hold must still count toward the
	 * task's token burn (the counter resets on the live event, not on the
	 * delayed report) */
	muxpTok({ type: 'session/projection', sessionId: 'session-tk1', key: 'tokenUsage', value: { uncachedInputTokens: 30000000, outputTokens: 5000000, cacheReadTokens: 3000000, cacheWriteTokens: 190000 } });
	muxpTok({ type: 'session/projection', sessionId: 'session-tk1', key: 'contextPressure', value: { pressureTokens: 800000, projectedTokens: 800000, contextWindow: 1000000 } });
	assert.ok(envTok.bubble().textContent.includes('compact'), `pressure warning shown: ${envTok.bubble().textContent}`);
	assert.strictEqual(TK.unreadCount(), 0, 'pressure warning never adds unread');
	/* turn/start begins the count; model replies accumulate (including the
	 * ones inside the name-hold window) */
	muxpTok({ type: 'session/event', sessionId: 'session-tk1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpTok({ type: 'session/event', sessionId: 'session-tk1', event: { type: 'assistant/message', seq: 2, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], id: 'm1' }, usage: { inputTokens: 1000000, outputTokens: 500000, cacheReadTokens: 2000000, reasoningTokens: 0 } } } });
	await sleep(80); /* still inside the hold */
	muxpTok({ type: 'session/projection', sessionId: 'session-tk1', key: 'title', value: '会话TK1', seq: 2 }); /* flushes the held start report */
	await sleep(60);
	muxpTok({ type: 'session/event', sessionId: 'session-tk1', event: { type: 'assistant/message', seq: 3, time: 2, data: { turn: 1, step: 2, message: { role: 'assistant', content: [], id: 'm2' }, usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 3000, reasoningTokens: 0 } } } });
	/* finishing the task reports all three lines in the status panel */
	muxpTok({ type: 'session/event', sessionId: 'session-tk1', event: { type: 'turn/end', seq: 5, time: 5, data: {} } });
	assert.ok(statusTok() && statusTok().textContent.includes('此次任务消耗 3.5M tokens'), `task line: ${statusTok() && statusTok().textContent}`);
	assert.ok(statusTok().textContent.includes('全对话累计消耗 38.2M tokens'), `session line: ${statusTok().textContent}`);
	assert.ok(statusTok().textContent.includes('上下文已用 80%'), `pressure line: ${statusTok().textContent}`);
	/* with room to spare the report is ONE line per item (3 lines) */
	const tokLines = statusTok().textContent.split('\n');
	assert.strictEqual(tokLines.length, 3, 'three lines (one per item) when space allows');
	assert.ok(envTok.bubble().textContent.includes('完成了'), 'notification bubble still shows the completion');
	/* click 1 reads the END report: panel shows its snapshot */
	envTok.whale._fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envTok.whale._fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.ok(envTok.bubble().textContent.includes('完成了'), 'end report replayed');
	assert.ok(!envTok.bubble().textContent.includes('消耗'), 'click summary is token-free');
	assert.ok(statusTok().textContent.includes('此次任务消耗 3.5M tokens'), 'reading the end report shows the panel');
	assert.ok(statusTok().textContent.includes('全对话累计消耗 38.2M tokens'), 'end report snapshot keeps the session total');
	/* click 2: the queue is EMPTY (starts stay out of it) — nothing replays
	 * and no start report can ever leave a stale panel behind */
	envTok.whale._fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envTok.whale._fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.strictEqual(TK.unreadCount(), 0, 'queue drained after one read');
	assert.ok(!envTok.bubble().textContent.includes('开工了'), 'no start replay (starts stay out of the queue)');
	TK._setHoldMs(null);

	/* 28b. name-hold ORDER: when the session title never arrives (fetch
	 * hangs), the turn/end hold (3s) expires BEFORE the turn/start hold
	 * (8s) — the held reports must still surface in EVENT order (开工
	 * before 完成), and the later start-hold expiry must not duplicate */
	const envOrd = makeEnv();
	envOrd.ready();
	const OR = envOrd.sandbox.__dshWhale;
	const muxpOr = (payload) => OR.handleMuxPayload(payload);
	envOrd.setFetch(() => new Promise(() => {})); /* label fetch hangs forever */
	muxpOr({ type: 'session/projection', sessionId: 'session-or1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpOr({ type: 'session/event', sessionId: 'session-or1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpOr({ type: 'session/event', sessionId: 'session-or1', event: { type: 'turn/end', seq: 5, time: 1, data: {} } });
	assert.strictEqual(OR.unreadCount(), 0, 'the end report is held while the name is unknown');
	/* the end hold (3s) expires: the single queued report flushes */
	await sleep(3600);
	const qOrd = OR.reportQueue();
	assert.strictEqual(qOrd.length, 1, 'held end report flushed by the expiry');
	assert.ok(qOrd[0].text.includes('完成了'), `queue holds the completion: ${qOrd.map((r) => r.text.slice(0, 14)).join(' | ')}`);
	assert.strictEqual(OR.unreadCount(), 1, 'one unread after the expiry');
	/* the start hold (8s) expires later: nothing new (starts stay out of
	 * the queue, so there is no second report to flush) */
	await sleep(5000);
	assert.strictEqual(OR.unreadCount(), 1, 'no duplicates after the later hold expires');
	assert.strictEqual(OR.reportQueue().length, 1, 'queue unchanged after the later expiry');

	/* 29. sleep mode: idle -> nap; activity wakes with a line; a click while
	 * napping gets a sleepy mumble */
	const envSleep = makeEnv();
	envSleep.ready();
	const SL = envSleep.sandbox.__dshWhale;
	const muxpSl = (payload) => SL.handleMuxPayload(payload);
	envSleep.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	SL._setSleepMs(60);
	/* (re)arm the nap timer with the short override via one activity frame */
	muxpSl({ type: 'session/projection', sessionId: 'session-sl0', key: 'tokenUsage', value: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
	await sleep(100);
	assert.strictEqual(SL.asleep(), true, 'fell asleep after idle timeout');
	assert.ok(envSleep.whale.classList.contains('dsh-whale-asleep'), 'asleep class on');
	assert.ok(envSleep.bubble().textContent.includes('Zzz'), `sleep line: ${envSleep.bubble().textContent}`);
	/* clicking a napping whale: mumble, no wake-up */
	envSleep.whale._fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envSleep.whale._fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.strictEqual(SL.asleep(), true, 'click does not wake the whale');
	assert.ok(envSleep.bubble().textContent.includes('别吵我'), `sleepy mumble: ${envSleep.bubble().textContent}`);
	/* real activity wakes it. A task's OWN report replaces the generic wake
	 * line: turn/start wakes SILENTLY so the bubble shows 开工了 directly
	 * (no 唔…有活了 flash that gets overwritten a tick later) */
	muxpSl({ type: 'session/projection', sessionId: 'session-sl1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpSl({ type: 'session/projection', sessionId: 'session-sl1', key: 'title', value: '唤醒会话', seq: 1 });
	await sleep(30);
	muxpSl({ type: 'session/event', sessionId: 'session-sl1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	assert.strictEqual(SL.asleep(), false, 'activity wakes the whale');
	assert.ok(envSleep.bubble().textContent.includes('开工了'), `task report IS the wake bubble: ${envSleep.bubble().textContent}`);
	assert.ok(!envSleep.bubble().textContent.includes('有活了'), 'no generic wake line on a task wake');
	assert.ok(!envSleep.whale.classList.contains('dsh-whale-asleep'), 'asleep class removed');
	/* non-task activity (jobs frames) still uses the generic wake line —
	 * fresh env so the 5s wake-line throttle does not suppress it */
	const envSl2 = makeEnv();
	envSl2.ready();
	const SL2 = envSl2.sandbox.__dshWhale;
	SL2._setSleepMs(60);
	SL2.handleMuxPayload({ type: 'session/projection', sessionId: 'session-sl2', key: 'tokenUsage', value: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
	await sleep(100);
	assert.strictEqual(SL2.asleep(), true, 'napping for the jobs-wake test');
	SL2.handleMuxPayload({ type: 'session/jobs', sessionId: 'session-sl2', jobs: [{ id: 'j9', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] });
	assert.strictEqual(SL2.asleep(), false, 'job activity wakes the whale');
	assert.ok(envSl2.bubble().textContent.includes('有活了'), `generic wake line for jobs: ${envSl2.bubble().textContent}`);
	SL2._setSleepMs(null);
	/* double-click (swim) wakes the whale */
	SL._setSleepMs(60);
	muxpSl({ type: 'session/projection', sessionId: 'session-sl0', key: 'tokenUsage', value: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
	await sleep(100);
	assert.strictEqual(SL.asleep(), true, 'napping again for the double-click test');
	envSleep.whale._fire('dblclick', {});
	assert.strictEqual(SL.asleep(), false, 'double-click wakes the whale');
	assert.ok(envSleep.sandbox.__dshWhale.swimState(), 'double-click still swims back');
	/* dragging wakes the whale too */
	SL._setSleepMs(60);
	muxpSl({ type: 'session/projection', sessionId: 'session-sl0', key: 'tokenUsage', value: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
	await sleep(100);
	assert.strictEqual(SL.asleep(), true, 'napping again for the drag test');
	envSleep.whale._fire('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envSleep.whale._fire('pointermove', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 150, clientY: 120 });
	assert.strictEqual(SL.asleep(), false, 'dragging wakes the whale');
	envSleep.whale._fire('pointerup', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 150, clientY: 120 });
	SL._setSleepMs(null);

	/* 30. gear: finished main tasks unlock decorations (persisted):
	 * coffee at 5 tasks, helmet at 15 */
	const envGear = makeEnv();
	envGear.ready();
	const GR = envGear.sandbox.__dshWhale;
	const muxpGear = (payload) => GR.handleMuxPayload(payload);
	envGear.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	GR._setHoldMs(10);
	muxpGear({ type: 'session/projection', sessionId: 'session-gr1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpGear({ type: 'session/projection', sessionId: 'session-gr1', key: 'title', value: '装饰测试', seq: 1 });
	assert.strictEqual(GR.unlockedGear.size, 0, 'no gear at start');
	const gearEl = (name) => envGear.sandbox.document.getElementById('dsh-whale-gear-' + name);
	assert.ok(gearEl('coffee'), 'coffee group exists inside the SVG');
	assert.strictEqual(gearEl('coffee').style.display, 'none', 'coffee hidden initially');
	for (let i = 0; i < 5; i++) {
		muxpGear({ type: 'session/event', sessionId: 'session-gr1', event: { type: 'turn/end', seq: i + 2, time: i + 1, data: {} } });
	}
	assert.ok(GR.unlockedGear.has('coffee'), 'coffee unlocked at 5 tasks');
	assert.strictEqual(gearEl('coffee').style.display, 'block', 'coffee widget revealed');
	/* the unlock announce is DELAYED past the completion bubble+panel (it
	 * used to stomp them — uiSay is a single slot); wait it out */
	await sleep(7100);
	assert.ok(envGear.bubble().textContent.includes('小咖啡杯'), `unlock line: ${envGear.bubble().textContent}`);
	assert.strictEqual(GR.gearStats.tasksDone, 5, 'tasks counted');
	assert.ok(envGear.sandbox.localStorage.getItem('dsh-whale:stats').includes('"tasksDone":5'), 'stats persisted');
	for (let i = 0; i < 10; i++) {
		muxpGear({ type: 'session/event', sessionId: 'session-gr1', event: { type: 'turn/end', seq: i + 20, time: i + 10, data: {} } });
	}
	assert.ok(GR.unlockedGear.has('helmet'), 'helmet unlocked at 15 tasks');
	assert.strictEqual(gearEl('helmet').style.display, 'block', 'helmet widget revealed');
	assert.strictEqual(GR.unlockedGear.size, 2, 'exactly two decorations');
	GR._setHoldMs(null);

	/* 30b. gear is a DAILY achievement: stale-date storage resets the
	 * counter and hides unlocked widgets; same-day storage keeps them;
	 * a midnight rollover while the page stays open resets too */
	const envGearDay = makeEnv([
		['dsh-whale:stats', JSON.stringify({ tasksDone: 15, date: '2020-01-01' })],
	]);
	envGearDay.ready();
	const GD = envGearDay.sandbox.__dshWhale;
	const gdEl = (name) => envGearDay.sandbox.document.getElementById('dsh-whale-gear-' + name);
	assert.strictEqual(GD.gearStats.tasksDone, 0, 'stale-day storage resets the daily counter');
	assert.strictEqual(GD.unlockedGear.size, 0, 'no gear carried over to the new day');
	assert.strictEqual(gdEl('coffee').style.display, 'none', 'coffee widget hidden after the reset');
	assert.strictEqual(gdEl('helmet').style.display, 'none', 'helmet widget hidden after the reset');
	/* same-day storage keeps the progress */
	const dNow = new Date();
	const tKey = dNow.getFullYear() + '-' + String(dNow.getMonth() + 1).padStart(2, '0') + '-' + String(dNow.getDate()).padStart(2, '0');
	const envGearSame = makeEnv([
		['dsh-whale:stats', JSON.stringify({ tasksDone: 7, date: tKey })],
	]);
	envGearSame.ready();
	assert.strictEqual(envGearSame.sandbox.__dshWhale.gearStats.tasksDone, 7, 'same-day storage keeps the counter');
	/* midnight rollover while the page stays open */
	const envGearOpen = makeEnv();
	envGearOpen.ready();
	const GO = envGearOpen.sandbox.__dshWhale;
	const muxpGo = (payload) => GO.handleMuxPayload(payload);
	const goEl = (name) => envGearOpen.sandbox.document.getElementById('dsh-whale-gear-' + name);
	envGearOpen.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	GO._setHoldMs(10);
	muxpGo({ type: 'session/projection', sessionId: 'session-go1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpGo({ type: 'session/projection', sessionId: 'session-go1', key: 'title', value: '跨天测试', seq: 1 });
	for (let i = 0; i < 5; i++) {
		muxpGo({ type: 'session/event', sessionId: 'session-go1', event: { type: 'turn/end', seq: i + 2, time: i + 1, data: {} } });
	}
	assert.strictEqual(GO.gearStats.tasksDone, 5, 'five tasks counted');
	assert.ok(GO.unlockedGear.has('coffee'), 'coffee unlocked');
	assert.strictEqual(goEl('coffee').style.display, 'block', 'coffee visible');
	/* roll the day over: everything resets, the widget hides */
	GO._setGearDay('1999-12-31');
	GO._rolloverDay();
	assert.strictEqual(GO.gearStats.tasksDone, 0, 'midnight rollover resets the counter');
	assert.strictEqual(GO.unlockedGear.size, 0, 'midnight rollover clears unlocked gear');
	assert.strictEqual(goEl('coffee').style.display, 'none', 'coffee hidden after the rollover');
	assert.ok(envGearOpen.sandbox.localStorage.getItem('dsh-whale:stats').includes('"tasksDone":0'), 'reset persisted');
	GO._setHoldMs(null);

	/* 31. status panel placement: BELOW when there is room, otherwise LEFT;
	 * inside each placement the panel aligns toward the roomier side so it
	 * never runs off the viewport edge */
	const envDir = makeEnv();
	envDir.ready();
	const DR = envDir.sandbox.__dshWhale;
	const muxpDir = (payload) => DR.handleMuxPayload(payload);
	const statusDir = () => envDir.whale.children.find((c) => c.className === 'dsh-whale-status');
	/* whale at the bottom edge: no room below -> LEFT; far from edges -> full width */
	envDir.whale.style.top = '694px';
	envDir.whale.style.left = '1094px';
	muxpDir({ type: 'session/event', sessionId: 'session-d1', event: { type: 'tool/call', seq: 1, time: 1, data: { name: 'pwsh', arguments: '{}' } } });
	assert.ok(statusDir(), 'status panel exists');
	assert.ok(statusDir().textContent.includes('正在跑：pwsh'), 'status shown');
	assert.ok(!statusDir().classList.contains('dsh-whale-status-below'), 'bottom position -> LEFT panel');
	assert.strictEqual(statusDir().style.maxWidth, '280px', 'full width when space allows');
	/* whale mid-screen (left-of-center): plenty of room below -> BELOW,
	 * left-aligned (more room to the right) */
	await sleep(2100); /* let the throttle expire */
	envDir.whale.style.top = '300px';
	envDir.whale.style.left = '400px';
	muxpDir({ type: 'session/event', sessionId: 'session-d1', event: { type: 'tool/call', seq: 2, time: 2, data: { name: 'bash', arguments: '{}' } } });
	assert.ok(statusDir().textContent.includes('正在跑：bash'), 'second status shown');
	assert.ok(statusDir().classList.contains('dsh-whale-status-below'), 'roomy below -> BELOW panel');
	assert.ok(!statusDir().classList.contains('dsh-whale-status-right'), 'left-aligned when more room to the right');
	assert.strictEqual(statusDir().style.maxWidth, '280px', 'full width mid-screen');
	/* whale hugging the RIGHT edge (real clamp max 1112): the BELOW panel
	 * stays left-aligned but SHRINKS (60px min) keeping a 16px margin
	 * from the viewport's right edge */
	await sleep(2100);
	envDir.whale.style.top = '400px';
	envDir.whale.style.left = '1112px';
	muxpDir({ type: 'session/event', sessionId: 'session-d1', event: { type: 'tool/call', seq: 3, time: 3, data: { name: 'node', arguments: '{}' } } });
	assert.ok(statusDir().classList.contains('dsh-whale-status-below'), 'still below');
	assert.ok(!statusDir().classList.contains('dsh-whale-status-right'), 'stays left-aligned');
	const narrowW = parseInt(statusDir().style.maxWidth, 10);
	assert.ok(narrowW > 0 && narrowW < 280, `panel shrinks near the right edge: ${statusDir().style.maxWidth}`);
	/* panel right edge = 1112 + 4 + 68 = 1184 <= 1200 - 16 (margin) */
	assert.ok(1112 + 4 + narrowW <= 1200 - 16, 'keeps a margin from the right edge');
	/* whale hugging the LEFT edge at the bottom: the side panel flips to
	 * the RIGHT of the whale (no room on the left) */
	await sleep(2100);
	envDir.whale.style.top = '694px';
	envDir.whale.style.left = '5px';
	muxpDir({ type: 'session/event', sessionId: 'session-d1', event: { type: 'tool/call', seq: 4, time: 4, data: { name: 'git', arguments: '{}' } } });
	assert.ok(!statusDir().classList.contains('dsh-whale-status-below'), 'bottom edge -> side panel');
	assert.ok(statusDir().classList.contains('dsh-whale-status-leftflip'), 'side panel flipped to the right of the whale near the left edge');

	/* 32. reading an unread report re-shows its token/pressure in the
	 * status panel (not just once at completion time) */
	const envRead = makeEnv();
	envRead.ready();
	const RD = envRead.sandbox.__dshWhale;
	const muxpRd = (payload) => RD.handleMuxPayload(payload);
	const statusRd = () => envRead.whale.children.find((c) => c.className === 'dsh-whale-status');
	envRead.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	RD._setHoldMs(10);
	muxpRd({ type: 'session/projection', sessionId: 'session-rd1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpRd({ type: 'session/projection', sessionId: 'session-rd1', key: 'title', value: '读取测试', seq: 1 });
	muxpRd({ type: 'session/projection', sessionId: 'session-rd1', key: 'tokenUsage', value: { uncachedInputTokens: 900000, outputTokens: 100000, cacheReadTokens: 0, cacheWriteTokens: 0 } });
	muxpRd({ type: 'session/projection', sessionId: 'session-rd1', key: 'contextPressure', value: { pressureTokens: 100000, projectedTokens: 100000, contextWindow: 1000000 } });
	muxpRd({ type: 'session/event', sessionId: 'session-rd1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpRd({ type: 'session/event', sessionId: 'session-rd1', event: { type: 'assistant/message', seq: 2, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], id: 'm1' }, usage: { inputTokens: 500000, outputTokens: 100000, cacheReadTokens: 400000, reasoningTokens: 0 } } } });
	muxpRd({ type: 'session/event', sessionId: 'session-rd1', event: { type: 'turn/end', seq: 5, time: 5, data: {} } });
	assert.strictEqual(RD.unreadCount(), 1, 'one unread report (end only; start stays out)');
	assert.ok(statusRd() && statusRd().textContent.includes('此次任务消耗 1.0M tokens'), 'panel shows the task numbers on completion');
	assert.ok(statusRd().textContent.includes('全对话累计消耗 1.0M tokens'), 'panel shows the session total too');
	/* the panel hides again (simulate the timeout); clicking the whale reads
	 * the report and RE-SHOWS the same numbers */
	statusRd().classList.remove('show');
	statusRd().textContent = '';
	await sleep(20);
	envRead.whale._fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envRead.whale._fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	await sleep(320);
	assert.ok(envRead.bubble().textContent.includes('完成了'), 'report text replayed on read');
	assert.ok(statusRd().textContent.includes('此次任务消耗 1.0M tokens'), 'panel re-shows tokens when the report is read');
	assert.ok(statusRd().textContent.includes('上下文已用 10%'), 'pressure re-shown too');
	RD._setHoldMs(null);

	/* 33. gear lives INSIDE the whale SVG: swimming (rotate + mirror) works
	 * and the gear groups ride along automatically — no JS compensation */
	const envFollow = makeEnv();
	envFollow.ready();
	const gearH2 = envFollow.sandbox.document.getElementById('dsh-whale-gear-helmet');
	const gearC2 = envFollow.sandbox.document.getElementById('dsh-whale-gear-coffee');
	assert.ok(gearH2 && gearC2, 'gear groups exist inside the SVG');
	envFollow.whale._fire('dblclick', {});
	const swimSt = () => envFollow.sandbox.__dshWhale.swimState();
	assert.ok(swimSt(), 'swim started');
	let ts2 = swimSt().start;
	let guard2 = 0;
	let rode = false;
	while (swimSt() && guard2++ < 5000) {
		ts2 += 16;
		envFollow.stepRaf(ts2);
		if (!rode && guard2 > 10) {
			rode = true;
			assert.ok(envFollow.svgFig.style.transform.includes('scaleX(-1)'), 'figure mirrored while swimming');
			assert.ok(envFollow.svgFig.style.transform.includes('rotate('), 'figure rotated while swimming');
			assert.strictEqual(gearH2.style.display, 'none', 'gear stays hidden during swim (not unlocked)');
		}
	}
	assert.ok(guard2 < 5000, 'swim finished');

	/* 34. dragging the whale re-flows an OPEN status panel in real time —
	 * the panel shrinks (keeping a margin from the edge) while the whale
	 * approaches the viewport edge */
	const envDrag = makeEnv();
	envDrag.ready();
	const DG = envDrag.sandbox.__dshWhale;
	const muxpDg = (payload) => DG.handleMuxPayload(payload);
	const statusDg = () => envDrag.whale.children.find((c) => c.className === 'dsh-whale-status');
	envDrag.whale.style.top = '400px';
	envDrag.whale.style.left = '400px';
	muxpDg({ type: 'session/event', sessionId: 'session-dg1', event: { type: 'tool/call', seq: 1, time: 1, data: { name: 'pwsh', arguments: '{}' } } });
	assert.ok(statusDg() && statusDg().classList.contains('dsh-whale-status-below'), 'panel below mid-screen');
	assert.ok(!statusDg().classList.contains('dsh-whale-status-right'), 'left-aligned mid-screen');
	assert.strictEqual(statusDg().style.maxWidth, '280px', 'full width mid-screen');
	/* drag the whale toward the right edge: the open panel shrinks live
	 * (never touching the screen edge) */
	envDrag.whale._fire('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envDrag.whale._fire('pointermove', { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 1200, clientY: 130 });
	const midW = parseInt(statusDg().style.maxWidth, 10);
	assert.ok(midW > 0 && midW < 280, `panel shrinks WHILE dragging: ${statusDg().style.maxWidth}`);
	assert.ok(!statusDg().classList.contains('dsh-whale-status-right'), 'stays left-aligned while shrinking');
	envDrag.whale._fire('pointerup', { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 1200, clientY: 130 });
	/* dragging to the bottom edge flips the panel side live too */
	envDrag.whale._fire('pointerdown', { pointerId: 8, pointerType: 'mouse', button: 0, clientX: 200, clientY: 100 });
	envDrag.whale._fire('pointermove', { pointerId: 8, pointerType: 'mouse', button: 0, clientX: 220, clientY: 790 });
	assert.ok(!statusDg().classList.contains('dsh-whale-status-below'), 'panel side flips to LEFT at the bottom edge');
	envDrag.whale._fire('pointerup', { pointerId: 8, pointerType: 'mouse', button: 0, clientX: 220, clientY: 790 });

	/* 34b. the three-line REPORT re-flows live: compact one line mid-screen,
	 * splits into more lines when the whale is dragged to the edge */
	const envFlow = makeEnv();
	envFlow.ready();
	const FL = envFlow.sandbox.__dshWhale;
	const muxpFl = (payload) => FL.handleMuxPayload(payload);
	const statusFl = () => envFlow.whale.children.find((c) => c.className === 'dsh-whale-status');
	envFlow.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	FL._setHoldMs(10);
	envFlow.whale.style.top = '400px';
	envFlow.whale.style.left = '400px';
	muxpFl({ type: 'session/projection', sessionId: 'session-fl1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpFl({ type: 'session/projection', sessionId: 'session-fl1', key: 'title', value: '流动测试', seq: 1 });
	muxpFl({ type: 'session/projection', sessionId: 'session-fl1', key: 'tokenUsage', value: { uncachedInputTokens: 30000000, outputTokens: 5000000, cacheReadTokens: 3000000, cacheWriteTokens: 190000 } });
	muxpFl({ type: 'session/projection', sessionId: 'session-fl1', key: 'contextPressure', value: { pressureTokens: 800000, projectedTokens: 800000, contextWindow: 1000000 } });
	muxpFl({ type: 'session/event', sessionId: 'session-fl1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpFl({ type: 'session/event', sessionId: 'session-fl1', event: { type: 'assistant/message', seq: 2, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], id: 'm1' }, usage: { inputTokens: 1000000, outputTokens: 500000, cacheReadTokens: 2000000, reasoningTokens: 0 } } } });
	muxpFl({ type: 'session/event', sessionId: 'session-fl1', event: { type: 'turn/end', seq: 5, time: 5, data: {} } });
	assert.strictEqual(statusFl().textContent.split('\n').length, 3, 'one line per item mid-screen');
	/* drag to the right edge: the open report's panel shrinks live (60px
	 * min, 16px margin from the edge) */
	envFlow.whale._fire('pointerdown', { pointerId: 9, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
	envFlow.whale._fire('pointermove', { pointerId: 9, pointerType: 'mouse', button: 0, clientX: 1200, clientY: 130 });
	const edgeW = parseInt(statusFl().style.maxWidth, 10);
	assert.ok(edgeW > 0 && edgeW < 280, `panel shrinks near the edge: ${statusFl().style.maxWidth}`);
	/* drag back to the middle: full width again */
	envFlow.whale._fire('pointermove', { pointerId: 9, pointerType: 'mouse', button: 0, clientX: 100, clientY: 140 });
	assert.strictEqual(statusFl().style.maxWidth, '280px', 'full width back mid-screen');
	envFlow.whale._fire('pointerup', { pointerId: 9, pointerType: 'mouse', button: 0, clientX: 600, clientY: 140 });
	FL._setHoldMs(null);

	/* 35. right-click: single click opens the menu (mood header + sound /
	 * wardrobe / help), double right-click pets the whale (affection +1,
	 * hearts, bounce, persisted). Menu closes on outside clicks and flips
	 * at the viewport edges; the sound toggle persists and silences dings.
	 * NOTE: intentional single right-clicks must be >400ms apart, or the
	 * double-pet window turns them into pets. */
	const envCtx = makeEnv();
	envCtx.ready();
	const CTX = envCtx.sandbox.__dshWhale;
	const ctxMenuEl = () => envCtx.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-menu') || null;
	const ctxPanelEl = () => envCtx.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-wardrobe') || null;
	const rctx = (x, y) => ({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
	const singleRClick = async (x, y) => {
		await sleep(450); /* outside the double-pet window */
		envCtx.whale._fire('contextmenu', rctx(x, y));
	};
	assert.ok(!CTX.ctxMenuOpen(), 'no menu before any right-click');
	/* single right-click opens the menu with the mood header + 5 items */
	await singleRClick(100, 100);
	assert.ok(CTX.ctxMenuOpen(), 'menu opens on right-click');
	const mEl = ctxMenuEl();
	assert.ok(mEl, 'menu element exists');
	const mItems = mEl.children.filter((c) => c.className === 'dsh-whale-menu-item').map((c) => c.textContent);
	assert.strictEqual(mItems.length, 6, `6 menu items: ${mItems.join(' | ')}`);
	assert.ok(mEl.children.some((c) => c.className === 'dsh-whale-menu-sep'), 'group separator present (#4)');
	assert.ok(mItems[0].includes('提醒'), 'reminder first in the quick group (#4)');
	assert.ok(mItems[1].includes('声音'), 'sound toggle present');
	assert.ok(mItems[2].includes('使用说明'), 'manual entry present (renamed from 操作说明)');
	assert.ok(mItems[3].includes('装扮'), 'wardrobe entry present');
	assert.ok(mItems[4].includes('历史'), 'history entry present');
	assert.ok(mItems[5].includes('设置'), 'settings entry present');
	const mHead = mEl.children.find((c) => c.className === 'dsh-whale-menu-head');
	assert.ok(mHead.textContent.includes('🐳') && mHead.textContent.includes('待命中'), `mood header: ${mHead.textContent}`);
	/* clicking outside closes the menu */
	envCtx.docFire('pointerdown', { button: 0, target: envCtx.sandbox.document.body });
	assert.ok(!CTX.ctxMenuOpen(), 'outside click closes the menu');
	/* sound toggle: mutes, persists, silences dings */
	await singleRClick(100, 100);
	ctxMenuEl().children.find((c) => c.className === 'dsh-whale-menu-item' && c.textContent.includes('声音'))
		._fire('click', { stopPropagation() {} });
	assert.ok(CTX.soundMuted(), 'sound muted via menu');
	assert.strictEqual(JSON.parse(envCtx.sandbox.localStorage.getItem('dsh-whale:sound')).data, 'off', 'sound state persisted (v1 envelope)');
	assert.ok(!CTX.ctxMenuOpen(), 'menu closed after picking sound');
	CTX.playDing('done');
	await sleep(60);
	assert.strictEqual(envCtx.audioStarts().length, 0, 'muted: no ding');
	/* the label flips on the next open */
	await singleRClick(100, 100);
	assert.ok(ctxMenuEl().children.some((c) => c.className === 'dsh-whale-menu-item' && c.textContent.includes('声音：关')),
		'label shows the muted state');
	/* wardrobe panel: gear progress + affection row */
	ctxMenuEl().children.find((c) => c.className === 'dsh-whale-menu-item' && c.textContent.includes('装扮'))
		._fire('click', { stopPropagation() {} });
	assert.ok(CTX.panelOpen(), 'wardrobe panel opens');
	const wEl = ctxPanelEl();
	assert.ok(wEl.textContent.includes('小咖啡杯') && wEl.textContent.includes('还差'), 'gear progress rows');
	assert.ok(wEl.textContent.includes('好感度') && wEl.textContent.includes('× 0'), `affection row: ${wEl.textContent}`);
	assert.ok(wEl.children.some((c) => c.className === 'dsh-whale-panel-foot'), 'wardrobe has the shared footer');
	assert.ok(wEl.textContent.includes('← 返回菜单'), 'wardrobe back goes to the MENU (panel entered from menu)');
	const wFoot = wEl.children.find((c) => c.className === 'dsh-whale-panel-foot');
	wFoot.children.find((c) => c.className === 'dsh-whale-wardrobe-close')._fire('click', { stopPropagation() {} });
	assert.ok(!CTX.panelOpen(), 'wardrobe closes via its close button');
	/* 📖 使用说明: the FULL manual in the side-drawer slot (was an 8-line
	 * gesture cheat sheet in the floating-panel slot; moved out of settings,
	 * renamed from 操作说明 — user request 2026-09-04) */
	await singleRClick(100, 100);
	ctxMenuEl().children.find((c) => c.className === 'dsh-whale-menu-item' && c.textContent.includes('使用说明'))
		._fire('click', { stopPropagation() {} });
	assert.ok(CTX.drawerOpen(), 'manual drawer opens');
	const hEl = CTX.drawerEl();
	assert.strictEqual(hEl.className, 'dsh-whale-history dsh-whale-manual', 'manual uses the wide drawer class');
	const hListM = hEl.children.find((c) => c.className === 'dsh-whale-history-list');
	assert.ok(hListM, 'manual list is INSIDE the drawer (content actually renders)');
	assert.ok(hEl.textContent.includes('我是什么'), 'what-it-is section');
	assert.ok(hEl.textContent.includes('通知一览'), 'notifications section');
	assert.ok(hEl.textContent.includes('完成了'), 'completion explained');
	assert.ok(hEl.textContent.includes('需要你选择'), 'question explained');
	assert.ok(hEl.textContent.includes('需要你审核'), 'approval explained');
	const hRows = hListM.children.filter((c) => c.className === 'dsh-whale-help-row');
	assert.strictEqual(hRows.length, 8, 'eight gesture rows');
	assert.strictEqual(hRows[0].children[0].textContent, '1', 'row 1 badge number');
	assert.ok(hRows[0].children[0].className.includes('dsh-whale-help-num'), 'badge element class');
	assert.ok(hRows[7].children[1].textContent.includes('摸摸头'), 'last gesture intact');
	assert.ok(hEl.textContent.includes('设置项详解'), 'settings section present');
	assert.ok(hEl.textContent.includes('免打扰'), 'dnd explained');
	assert.ok(hEl.textContent.includes('任务周报'), 'weekly report explained');
	assert.ok(hEl.textContent.includes('调试模式'), 'debug mode explained (renamed from 诊断模式, #15)');
	assert.ok(hEl.textContent.includes('运行状态'), 'run-status row explained (#14)');
	assert.ok(hEl.textContent.includes('快速上手'), 'quick-start section tops the manual (newcomer onboarding)');
	assert.ok(hEl.textContent.includes('常见问题'), 'FAQ section present');
	assert.ok(hEl.textContent.includes('红标'), 'badge semantics explained');
	assert.ok(hEl.textContent.includes('好感'), 'companion section present');
	assert.ok(hEl.children.some((c) => c.className === 'dsh-whale-panel-foot'), 'manual has the shared footer');
	assert.ok(hEl.textContent.includes('← 返回菜单'), 'manual back goes to the MENU');
	const hFoot = hEl.children.find((c) => c.className === 'dsh-whale-panel-foot');
	hFoot.children.find((c) => c.className.indexOf('dsh-whale-panel-back') >= 0)._fire('click', { stopPropagation() {} });
	await sleep(30);
	assert.ok(CTX.ctxMenuOpen(), 'manual back button reopens the menu');
	assert.ok(!CTX.drawerOpen(), 'manual back closed the drawer');
	/* double right-click pets: +1 affection, reaction line, hearts, bounce */
	assert.strictEqual(CTX.affection(), 0, 'affection starts at 0');
	await singleRClick(200, 200); /* first click: opens the menu */
	envCtx.whale._fire('contextmenu', rctx(200, 200)); /* <400ms later: a double -> pet */
	assert.strictEqual(CTX.affection(), 1, 'double right-click pets: +1 affection');
	const petBubble = envCtx.bubble().textContent;
	assert.ok(petBubble.includes('摸') || petBubble.includes('舒服') || petBubble.includes('上班') || petBubble.includes('变笨'),
		`pet line: ${petBubble}`);
	assert.ok(envCtx.whale.classList.contains('dsh-whale-pet'), 'pet bounce class on');
	assert.ok(envCtx.sandbox.localStorage.getItem('dsh-whale:affection').includes('"value":1'), 'affection persisted');
	const hearts = () => (envCtx.rippleLayer() ? envCtx.rippleLayer().children.filter((c) => c.className === 'dsh-whale-heart') : []);
	assert.ok(hearts().length > 0, 'hearts spawned');
	assert.ok(!CTX.ctxMenuOpen(), 'the double right-click closed the open menu');
	await sleep(800);
	assert.ok(!envCtx.whale.classList.contains('dsh-whale-pet'), 'bounce class removed after the animation');
	/* single right-clicks further apart open the menu again (no accidental pet) */
	await singleRClick(300, 300);
	assert.ok(CTX.ctxMenuOpen(), 'later single right-click opens the menu again');
	/* edge flip: near the right/bottom edge the menu flips left/up */
	await singleRClick(1190, 790);
	const mEdge = ctxMenuEl();
	const edgeLeft = parseInt(mEdge.style.left, 10);
	const edgeTop = parseInt(mEdge.style.top, 10);
	assert.ok(edgeLeft < 1190, `flipped left: ${edgeLeft}`);
	assert.ok(edgeTop < 790, `flipped up: ${edgeTop}`);
	envCtx.docFire('pointerdown', { button: 0, target: envCtx.sandbox.document.body });
	assert.ok(!CTX.ctxMenuOpen(), 'menu closed after the edge test');
	CTX.setSoundMuted(false);

	/* 35b. persisted state survives a reload: mute + affection are read
	 * back from localStorage when the script starts fresh */
	const envMute2 = makeEnv([
		['dsh-whale:sound', 'off'],
		['dsh-whale:affection', '{"value":12}'],
	]);
	envMute2.ready();
	const M2 = envMute2.sandbox.__dshWhale;
	assert.strictEqual(M2.soundMuted(), true, 'mute restored after a reload');
	assert.strictEqual(M2.affection(), 12, 'affection restored after a reload');
	M2.playDing('done');
	M2.playDing('attention');
	await sleep(60);
	assert.strictEqual(envMute2.audioStarts().length, 0, 'still silent after a reload');
	/* and the mute can be lifted again from the restored state */
	M2.setSoundMuted(false);
	M2.playDing('done');
	await sleep(60);
	assert.ok(envMute2.audioStarts().length > 0, 'unmuting works after a reload');
	assert.strictEqual(JSON.parse(envMute2.sandbox.localStorage.getItem('dsh-whale:sound')).data, 'on', 'unmute persisted (v1 envelope)');

	/* 36. double-click the notification BUBBLE jumps to its conversation AND
	 * marks that report read: the badge drops by one and the notification
	 * leaves the queue. The whale's own double-click (swim home) is NOT
	 * triggered; drifted double-clicks still jump; bubbles without a session
	 * do not jump; a FAILED jump keeps the report unread; a missing hook
	 * gets a friendly hint. */
	const envJump = makeEnv();
	envJump.ready();
	const JP = envJump.sandbox.__dshWhale;
	const muxpJp = (payload) => JP.handleMuxPayload(payload);
	const opened = [];
	envJump.sandbox.__dshOpenSession = (id) => { opened.push(id); };
	envJump.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	JP._setHoldMs(10);
	/* a main-session completion report lands in the bubble */
	muxpJp({ type: 'session/projection', sessionId: 'session-jp1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpJp({ type: 'session/projection', sessionId: 'session-jp1', key: 'title', value: '跳转测试', seq: 1 });
	muxpJp({ type: 'session/event', sessionId: 'session-jp1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpJp({ type: 'session/event', sessionId: 'session-jp1', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	assert.ok(envJump.bubble().textContent.includes('完成了'), 'completion bubble showing');
	assert.strictEqual(JP.unreadCount(), 1, 'one unread before the jump (end only; start stays out)');
	envJump.bubble()._fire('dblclick', { stopPropagation() {} });
	assert.deepStrictEqual(opened, ['session-jp1'], 'double-click jumps to the report session');
	assert.strictEqual(JP.unreadCount(), 0, 'badge drops to zero after the jump');
	assert.strictEqual(JP.reportQueue().length, 0, 'the jumped report left the queue');
	assert.ok(!JP.swimState(), 'whale double-click (swim) NOT triggered by the bubble');
	/* a double-click whose presses DRIFT off the bubble onto the whale
	 * (dblclick target = whale, position still over the bubble) must still
	 * JUMP — the bubble is an independent surface, never the whale's body */
	envJump.whale.style.top = '100px';
	envJump.whale.style.left = '100px';
	/* bubble rect estimate: left 108..196, top 0..88 (inBubbleRect fallback) */
	envJump.whale._fire('dblclick', { target: envJump.whale, clientX: 150, clientY: 40 });
	assert.deepStrictEqual(opened, ['session-jp1', 'session-jp1'], 'drifted double-click still jumps');
	assert.ok(!JP.swimState(), 'drifted double-click does NOT swim');
	assert.strictEqual(JP.unreadCount(), 0, 'a second jump has nothing new to read');
	/* the queue is empty (starts stay out): a click replays nothing */
	const ptJ = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
	envJump.whale._fire('pointerdown', ptJ(100, 100));
	envJump.whale._fire('pointerup', ptJ(100, 100));
	await sleep(320);
	assert.strictEqual(JP.unreadCount(), 0, 'click on an empty queue replays nothing');
	assert.strictEqual(JP.reportQueue().length, 0, 'queue stays empty');
	/* an idle summary bubble has NO session: no jump, friendly hint
	 * (the idle line is random — only assert it is NOT a report) */
	envJump.whale._fire('pointerdown', ptJ(100, 100));
	envJump.whale._fire('pointerup', ptJ(100, 100));
	await sleep(320); /* queue is empty -> click summary */
	assert.ok(!envJump.bubble().textContent.includes('任务「'),
		`summary bubble (not a report): ${envJump.bubble().textContent}`);
	const openedBefore = opened.length;
	envJump.bubble()._fire('dblclick', { stopPropagation() {} });
	assert.strictEqual(opened.length, openedBefore, 'summary bubble does not jump');
	assert.ok(envJump.bubble().textContent.includes('没有对应的对话'), 'no-session hint shown');
	/* a FAILED jump (opener throws) keeps the report UNREAD */
	const envFailJump = makeEnv();
	envFailJump.ready();
	const FL2 = envFailJump.sandbox.__dshWhale;
	const muxpF2 = (payload) => FL2.handleMuxPayload(payload);
	envFailJump.sandbox.__dshOpenSession = () => { throw new Error('unknown session'); };
	envFailJump.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	FL2._setHoldMs(10);
	muxpF2({ type: 'session/projection', sessionId: 'session-f2', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpF2({ type: 'session/projection', sessionId: 'session-f2', key: 'title', value: '失败跳转', seq: 1 });
	muxpF2({ type: 'session/event', sessionId: 'session-f2', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpF2({ type: 'session/event', sessionId: 'session-f2', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	envFailJump.bubble()._fire('dblclick', { stopPropagation() {} });
	assert.ok(envFailJump.bubble().textContent.includes('找不到'), 'failed jump hint shown');
	assert.strictEqual(FL2.unreadCount(), 1, 'failed jump keeps the end report unread');
	/* a missing hook gets a friendly hint instead of a crash */
	const envNoHook = makeEnv();
	envNoHook.ready();
	const NH = envNoHook.sandbox.__dshWhale;
	const muxpNh = (payload) => NH.handleMuxPayload(payload);
	envNoHook.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	NH._setHoldMs(10);
	muxpNh({ type: 'session/projection', sessionId: 'session-nh1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpNh({ type: 'session/projection', sessionId: 'session-nh1', key: 'title', value: '无钩子测试', seq: 1 });
	muxpNh({ type: 'session/event', sessionId: 'session-nh1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpNh({ type: 'session/event', sessionId: 'session-nh1', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	envNoHook.bubble()._fire('dblclick', { stopPropagation() {} });
	assert.ok(envNoHook.bubble().textContent.includes('刷新页面'), `missing-hook hint: ${envNoHook.bubble().textContent}`);
	JP._setHoldMs(null);
	/* LAST: a genuine whale-body double-click (position OUTSIDE the bubble)
	 * still swims home — the two surfaces stay independent */
	envJump.whale._fire('dblclick', { target: envJump.whale, clientX: 150, clientY: 150 });
	assert.ok(JP.swimState(), 'whale-body double-click still swims home');

	/* 36b. turn/end REASON distinguishes failure/success:
	 * reason.kind === "error"   -> 任务失败了 + fail sound, NOT counted for gear
	 * reason.kind === "max-tokens" -> 被截断了 + done sound, counted
	 * no reason (legacy)        -> 完成了 + done sound, counted */
	const envFailDing = makeEnv();
	envFailDing.ready();
	const FB = envFailDing.sandbox.__dshWhale;
	const muxpFb = (payload) => FB.handleMuxPayload(payload);
	envFailDing.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	FB._setHoldMs(10);
	muxpFb({ type: 'session/projection', sessionId: 'session-fb1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpFb({ type: 'session/projection', sessionId: 'session-fb1', key: 'title', value: '失败检测', seq: 1 });
	await sleep(30); /* label/title fetch settles */
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/end', seq: 2, time: 1, data: { reason: { kind: 'error' } } } });
	assert.ok(envFailDing.bubble().textContent.includes('失败了'), `failure bubble: ${envFailDing.bubble().textContent}`);
	assert.strictEqual(envFailDing.bubble().textContent.includes('完成了'), false, 'failure must NOT say 完成');
	assert.strictEqual(FB.gearStats.tasksDone, 0, 'failed task does NOT count toward gear');
	/* the fail ding is the low descending pair, not the bell */
	await sleep(80);
	const failStarts = envFailDing.audioStarts().map(Math.round);
	assert.deepStrictEqual(failStarts.slice(0, 2), [550, 415], `fail tones: ${JSON.stringify(failStarts)}`);
	/* max-tokens: truncated wording + done sound + counts for gear */
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/start', seq: 3, time: 2, data: {} } });
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/end', seq: 4, time: 3, data: { reason: { kind: 'max-tokens' } } } });
	assert.ok(envFailDing.bubble().textContent.includes('被截断'), `max-tokens bubble: ${envFailDing.bubble().textContent}`);
	assert.strictEqual(FB.gearStats.tasksDone, 1, 'truncated task still counts');
	/* legacy empty data -> completed as before */
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/start', seq: 5, time: 4, data: {} } });
	muxpFb({ type: 'session/event', sessionId: 'session-fb1', event: { type: 'turn/end', seq: 6, time: 5, data: {} } });
	assert.ok(envFailDing.bubble().textContent.includes('完成了'), 'legacy empty-data end still says 完成');
	assert.strictEqual(FB.gearStats.tasksDone, 2, 'legacy completion counts');
	FB._setHoldMs(null);

	/* 37. storage versioning: legacy v0 shapes migrate to the v1 envelope
	 * on read, pre-daily stats never revive an expired counter, corrupted
	 * entries degrade to defaults, and privacy-mode writes fail silently */
	const envV0pos = makeEnv([['dsh-whale:pos', JSON.stringify({ x: 80, y: 40 })]]);
	envV0pos.ready();
	assert.strictEqual(envV0pos.whale.style.left, '80px', 'v0 pos applied on load');
	assert.strictEqual(JSON.parse(envV0pos.sandbox.localStorage.getItem('dsh-whale:pos')).v, 1, 'v0 pos migrated to the v1 envelope');
	const envV0snd = makeEnv([['dsh-whale:sound', 'off']]);
	envV0snd.ready();
	assert.strictEqual(envV0snd.sandbox.__dshWhale.soundMuted(), true, 'v0 sound restored');
	assert.strictEqual(JSON.parse(envV0snd.sandbox.localStorage.getItem('dsh-whale:sound')).data, 'off', 'v0 sound migrated');
	const envV0aff = makeEnv([['dsh-whale:affection', JSON.stringify({ value: 12 })]]);
	envV0aff.ready();
	assert.strictEqual(envV0aff.sandbox.__dshWhale.affection(), 12, 'v0 affection restored');
	/* the pre-daily stats shape (no date) must NOT revive an expired count */
	const envV0stat = makeEnv([['dsh-whale:stats', JSON.stringify({ tasksDone: 15 })]]);
	envV0stat.ready();
	assert.strictEqual(envV0stat.sandbox.__dshWhale.gearStats.tasksDone, 0, 'pre-daily stats do not revive the counter');
	/* corrupted entries degrade to defaults without crashing */
	const envBad = makeEnv([['dsh-whale:affection', '{oops'], ['dsh-whale:pos', '{oops'], ['dsh-whale:stats', '{oops']]);
	envBad.ready();
	assert.strictEqual(envBad.sandbox.__dshWhale.affection(), 0, 'corrupted affection defaults to 0');
	assert.strictEqual(envBad.sandbox.__dshWhale.gearStats.tasksDone, 0, 'corrupted stats defaults to 0');
	/* privacy mode: a throwing setItem is swallowed, no crash */
	const envPriv = makeEnv();
	envPriv.ready();
	envPriv.sandbox.localStorage = {
		getItem: () => null,
		setItem: () => { throw new Error('QuotaExceededError'); },
		removeItem: () => {},
	};
	envPriv.sandbox.__dshWhale.setSoundMuted(true); /* safeSet(sound) */
	envPriv.sandbox.__dshWhale.petWhale();         /* saveAffection -> safeSet(affection) */
	assert.ok(true, 'privacy-mode writes do not throw');

	/* 38. task history: reportTurn records done/fail/max-tokens entries
	 * (newest first, cap 50, main sessions only, v1 persisted); the drawer
	 * renders them and a row click jumps via the session opener; a missing
	 * hook degrades with a hint; v0 bare arrays migrate */
	const envHist = makeEnv();
	envHist.ready();
	const HS = envHist.sandbox.__dshWhale;
	const muxpHs = (payload) => HS.handleMuxPayload(payload);
	const histOpened = [];
	envHist.sandbox.__dshOpenSession = (id, atMs) => { histOpened.push([id, atMs]); };
	envHist.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	HS._setHoldMs(10);
	muxpHs({ type: 'session/projection', sessionId: 'session-h1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpHs({ type: 'session/projection', sessionId: 'session-h1', key: 'title', value: '历史任务A', seq: 1 });
	await sleep(30);
	muxpHs({ type: 'session/event', sessionId: 'session-h1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpHs({ type: 'session/event', sessionId: 'session-h1', event: { type: 'turn/end', seq: 2, time: 1111, data: { reason: { kind: 'error' } } } });      /* fail */
	muxpHs({ type: 'session/event', sessionId: 'session-h1', event: { type: 'turn/end', seq: 3, time: 2222, data: {} } });                                    /* done */
	muxpHs({ type: 'session/event', sessionId: 'session-h1', event: { type: 'turn/end', seq: 4, time: 3333, data: { reason: { kind: 'max-tokens' } } } });    /* max-tokens */
	/* user-stopped turn (live-verified reason kind "aborted"): neutral record,
	 * NO gear credit, no completion bell */
	const gearBeforeAb = HS.gearStats.tasksDone;
	muxpHs({ type: 'session/event', sessionId: 'session-h1', event: { type: 'turn/end', seq: 5, time: 6666, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } } });
	assert.strictEqual(HS.gearStats.tasksDone, gearBeforeAb, 'aborted turn does not count toward the gear');
	/* approval + question requests are recorded too (any session), carrying
	 * their frame time as the jump anchor */
	muxpHs({ type: 'approval/requested', sessionId: 'session-h1', toolName: 'pwsh', time: 4444 });
	muxpHs({ type: 'question/requested', sessionId: 'session-h1', questions: [{ question: '选择部署方式?' }], time: 5555 });
	assert.strictEqual(HS.historyList().length, 6, 'six history records (fail/done/max-tokens/killed/approval/question)');
	assert.strictEqual(HS.historyList()[0].kind, 'question', 'newest = question');
	assert.strictEqual(HS.historyList()[1].kind, 'approval', 'second = approval');
	assert.strictEqual(HS.historyList()[2].kind, 'killed', 'third = killed (user-stopped)');
	const kindsHs = HS.historyList().map((h) => h.kind);
	assert.ok(kindsHs.includes('done') && kindsHs.includes('fail') && kindsHs.includes('max-tokens'),
		'task results still recorded');
	/* every record carries endTime (the mux frame time) so a drawer click can
	 * page the target conversation back to that moment */
	const endByKind = {};
	HS.historyList().forEach((h) => { endByKind[h.kind] = h.endTime; });
	assert.strictEqual(endByKind.fail, 1111, 'fail record keeps the turn/end frame time');
	assert.strictEqual(endByKind.done, 2222, 'done record keeps the turn/end frame time');
	assert.strictEqual(endByKind['max-tokens'], 3333, 'max-tokens record keeps the turn/end frame time');
	assert.strictEqual(endByKind.approval, 4444, 'approval record keeps the frame time');
	assert.strictEqual(endByKind.question, 5555, 'question record keeps the frame time');
	assert.strictEqual(endByKind.killed, 6666, 'killed record keeps the turn/end frame time');
	assert.strictEqual(JSON.parse(envHist.sandbox.localStorage.getItem('dsh-whale:history')).v, 1, 'history persisted as v1 envelope');
	const hPanel = () => envHist.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-history') || null;
	HS.openHistory();
	const hp = hPanel();
	assert.ok(hp && hp.classList.contains('show'), 'history drawer opens');
	const hList = hp.children.find((c) => c.className === 'dsh-whale-history-list');
	assert.ok(hList, 'scrollable list container present');
	const rows = () => (hList ? hList.children.filter((c) => c.className === 'dsh-whale-history-row') : []);
	assert.strictEqual(rows().length, 6, 'six rendered rows');
	const iconCls = rows().map((r) => r.children[0].className);
	assert.ok(iconCls.some((c) => c.includes('history-icon-question')), 'blue ? badge for question');
	assert.ok(iconCls.some((c) => c.includes('history-icon-approval')), 'yellow ? badge for approval');
	assert.ok(iconCls.some((c) => c.includes('history-icon-done')), 'green check for done');
	assert.ok(iconCls.some((c) => c.includes('history-icon-fail')), 'red cross for fail');
	assert.ok(iconCls.some((c) => c.includes('history-icon-killed')), 'blue ⏹ badge for killed (user-stopped, distinct from truncation)');
	assert.ok(iconCls.some((c) => c.includes('history-icon-cut')), 'grey ⏹ badge for max-tokens truncation');
	assert.ok(hp.textContent.includes('历史任务A'), 'row shows the task title');
	assert.ok(hp.children.some((c) => c.className === 'dsh-whale-panel-foot'), 'history drawer has the shared footer');
	assert.ok(hp.textContent.includes('← 返回菜单'), 'history back goes to the MENU (09-05 用户反馈)');
	/* row time carries the DATE, not just HH:MM — tasks pile up across days */
	assert.ok(/\d{1,2}月\d{1,2}日 \d{2}:\d{2}/.test(hp.textContent), `row time shows M月D日 HH:MM: ${rows()[0].textContent}`);
	/* search with no matches shows the empty hint (a `shown` hoist bug used
	 * to make this branch unreachable) */
	const searchEl = hp.children.find((c) => c.className === 'dsh-whale-history-search');
	searchEl.value = '绝不存在的任务名';
	searchEl._fire('input', {});
	assert.strictEqual(rows().length, 0, 'bogus search renders no rows');
	assert.ok(hList.children.some((c) => c.textContent === '没有匹配的记录 🔍'), 'no-match hint shown');
	searchEl.value = '';
	searchEl._fire('input', {});
	assert.strictEqual(rows().length, 6, 'clearing the search restores all rows');
	rows()[0]._fire('click', { stopPropagation() {} });
	assert.deepStrictEqual(histOpened, [['session-h1', 5555]],
		'row click jumps to that session passing endTime as the back-page anchor');
	assert.ok(!hp.classList.contains('show') || !hPanel(), 'drawer closed after the jump');
	/* cap 50: pushing 60 keeps only the newest 50 */
	for (let i = 0; i < 60; i++) HS.pushHistory({ title: 'x', sessionId: 's-' + i, kind: 'done', at: i });
	assert.strictEqual(HS.historyList().length, 50, 'history capped at 50');
	assert.strictEqual(HS.historyList()[0].title, 'x', 'newest kept');
	/* a missing hook degrades with a hint instead of crashing */
	const envHistNoHook = makeEnv();
	envHistNoHook.ready();
	const NHist = envHistNoHook.sandbox.__dshWhale;
	NHist.pushHistory({ title: 'a', sessionId: 's1', kind: 'done', at: 1 });
	NHist.openHistory();
	const hp2 = envHistNoHook.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-history');
	const hList2 = (hp2 || {}).children ? hp2.children.find((c) => c.className === 'dsh-whale-history-list') : null;
	const row2 = hList2 ? hList2.children.filter((c) => c.className === 'dsh-whale-history-row') : [];
	if (row2.length > 0) row2[0]._fire('click', { stopPropagation() {} });
	assert.ok(true, 'history row click without hook does not throw');
	/* hook missing but the conversation IS in the app sidebar: the click falls
	 * back to native sidebar navigation */
	const envHistSide = makeEnv();
	envHistSide.ready();
	const SH = envHistSide.sandbox.__dshWhale;
	const sideRow = envHistSide.sandbox.document.createElement('div');
	sideRow.className = 'YDXeBa_sessionRow';
	sideRow._text = '侧栏任务A 3小时';
	let sideClicked = false;
	sideRow.click = function () { sideClicked = true; };
	envHistSide.sandbox.document.body.appendChild(sideRow);
	SH.pushHistory({ title: '侧栏任务A', sessionId: 's-side', kind: 'done', at: 5 });
	SH.openHistory();
	const hp3 = envHistSide.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-history');
	const row3 = hp3.children.find((c) => c.className === 'dsh-whale-history-list').children.filter((c) => c.className === 'dsh-whale-history-row')[0];
	row3._fire('click', { stopPropagation() {} });
	assert.ok(sideClicked, 'missing hook falls back to sidebar navigation');
	/* a legacy record without endTime anchors the jump with its `at` time */
	const envHistAt = makeEnv();
	envHistAt.ready();
	const AH = envHistAt.sandbox.__dshWhale;
	const openedAt = [];
	envHistAt.sandbox.__dshOpenSession = (id, atMs) => { openedAt.push([id, atMs]); };
	AH.pushHistory({ title: '旧记录', sessionId: 's-old2', kind: 'done', at: 777777 });
	AH.openHistory();
	const hp4 = envHistAt.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-history');
	const row4 = hp4.children.find((c) => c.className === 'dsh-whale-history-list').children.filter((c) => c.className === 'dsh-whale-history-row')[0];
	row4._fire('click', { stopPropagation() {} });
	assert.deepStrictEqual(openedAt, [['s-old2', 777777]], 'legacy record without endTime anchors with its at time');
	/* regression (real-mouse jump bug): the global click-away used to close
	 * the drawer on POINTERDOWN, detaching the row before its click fired —
	 * a pointerdown on a row must keep the drawer open; outside still closes */
	const envHistPd = makeEnv();
	envHistPd.ready();
	const PH = envHistPd.sandbox.__dshWhale;
	PH.pushHistory({ title: 'pd', sessionId: 's-pd', kind: 'done', at: 1 });
	PH.openHistory();
	const hp5 = envHistPd.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-history');
	const row5 = hp5.children.find((c) => c.className === 'dsh-whale-history-list').children.filter((c) => c.className === 'dsh-whale-history-row')[0];
	envHistPd.sandbox.document._fire('pointerdown', { button: 0, target: row5 });
	assert.ok(hp5.classList.contains('show'), 'pointerdown on a history row keeps the drawer open');
	envHistPd.sandbox.document._fire('pointerdown', { button: 0, target: envHistPd.sandbox.document.body });
	assert.ok(!hp5.classList.contains('show'), 'pointerdown outside the drawer still closes it');
	/* v0 bare array migrates to v1 envelope */
	const envHistV0 = makeEnv([['dsh-whale:history', JSON.stringify([{ title: 'old', sessionId: 's-old', kind: 'done', at: 1 }])]]);
	envHistV0.ready();
	assert.strictEqual(envHistV0.sandbox.__dshWhale.historyList().length, 1, 'v0 history array restored');
	assert.strictEqual(JSON.parse(envHistV0.sandbox.localStorage.getItem('dsh-whale:history')).v, 1, 'v0 history migrated to v1');
	HS._setHoldMs(null);

	/* 39. failure recall: a recent failure appends a "上次任务失败了" hint to
	 * the click summary within CONFIG.recentFailWindowMs; after the window the
	 * hint is gone; a success-only history adds nothing */
	const envRecall = makeEnv();
	envRecall.ready();
	const RC = envRecall.sandbox.__dshWhale;
	const muxpRc = (payload) => RC.handleMuxPayload(payload);
	envRecall.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	RC._setHoldMs(10);
	muxpRc({ type: 'session/projection', sessionId: 'session-rc1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpRc({ type: 'session/projection', sessionId: 'session-rc1', key: 'title', value: '失败回忆', seq: 1 });
	await sleep(30);
	/* a failing turn */
	muxpRc({ type: 'session/event', sessionId: 'session-rc1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	muxpRc({ type: 'session/event', sessionId: 'session-rc1', event: { type: 'turn/end', seq: 2, time: 1, data: { reason: { kind: 'error' } } } });
	assert.ok(envRecall.bubble().textContent.includes('双击通知可回到该对话'),
		`failure notice carries the recall hint: ${envRecall.bubble().textContent}`);
	/* clicking the whale: reports are read newest-first (开工+失败 = 2 items),
	 * the third click hits the summary which must carry the recollect line */
	const ptR = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
	const clickWhale = async () => {
		envRecall.whale._fire('pointerdown', ptR(100, 100));
		envRecall.whale._fire('pointerup', ptR(100, 100));
		await sleep(360);
	};
	await clickWhale(); /* reads the fail report (asserted above) */
	await clickWhale(); /* reads the start report */
	await clickWhale(); /* queue empty -> summary */
	assert.ok(envRecall.bubble().textContent.includes('上次任务失败了'),
		`recall hint shown: ${envRecall.bubble().textContent}`);
	/* shrink the window to zero: the hint must disappear */
	RC.applyConfig({ recentFailWindowMs: 0 });
	await clickWhale();
	assert.ok(!envRecall.bubble().textContent.includes('上次任务失败了'),
		'hint gone after the window expires');
	/* a success-only turn adds start+done reports; drain them then check */
	muxpRc({ type: 'session/event', sessionId: 'session-rc1', event: { type: 'turn/start', seq: 3, time: 2, data: {} } });
	muxpRc({ type: 'session/event', sessionId: 'session-rc1', event: { type: 'turn/end', seq: 4, time: 3, data: {} } });
	await clickWhale(); /* done report */
	await clickWhale(); /* start report */
	await clickWhale(); /* summary */
	assert.ok(!envRecall.bubble().textContent.includes('上次任务失败了'),
		'success-only click has no failure hint');
	RC._setHoldMs(null);

	/* 40. tool-stuck watchdog: a pending tool with NO running job flags after
	 * CONFIG.toolStuckMs; a running job suppresses the flag (slow-job
	 * immunity); tool/result and turn/end clear it. Elapsed time is faked by
	 * back-dating the toolSlot entry (toolStuckMs min is 3000 in CONFIG). */
	const envStk = makeEnv();
	envStk.ready();
	const SK = envStk.sandbox.__dshWhale;
	const muxpStk = (payload) => SK.handleMuxPayload(payload);
	envStk.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	const statusStk = () => envStk.whale.children.find((c) => c.className === "dsh-whale-status") || null;
	muxpStk({ type: "session/projection", sessionId: "session-st1", key: "subagentTiming", value: { settledMs: 0 } });
	muxpStk({ type: "session/projection", sessionId: "session-st1", key: "title", value: "卡顿检测", seq: 1 });
	/* a tool call with NO running job becomes stuck after the threshold */
	muxpStk({ type: "session/event", sessionId: "session-st1", event: { type: "tool/call", seq: 1, time: 1, data: { callId: "c1", name: "pwsh" } } });
	SK.toolSlot.get("c1").at = Date.now() - 30000; /* back-date 30s */
	SK.scanStuckTools();
	const st1el = statusStk();
	assert.ok(st1el && st1el.classList.contains("dsh-whale-status-stuck"), "pending tool with no job flags stuck");
	assert.ok(st1el.textContent.includes("工具运行中"), "stuck text: " + st1el.textContent);
	/* tool/result clears it */
	muxpStk({ type: "session/event", sessionId: "session-st1", event: { type: "tool/result", seq: 2, time: 2, data: { callId: "c1" } } });
	SK.scanStuckTools();
	assert.ok(!statusStk() || !statusStk().classList.contains("dsh-whale-status-stuck"), "tool/result clears stuck");
	/* a running job suppresses the flag even past the threshold (slow-job
	 * immunity — a Start-Sleep 30 must never look stuck) */
	muxpStk({ type: "session/event", sessionId: "session-st1", event: { type: "tool/call", seq: 3, time: 3, data: { callId: "c2", name: "pwsh" } } });
	muxpStk({ type: "session/jobs", sessionId: "session-st1", jobs: [{ id: "j1", kind: "bash", label: "sleep 30", status: "running", startedAt: 1 }] });
	SK.toolSlot.get("c2").at = Date.now() - 30000; /* back-date 30s */
	SK.scanStuckTools();
	assert.ok(!statusStk() || !statusStk().classList.contains("dsh-whale-status-stuck"), "running job suppresses stuck (slow-job immunity)");
	/* turn/end clears everything for this session */
	muxpStk({ type: "session/event", sessionId: "session-st1", event: { type: "turn/start", seq: 4, time: 4, data: {} } });
	muxpStk({ type: "session/event", sessionId: "session-st1", event: { type: "turn/end", seq: 5, time: 5, data: {} } });
	SK.scanStuckTools();
	assert.ok(!statusStk() || !statusStk().classList.contains("dsh-whale-status-stuck"), "turn/end clears stuck");

	/* 41. settings: default values locked; toggling notify-on-start silences
	 * only the start report (end still reports); threshold/volume cycles
	 * persist via the v1 envelope and restore on a fresh load */
	const envCfg = makeEnv();
	envCfg.ready();
	const CG = envCfg.sandbox.__dshWhale;
	const muxpCg = (payload) => CG.handleMuxPayload(payload);
	envCfg.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	CG._setHoldMs(10);
	assert.strictEqual(CG.CONFIG.notifyOnStart, true, 'default: notify-on-start ON (contract unchanged)');
	assert.strictEqual(CG.CONFIG.volume, 1, 'default volume 100%');
	assert.strictEqual(CG.CONFIG.toolStuckMs, 15000, 'default tool-stuck threshold 15s (slow tools must not nag at 8s)');
	/* M5.1: version seam — semver-shaped, surfaced in the help panel */
	assert.ok(/^\d+\.\d+\.\d+$/.test(CG.version || ''), `version seam semver: ${CG.version}`);
	/* toggle via applyConfig (what the settings panel does) and persist */
	assert.ok(CG.applyConfig({ notifyOnStart: false }), 'toggle accepted');
	CG.saveConfig();
	assert.strictEqual(JSON.parse(envCfg.sandbox.localStorage.getItem('dsh-whale:config')).data.notifyOnStart, false, 'config persisted (v1 envelope)');
	/* with starts muted, turn/start reports nothing but turn/end still does */
	muxpCg({ type: 'session/projection', sessionId: 'session-cg1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpCg({ type: 'session/projection', sessionId: 'session-cg1', key: 'title', value: '配置会话', seq: 1 });
	await sleep(30);
	muxpCg({ type: 'session/event', sessionId: 'session-cg1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	assert.strictEqual(envCfg.bubble().textContent.includes('开工了'), false, 'start report muted when notifyOnStart=false');
	assert.strictEqual(CG.unreadCount(), 0, 'no start unread when muted');
	muxpCg({ type: 'session/event', sessionId: 'session-cg1', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	assert.ok(envCfg.bubble().textContent.includes('完成了'), 'end report still shown when starts are muted');
	assert.strictEqual(CG.unreadCount(), 1, 'end unread counted');
	/* threshold cycle via the settings panel (TOOL_PRESETS: 5000..60000) */
	CG.openSettings();
	const sPanel = () => envCfg.sandbox.document.body.children.find((c) => (c.className || '').indexOf('dsh-whale-settings') === 0) || null;
	const sp = sPanel();
	assert.ok(sp && sp.classList.contains('show'), 'settings panel opens');
	const cfgRows = sp.children.filter((c) => c.className === 'dsh-whale-settings-row');
	assert.strictEqual(cfgRows.length, 11, 'eleven settings rows (操作说明 moved to the menu as 使用说明; 运行状态 added, #14)');
	const stuckRow = cfgRows.find((r) => r.textContent.includes('工具超时'));
	assert.ok(stuckRow.textContent.includes('15s'), `stuck row shows default 15s: ${stuckRow.textContent}`);
	stuckRow._fire('click', { stopPropagation() {} });
	assert.strictEqual(CG.CONFIG.toolStuckMs, 30000, 'tool threshold cycled to 30s');
	/* volume cycle (VOL_STEPS 0..1) */
	const volRow = sPanel().children.find((c) => c.className === 'dsh-whale-settings-row' && c.textContent.includes('音量'));
	volRow._fire('click', { stopPropagation() {} });
	assert.strictEqual(CG.CONFIG.volume, 0, 'volume cycled to 0% (VOL_STEPS wraps 1->0)');
	assert.strictEqual(JSON.parse(envCfg.sandbox.localStorage.getItem('dsh-whale:config')).data.volume, 0, 'volume persisted');
	/* 41b. sound picker regression: the tone row must OPEN the picker and
	 * stay on it (the settings rebuild used to paint straight over it —
	 * user-reported "点了没办法"), and an option click applies + persists
	 * the per-kind sound and moves the ✔ marker */
	CG.openSettings();
	const toneRow = sPanel().children.find((c) => c.className === 'dsh-whale-settings-row' && c.textContent.includes('音色'));
	toneRow._fire('click', { stopPropagation() {} });
	let pickPanel = sPanel();
	assert.ok(pickPanel && pickPanel.classList.contains('show'), 'sound picker opens from the settings row');
	assert.ok(pickPanel.textContent.includes('完成通知') && pickPanel.textContent.includes('失败通知'), 'picker lists per-kind rows');
	const pickRows = pickPanel.children.filter((c) => c.className === 'dsh-whale-settings-row');
	const sndSels = pickRows.map((r) => r.children.find((ch) => (ch.className || '').indexOf('dsh-whale-sound-sel') >= 0)).filter(Boolean);
	assert.strictEqual(sndSels.length, 4, 'four per-kind dropdowns (done/fail/attn/remind)');
	assert.strictEqual(sndSels[1].children.length, 5, 'fail dropdown carries 5 options');
	assert.strictEqual(sndSels[3].value, 'bell', 'remind sound defaults to bell');
	const pickFoot = pickPanel.children.find((c) => c.className === 'dsh-whale-panel-foot');
	assert.ok(pickFoot && pickFoot.children.some((c) => (c.className || '').indexOf('dsh-whale-panel-back') >= 0), 'sound picker carries a back button');
	sndSels[1].value = 'chime';
	sndSels[1]._fire('change', {});
	assert.strictEqual(CG.CONFIG.soundFail, 'chime', 'fail sound switched to chime via dropdown');
	assert.strictEqual(JSON.parse(envCfg.sandbox.localStorage.getItem('dsh-whale:config')).data.soundFail, 'chime', 'fail sound persisted');
	pickPanel = sPanel();
	assert.ok(pickPanel.textContent.includes('完成通知'), 'picker still open after a pick (no rebuild)');
	/* 41c. 1:1 panel lifecycle: a completion shows the token panel; attention
	 * requests show NO panel at all (09-05 用户反馈 — the task is still
	 * running, a usage readout is premature; the old paired-panel behavior
	 * is retired), and a foreign session's question must never quote
	 * wrong numbers */
	muxpCg({ type: 'session/event', sessionId: 'session-cg1', event: { type: 'assistant/message', seq: 3, time: 2, data: { usage: { inputTokens: 100, outputTokens: 50 } } } });
	muxpCg({ type: 'session/event', sessionId: 'session-cg1', event: { type: 'turn/end', seq: 4, time: 3, data: { reason: { kind: 'completed' } } } });
	const cgStatus = () => envCfg.whale.children.find((c) => c.className === 'dsh-whale-status') || null;
	assert.ok(cgStatus() && cgStatus().classList.contains('show') && cgStatus().textContent.includes('此次任务消耗'), 'completion shows the paired token panel');
	await sleep(6300); /* let the completion panel live out its lifetime */
	assert.ok(!cgStatus() || !cgStatus().classList.contains('show'), 'completion panel hides after its lifetime');
	muxpCg({ type: 'question/requested', sessionId: 'session-cg1', time: Date.now() });
	assert.ok(!cgStatus() || !cgStatus().classList.contains('show'),
		'attention shows NO token panel — task still running, usage waits (09-05 用户反馈)');
	/* a known session the counter holds NOTHING for: panel hidden, never wrong */
	muxpCg({ type: 'session/projection', sessionId: 'session-cg2', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpCg({ type: 'session/projection', sessionId: 'session-cg2', key: 'title', value: '另一会话', seq: 9 });
	await sleep(30);
	muxpCg({ type: 'question/requested', sessionId: 'session-cg2', time: Date.now() });
	assert.ok(cgStatus() && !cgStatus().classList.contains('show'), 'foreign-session question: stale panel stays hidden (no misattribution)');
	/* 41d. 任务周报: the list MUST be inside the drawer — openReport built its
	 * list but never appended it, so the report showed title+close only for
	 * its whole life (user-reported "空的"). Also: drawers and floating
	 * panels never stack (the settings panel used to cover the drawer). */
	CG.pushHistory({ title: '周报任务A', sessionId: 'session-r1', kind: 'done', at: Date.now(), endTime: Date.now(), turnTokens: 1234 });
	CG.pushHistory({ title: '周报任务B', sessionId: 'session-r2', kind: 'question', at: Date.now(), endTime: Date.now(), turnTokens: null });
	CG.openReport();
	const rDrawer = () => envCfg.sandbox.document.body.children.find((c) => (c.className || '').indexOf('dsh-whale-history') === 0) || null;
	assert.ok(rDrawer() && rDrawer().classList.contains('show'), 'weekly report drawer opens');
	const rList = rDrawer().children.find((c) => c.className === 'dsh-whale-history-list');
	assert.ok(rList, 'report list is INSIDE the drawer (missing appendChild fixed)');
	assert.ok(rList.textContent.includes('本周：✅') && rList.textContent.includes('❓'), 'done+question buckets counted (records from the flows above included)');
	assert.ok(rList.textContent.includes('1K tok'), 'token bucket summed (the 1234 pushed record dominates the rounding)');
	assert.strictEqual(CG.panelOpen(), false, 'opening the weekly report closed the settings panel (no stacking)');
	CG.openSettings();
	assert.ok(CG.panelOpen(), 'settings reopens');
	assert.strictEqual(CG.drawerOpen(), false, 'opening settings closed the weekly report (mutual exclusion)');
	const repRow = sPanel().children.find((c) => c.className === 'dsh-whale-settings-row' && c.textContent.includes('任务周报'));
	repRow._fire('click', { stopPropagation() {} });
	assert.ok(CG.drawerOpen() && !CG.panelOpen(), 'the settings 周报 row swaps to the drawer in place');
	/* weekly report also carries the back/close footer (settings-entered) */
	const repFootEl = rDrawer().children.find((c) => c.className === 'dsh-whale-panel-foot');
	assert.ok(repFootEl && repFootEl.children.some((c) => (c.className || '').indexOf('dsh-whale-panel-back') >= 0), 'weekly report carries a back button');
	repFootEl.children.find((c) => (c.className || '').indexOf('dsh-whale-panel-back') >= 0)._fire('click', { stopPropagation() {} });
	assert.ok(CG.panelOpen() && !CG.drawerOpen(), 'report back returns to the settings panel');
	/* legacy-default migration: a stored 8000 (the pre-M4 default that older
	 * panel saves wrote wholesale) adopts the new 15s default on load, while
	 * deliberately-chosen values (e.g. 30000) are respected */
	const envCfgLegacy = makeEnv([['dsh-whale:config', JSON.stringify({ v: 1, data: { notifyOnStart: true, toolStuckMs: 8000, recentFailWindowMs: 180000, volume: 1 } })]]);
	envCfgLegacy.ready();
	assert.strictEqual(envCfgLegacy.sandbox.__dshWhale.CONFIG.toolStuckMs, 15000, 'stored legacy 8000 bumps to the new 15s default');
	const envCfgKeep = makeEnv([['dsh-whale:config', JSON.stringify({ v: 1, data: { notifyOnStart: true, toolStuckMs: 30000, recentFailWindowMs: 180000, volume: 1 } })]]);
	envCfgKeep.ready();
	assert.strictEqual(envCfgKeep.sandbox.__dshWhale.CONFIG.toolStuckMs, 30000, 'deliberate non-default threshold respected');
	/* fresh env restores the saved config */
	const envCfg2 = makeEnv([['dsh-whale:config', JSON.stringify({ v: 1, data: { notifyOnStart: false, toolStuckMs: 15000, recentFailWindowMs: 180000, volume: 0.75 } })]]);
	envCfg2.ready();
	const CG2 = envCfg2.sandbox.__dshWhale;
	assert.strictEqual(CG2.CONFIG.notifyOnStart, false, 'restored: starts muted');
	assert.strictEqual(CG2.CONFIG.toolStuckMs, 15000, 'restored: threshold 15s');
	assert.strictEqual(CG2.CONFIG.volume, 0.75, 'restored: volume 75%');
	/* unknown fields are dropped, defaults kept */
	const envCfg3 = makeEnv([['dsh-whale:config', JSON.stringify({ v: 1, data: { bogus: 42 } })]]);
	envCfg3.ready();
	assert.strictEqual(envCfg3.sandbox.__dshWhale.CONFIG.notifyOnStart, true, 'unknown config field ignored, default kept');
	CG._setHoldMs(null);

	/* 42. status panel busy flag: turn/start marks the panel busy (pulse),
	 * turn/end releases it while the token report still shows */
	const envBusy = makeEnv();
	envBusy.ready();
	const BS = envBusy.sandbox.__dshWhale;
	const muxpBs = (payload) => BS.handleMuxPayload(payload);
	envBusy.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	BS._setHoldMs(10);
	muxpBs({ type: 'session/projection', sessionId: 'session-bs1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpBs({ type: 'session/projection', sessionId: 'session-bs1', key: 'title', value: '忙碌会话', seq: 1 });
	await sleep(30);
	muxpBs({ type: 'session/event', sessionId: 'session-bs1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } });
	const busyEl = () => envBusy.whale.children.find((c) => c.className === 'dsh-whale-status') || null;
	assert.ok(busyEl() && busyEl().classList.contains('dsh-whale-status-busy'), 'start marks the panel busy');
	muxpBs({ type: 'session/event', sessionId: 'session-bs1', event: { type: 'turn/end', seq: 2, time: 1, data: {} } });
	assert.ok(busyEl() && !busyEl().classList.contains('dsh-whale-status-busy'), 'end releases the busy flag');
	assert.ok(busyEl() && !busyEl().classList.contains('dsh-whale-status-busy'), 'panel element persists, busy released');
	BS._setHoldMs(null);

	/* 43. pressure-tinted border: the pure color function spans blue-grey at
	 * 0% to deep red at 100%, and the pressure frame drives the CSS variable
	 * (primary path) with a JS border-color fallback for old engines */
	const envPr = makeEnv();
	envPr.ready();
	const PR = envPr.sandbox.__dshWhale;
	const muxpPr = (payload) => PR.handleMuxPayload(payload);
	envPr.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	/* pure color function */
	const c0 = PR.pressureColor(0);
	const c50 = PR.pressureColor(50);
	const c100 = PR.pressureColor(100);
	assert.ok(/^rgba\(\d+,\d+,\d+,0\.45\)$/.test(c0), 'color string shape: ' + c0);
	const parseRgb = (s) => s.match(/rgba\((\d+),(\d+),(\d+)/).slice(1).map(Number);
	const [r0] = parseRgb(c0), [r100] = parseRgb(c100);
	assert.ok(r0 < r100, 'red channel rises with pressure (' + r0 + ' -> ' + r100 + ')');
	assert.ok(r0 < 150 && r100 > 200, 'low pressure blue-grey, high pressure deep red');
	PR.applyPressureHue();
	/* pressure frame drives the CSS variable (fake DOM: root has setProperty) */
	muxpPr({ type: 'session/projection', sessionId: 'session-pr1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpPr({ type: 'session/projection', sessionId: 'session-pr1', key: 'title', value: '压力会话', seq: 1 });
	muxpPr({ type: 'session/projection', sessionId: 'session-pr1', key: 'contextPressure', value: { pressureTokens: 800, contextWindow: 1000 } });
	const root = envPr.sandbox.document.documentElement;
	assert.ok(root && root.style && root.style._props, 'root style exists for CSS var capture');
	if (root && root.style && root.style._props) {
		assert.strictEqual(root.style._props['--dsh-whale-pressure'], '80', 'pressure frame sets the CSS variable to 80');
	}

	/* ---- env 2: frames queued before UI ready are drained ---- */
	const env2 = makeEnv();
	env2.sandbox.__dshWhale.handleMuxPayload({
		type: 'session/projection',
		sessionId: 'session-e2',
		key: 'subagentTiming',
		value: { settledMs: 0 },
	});
	env2.sandbox.__dshWhale.handleMuxPayload({
		type: 'session/projection',
		sessionId: 'session-e2',
		key: 'title',
		value: '早鸟会话',
		seq: 1,
	});
	env2.sandbox.__dshWhale.handleMuxPayload({
		type: 'session/event',
		sessionId: 'session-e2',
		event: { type: 'turn/start', seq: 2, time: 0, data: {} },
	});
	env2.ready();
	assert.ok(env2.bubble().textContent.includes('早鸟会话'), `drained queue: ${env2.bubble().textContent}`);

	/* 44. robustness pins (M4): the mux pipeline never breaks on bad input —
	 * bad JSON, envelope-less frames, missing payload/type, unknown types and
	 * known-type frames with missing fields are all contained; the channel
	 * keeps processing afterwards. Pins the mux.js guards + the silent
	 * unknown-type fall-through so refactors cannot quietly drop them. */
	const envRb = makeEnv();
	envRb.ready();
	const RB = envRb.sandbox.__dshWhale;
	RB._setHoldMs(10);
	envRb.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	envRb.frame({ type: 'session/projection', sessionId: 'session-rb', key: 'subagentTiming', value: { settledMs: 0 } });
	envRb.frame({ type: 'session/projection', sessionId: 'session-rb', key: 'title', value: '鲁棒会话', seq: 1 });
	await sleep(30);
	envRb.frame({ type: 'session/event', sessionId: 'session-rb', event: { type: 'turn/start', seq: 2, time: 0, data: {} } });
	envRb.frame({ type: 'session/event', sessionId: 'session-rb', event: { type: 'turn/end', seq: 3, time: 1, data: {} } });
	const rbBase = RB.historyList().length;
	assert.ok(rbBase >= 1, 'baseline: valid frames processed before the fusillade');
	/* the fusillade — none of these may throw or kill the channel */
	envRb.socket()._emit('message', { data: 'not-json{{' });                                          /* bad JSON */
	envRb.socket()._emit('message', { data: '42' });                                                  /* non-object envelope */
	envRb.socket()._emit('message', { data: JSON.stringify({ foo: 1 }) });                            /* envelope without payload */
	envRb.socket()._emit('message', { data: JSON.stringify({ payload: { note: 'no type' } }) });      /* payload without type */
	envRb.frame({ type: 'dsh/future-frame', x: 1 });                                                  /* unknown type: silent fall-through */
	envRb.frame({ type: 'session/jobs' });                                                            /* known type, missing jobs */
	envRb.frame({ type: 'session/projection', sessionId: 'session-rb', key: 'mystery-key', value: null }); /* unknown projection key */
	envRb.frame({ type: 'session/event', sessionId: 'session-rb', event: null });                     /* missing event object */
	envRb.frame({ type: 'approval/requested', sessionId: 'session-rb' });                             /* missing toolName */
	envRb.frame({ type: 'question/requested', sessionId: 'session-rb', questions: 'not-an-array' });  /* malformed questions */
	assert.ok(true, 'fusillade of malformed frames threw nothing');
	/* the channel is still live: a valid frame after the fusillade is processed */
	envRb.frame({ type: 'session/event', sessionId: 'session-rb', event: { type: 'turn/end', seq: 4, time: 2, data: {} } });
	assert.ok(RB.historyList().length > rbBase, 'channel survives the fusillade and keeps processing');
	RB._setHoldMs(null);
	/* storage forward-compat: a FUTURE (v2+) envelope degrades to defaults and
	 * is left untouched — never migrated backwards, never written over */
	const envV2 = makeEnv([['dsh-whale:history', JSON.stringify({ v: 2, data: [{ title: 'future', sessionId: 's-f', kind: 'done', at: 9 }] })]]);
	envV2.ready();
	assert.strictEqual(envV2.sandbox.__dshWhale.historyList().length, 0, 'v2 envelope degrades to defaults');
	const rawV2 = envV2.sandbox.localStorage.getItem('dsh-whale:history');
	assert.strictEqual(JSON.parse(rawV2).v, 2, 'v2 envelope preserved (no write-back)');
	assert.strictEqual(JSON.parse(rawV2).data[0].title, 'future', 'v2 payload intact');

	/* 45. jobs-silence contract pinned at the SOURCE level (M4; the vm sandbox
	 * has no dist): handleJobsFrame must contain zero notification calls —
	 * background jobs are workload-only, forever */
	const src = fs.readFileSync(path.join(__dirname, 'whale.js'), 'utf8');
	const jStart = src.indexOf('function handleJobsFrame');
	const jEnd = src.indexOf('function handleSubscribedFrame', jStart);
	assert.ok(jStart >= 0 && jEnd > jStart, 'handleJobsFrame located in the built source');
	const jBody = src.slice(jStart, jEnd).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	for (const call of ['say(', 'pushReport(', 'playDing(', 'uiSay(', 'reportTurn(', 'reportAttention(', 'correctReports(']) {
		assert.ok(!jBody.includes(call), `handleJobsFrame stays silent: no ${call}`);
	}

	/* 46. health check (core/health.js): silent while healthy, chip + report
	 * when a dependency degrades; jump stays warn-only. */
	const envH = makeEnv();
	envH.ready();
	const HP = envH.sandbox.__dshWhale;
	/* healthy state: no report flip even though the stubbed fetch fails the
	 * poll (envs without a live host stay quiet — degraded is FALSE because
	 * failStreak resets on every real OK; here we force the healthy shape) */
	HP.__serverHealth = { lastOkAt: Date.now(), failStreak: 0, lastError: '' };
	HP.__usageHealth = { attempts: 5, misses: 0, missStreak: 0 };
	let rep = HP._health.run();
	assert.strictEqual(rep.server + '/' + rep.dom + '/' + rep.jump, 'ok/ok/warn', 'fresh page without the hook: jump warns, nothing degraded');
	assert.strictEqual(HP._health.state().degraded, false, 'warn-only jump never trips the headline');
	assert.ok(!envH.whale.children.some((c) => c.className === 'dsh-whale-health-chip'), 'no chip while healthy');
	/* server channel down: 3 consecutive poll failures */
	HP.__serverHealth = { lastOkAt: Date.now() - 120000, failStreak: 3, lastError: 'http-not-ok' };
	rep = HP._health.run();
	assert.strictEqual(rep.server, 'fail', 'failStreak>=3 fails the server check');
	assert.strictEqual(HP._health.state().degraded, true, 'server fail degrades');
	const hChip = envH.whale.children.find((c) => c.className === 'dsh-whale-health-chip');
	assert.ok(hChip, '⚠️ chip appears near the whale');
	assert.strictEqual(hChip.textContent, '⚠️', 'chip is the warning glyph');
	/* usage selector lost: 3 real turn finishes, nothing read */
	HP.__serverHealth = { lastOkAt: Date.now(), failStreak: 0, lastError: '' };
	HP.__usageHealth = { attempts: 3, misses: 3, missStreak: 3 };
	rep = HP._health.run();
	assert.strictEqual(rep.dom, 'fail', 'missStreak>=3 fails the dom check');
	assert.strictEqual(HP._health.state().degraded, true, 'dom fail degrades');
	HP.__usageHealth = { attempts: 4, misses: 3, missStreak: 1 };
	rep = HP._health.run();
	assert.strictEqual(rep.dom, 'ok', 'one good read re-arms the dom check');
	/* recovery clears the chip */
	HP.__usageHealth = { attempts: 6, misses: 3, missStreak: 0 };
	rep = HP._health.run();
	assert.strictEqual(HP._health.state().degraded, false, 'recovered: not degraded');
	assert.strictEqual(envH.whale.children.find((c) => c.className === 'dsh-whale-health-chip').style.display, 'none', 'chip hides on recovery');
	/* overrides seam resets cleanly */
	HP._health.seed({ server: 'fail', dom: 'fail', jump: 'warn' });
	rep = HP._health.run();
	assert.strictEqual(rep.server + '/' + rep.dom, 'fail/fail', 'forced report honored');
	HP._health.seed(null);

	/* 47. cross-channel dedup (core/dedup.js): explicit keys, ring caps,
	 * per-session failure suppression (the old single-slot lastEndFire let
	 * two interleaved failing sessions shadow each other). */
	const envD = makeEnv();
	envD.ready();
	const DD = envD.sandbox.__dshWhale._dedup;
	assert.strictEqual(DD.seeAttention('call-1'), true, 'first sight announces');
	assert.strictEqual(DD.seeAttention('call-1'), false, 'repeat callId never re-announces');
	assert.strictEqual(DD.seeAttention('call-2'), true, 'a DIFFERENT question in the same second still announces');
	/* ring cap: attention bucket never exceeds 200 */
	for (let ci = 0; ci < 260; ci++) DD.seeAttention('bulk-' + ci);
	assert.ok(Object.keys(envD.sandbox.__dshWhale.attSeen).length <= 200, 'attention map ring-capped at 200');
	assert.strictEqual(DD.seeAttention('call-1'), true, 'evicted keys may announce again (cap is not memory)');
	/* end-fire: per-session, no cross-session shadowing */
	DD.seeEndFire('session-f1', 'fail');
	assert.strictEqual(DD.endFiredRecently('session-f1'), true, 'same-session fail suppressed in the window');
	assert.strictEqual(DD.endFiredRecently('session-f2'), false, 'ANOTHER failing session is NOT suppressed (single-slot bug fixed)');
	DD.seeEndFire('session-f1', 'success');
	assert.strictEqual(DD.endFiredRecently('session-f1'), true, 'any recent end keeps parity with the old semantics');

	/* 48. batch fold (P0③): a flood of same-session completions in ONE
	 * poll batch collapses into ONE 📦 announcement; history still records
	 * every turn; failures/aborts never fold. */
	const envF = makeEnv();
	envF.ready();
	const FF = envF.sandbox.__dshWhale;
	const muxpF = (payload) => FF.handleMuxPayload(payload);
	envF.setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
	FF._setHoldMs(10);
	/* register + name the background session through the normal projections */
	muxpF({ type: 'session/projection', sessionId: 'session-fold1', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpF({ type: 'session/projection', sessionId: 'session-fold1', key: 'title', value: '折叠会话' });
	await sleep(30);
	/* frames level: foldSuppress records silently (no bubble, no badge) */
	muxpF({ type: 'session/event', sessionId: 'session-fold1', event: { type: 'turn/end', seq: 1, time: 1, foldSuppress: true, data: { reason: { kind: 'completed' } } } });
	assert.strictEqual((envF.bubble() || { textContent: '' }).textContent, '', 'foldSuppress turn says NOTHING');
	assert.strictEqual(FF.unreadCount(), 0, 'foldSuppress turn adds no unread');
	assert.strictEqual(FF.historyList()[0].kind, 'done', 'foldSuppress turn still recorded in history');
	/* frames level: the batch's newest turn announces for all of them */
	muxpF({ type: 'session/event', sessionId: 'session-fold1', event: { type: 'turn/end', seq: 2, time: 2, foldCount: 3, data: { reason: { kind: 'completed' } } } });
	assert.ok(envF.bubble().textContent.includes('完成了 3 个任务 📦'), `fold summary announced: ${envF.bubble().textContent}`);
	assert.strictEqual(FF.unreadCount(), 1, 'the whole batch costs ONE unread');
	/* server level: consume()'s pre-scan marks 4 same-session completions so
	 * only the newest speaks (drive the REAL poll with a stubbed batch) */
	const envF2 = makeEnv();
	envF2.ready();
	const FF2 = envF2.sandbox.__dshWhale;
	const muxpFold2 = (payload) => FF2.handleMuxPayload(payload);
	muxpFold2({ type: 'session/projection', sessionId: 'session-fold2', key: 'subagentTiming', value: { settledMs: 0 } });
	muxpFold2({ type: 'session/projection', sessionId: 'session-fold2', key: 'title', value: '洪水会话' });
	await sleep(30);
	const nowF2 = Date.now();
	let callNo = 0;
	envF2.setFetch((url) => {
		callNo++;
		if (callNo === 1) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ bootId: 'fb', events: [
				{ type: 'session/event', sessionId: 'session-fold2', seq: 1, time: nowF2 - 1000, event: { type: 'turn/end', time: nowF2 - 1000, data: { reason: { kind: 'completed' } } } },
				{ type: 'session/event', sessionId: 'session-fold2', seq: 2, time: nowF2 - 900, event: { type: 'turn/end', time: nowF2 - 900, data: { reason: { kind: 'completed' } } } },
				{ type: 'session/event', sessionId: 'session-fold2', seq: 3, time: nowF2 - 800, event: { type: 'turn/end', time: nowF2 - 800, data: { reason: { kind: 'completed' } } } },
				{ type: 'session/event', sessionId: 'session-fold2', seq: 4, time: nowF2 - 700, event: { type: 'turn/end', time: nowF2 - 700, data: { reason: { kind: 'completed' } } } }
			] }) });
		}
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ bootId: 'fb', events: [] }) });
	});
	await sleep(2300); /* the first poll fires ~1.5s after env ready */
	assert.ok(envF2.bubble().textContent.includes('完成了 4 个任务 📦'), `pre-scan folded the flood: ${envF2.bubble().textContent}`);
	assert.strictEqual(FF2.unreadCount(), 1, 'flood of 4 completions costs ONE unread');
	assert.strictEqual(FF2.historyList().filter((h) => h.sessionId === 'session-fold2').length, 4, 'all 4 turns recorded in history');

	/* 48b. replay guard (09-06 真机 B2): a seq reset (shell reopened within
	 * one service boot) must not re-announce / re-record old frames — the
	 * freshness guard read frame-level time which the host never sets (dead
	 * code), so a replay re-announced completions and re-recorded history
	 * with inflated token sums. Stale frames stay silent; recent ones still
	 * catch up; the seq checkpoint lives in localStorage (survives the
	 * window closing, bootId-keyed). */
	const envR = makeEnv();
	envR.ready();
	const RG = envR.sandbox.__dshWhale;
	await sleep(30); /* let the startup title-prefill fetch hit the default stub first */
	const nowR = Date.now();
	let rCall = 0;
	envR.setFetch((url) => {
		rCall++;
		if (rCall === 1) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ bootId: 'rb', events: [
				/* 10-minute-old completion + title: the previous window already
				 * announced them — a seq reset must stay silent */
				{ type: 'session/event', sessionId: 'session-rp1', seq: 1, event: { type: 'turn/end', time: nowR - 600000, data: { reason: { kind: 'completed' } } } },
				{ type: 'session/event', sessionId: 'session-rp1', seq: 2, event: { type: 'session/title', time: nowR - 600000, data: { title: '旧会话名' } } },
				/* title + 10-second-old completion: emitted while no window
				 * was open — catching up is exactly what replay is for */
				{ type: 'session/event', sessionId: 'session-rp2', seq: 3, event: { type: 'session/title', time: nowR - 20000, data: { title: '补达会话' } } },
				{ type: 'session/event', sessionId: 'session-rp2', seq: 4, event: { type: 'turn/end', time: nowR - 10000, data: { reason: { kind: 'completed' } } } }
			] }) });
		}
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ bootId: 'rb', events: [] }) });
	});
	await sleep(2300); /* the first poll fires ~1.5s after env ready */
	assert.ok(!envR.bubble().textContent.includes('未命名任务') && !envR.bubble().textContent.includes('旧会话名'), `stale replay stays silent: ${envR.bubble().textContent}`);
	assert.strictEqual(RG.historyList().filter((h) => h.sessionId === 'session-rp1').length, 0, 'stale completion never re-records history');
	assert.ok(envR.bubble().textContent.includes('[补达会话]完成了'), `recent completion still catches up: ${envR.bubble().textContent}`);
	assert.strictEqual(RG.historyList().filter((h) => h.sessionId === 'session-rp2').length, 1, 'catch-up completion recorded once');
	assert.ok(JSON.parse(envR.sandbox.localStorage.getItem('dsh-whale:evseq') || '{}').seq >= 4, 'seq checkpoint persisted in localStorage');

	/* 49. clearAt deletion sync: a 清空历史 bumps a generation marker and
	 * records older than it are dropped on EVERY merge — merge-only cloud
	 * sync used to resurrect cleared records on the next pull. */
	const envC = makeEnv([
		['dsh-whale:clearAt', JSON.stringify({ v: 1, data: 9999999999999 })],
		['dsh-whale:history', JSON.stringify({ v: 1, data: [] })],
	]);
	envC.ready();
	const CL = envC.sandbox.__dshWhale;
	envC.setFetch((url) => Promise.resolve({ ok: true, json: () => Promise.resolve({
		v: 1, clearAt: 9999999999999,
		history: [{ title: '老任务', sessionId: 's-old', kind: 'done', at: 1234567890123 }]
	}) }));
	CL.openHistory(); /* the drawer's pull merges the cloud copy */
	await sleep(120);
	assert.strictEqual(CL.historyList().length, 0, 'records older than clearAt never resurrect from the cloud');
	assert.strictEqual(CL.getClearAt(), 9999999999999, 'generation marker intact');

	/* ============ 50 · 批1：长任务计时 / 悬停暂停 / 清空反馈 / 说明浮窗 ============ */
	{
		const envT = makeEnv();
		envT.ready();
		const BT = envT.sandbox.__dshWhale;
		const RT = BT._runTimer;
		/* #1/#2 pure timer line: 2-minute gate, clock format, subtask count */
		assert.strictEqual(RT.line(119999, 0), null, 'timer line hidden below 2 minutes');
		assert.strictEqual(RT.line(120000, 0), '⏳ 已运行 02:00', 'timer line appears exactly at 2 minutes');
		assert.strictEqual(RT.line(754000, 3), '⏳ 已运行 12:34 · 已完成 3 个子任务', 'clock + subtask count format');
		assert.strictEqual(RT.line(3600000, 0), '⏳ 已运行 60:00', 'long runs count past an hour');
		/* subtask counter fed by real jobs frames (completedAt stamped on completion) */
		envT.frame({ type: 'session/jobs', sessionId: 'session-rt1', jobs: [
			{ id: 'j1', status: 'completed', label: 'a', kind: 'bash' },
			{ id: 'j2', status: 'completed', label: 'b', kind: 'bash' },
			{ id: 'j3', status: 'running', label: 'c', kind: 'bash' },
		] });
		assert.strictEqual(RT.count('session-rt1', Date.now() - 60000), 2, 'two jobs completed since the turn started');
		assert.strictEqual(RT.count('session-rt1', Date.now() + 1000), 0, 'future "since" counts nothing');
		assert.strictEqual(RT.count('session-other', 0), 0, 'other sessions count nothing');
		/* state machine: newest turn/start wins; a DIFFERENT session's end keeps it running */
		RT.start('session-rt2');
		assert.ok(RT.state().active && RT.state().session === 'session-rt2', 'timer starts');
		RT.stop('session-rt1');
		assert.ok(RT.state().active && RT.state().session === 'session-rt2', "another session's end does not stop the timer");
		RT.stop('session-rt2');
		assert.ok(!RT.state().active, 'timer stops on its own session end');
		RT.stop();
		assert.ok(!RT.state().active, 'stop is idempotent');
		/* hooks ride the live turn path: real frames start/stop the timer */
		envT.frame({ type: 'session/event', sessionId: 'session-rt3', event: { type: 'turn/start', seq: 1, time: 1, data: {} } });
		assert.ok(RT.state().active && RT.state().session === 'session-rt3', 'turn/start frame arms the run timer');
		envT.frame({ type: 'session/event', sessionId: 'session-rt3', event: { type: 'turn/end', seq: 2, time: 2, data: {} } });
		assert.ok(!RT.state().active, 'turn/end frame disarms the run timer');
		/* #9 hover pause: completion bubble survives a hover round-trip */
		BT._setHoldMs(0);
		envT.frame({ type: 'session/projection', sessionId: 'session-rt4', key: 'subagentTiming', value: { settledMs: 0 } });
		envT.frame({ type: 'session/projection', sessionId: 'session-rt4', key: 'title', value: '悬停测试', seq: 1 });
		envT.frame({ type: 'session/event', sessionId: 'session-rt4', event: { type: 'turn/end', seq: 1, time: 1, data: {} } });
		const bubT = envT.bubble();
		assert.ok(bubT && bubT.classList.contains('show'), 'completion bubble shown for hover test');
		assert.ok(bubT.textContent.includes('悬停测试'), 'bubble carries the session title');
		bubT._fire('mouseenter', {});
		bubT._fire('mouseleave', {});
		assert.ok(bubT.classList.contains('show'), 'bubble still shown after a hover round-trip');
		assert.strictEqual(BT._bubble.resumeMs(200), 1500, 'mouseleave floor: remaining < 1.5s is topped up');
		assert.strictEqual(BT._bubble.resumeMs(4000), 4000, 'mouseleave resumes with the remaining time');
		/* #10 clear feedback: faint note with the count */
		BT.showWhaleNote('已清空 7 条通知', 3000);
		const noteEl = envT.whale.children.find((c) => (c.className || '') === 'dsh-whale-note');
		assert.ok(noteEl, 'whale note appended to the whale');
		assert.strictEqual(noteEl.textContent, '已清空 7 条通知', 'note carries the cleared count');
		/* #6/#14/#15 settings: renames, (?) explainers, 运行状态 entry */
		BT.openSettings();
		const sPanelT = () => envT.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-settings');
		assert.ok(sPanelT(), 'settings opens');
		assert.ok(!sPanelT().textContent.includes('诊断模式'), 'old 诊断模式 label gone (#15)');
		assert.ok(!sPanelT().textContent.includes('健康自检'), 'old 健康自检 label gone (#14)');
		assert.ok(sPanelT().textContent.includes('调试模式'), '调试模式 row present (#15)');
		const rowsT = sPanelT().children.filter((c) => c.className === 'dsh-whale-settings-row');
		assert.strictEqual(rowsT.length, 11, 'eleven settings rows');
		assert.strictEqual(rowsT.filter((r) => r.children.some((ch) => ch.className === 'dsh-whale-settings-q')).length, 11,
			'every row carries a (?) explainer (#6)');
		const runRow = rowsT.find((r) => r.textContent.includes('运行状态'));
		assert.ok(runRow, '运行状态 entry row exists (#14)');
		const runQ = runRow.children.find((ch) => ch.className === 'dsh-whale-settings-q');
		const runTip = runRow.children.find((ch) => ch.className === 'dsh-whale-settings-hint');
		assert.ok(runTip && !runTip.classList.contains('show'), 'hint hidden by default');
		runQ._fire('click', { stopPropagation() {} });
		assert.ok(runTip.classList.contains('show'), 'hint shows on (?) click');
		const runX = runTip.children.find((ch) => ch.className === 'dsh-whale-settings-hint-x');
		assert.ok(runX && runX.textContent.includes('收起'), 'expanded hint carries a 收起 button');
		runX._fire('click', { stopPropagation() {} });
		assert.ok(!runTip.classList.contains('show'), '收起 button collapses the hint');
		assert.strictEqual(sPanelT().children.filter((c) => c.className === 'dsh-whale-settings-row').length, 11,
			'toggle/collapse never rebuild the panel (stopPropagation)');
		/* 设置 itself is menu-entered: bottom-left 返回菜单 reopens the menu */
		const setFoot = sPanelT().children.find((c) => c.className === 'dsh-whale-panel-foot');
		const setBack = setFoot && setFoot.children.find((c) => c.textContent.indexOf('返回菜单') >= 0);
		assert.ok(setBack, 'settings panel carries a 返回菜单 back button (bottom-left)');
		setBack._fire('click', { stopPropagation() {} });
		assert.ok(envT.sandbox.document.body.children.find((c) => c.className === 'dsh-whale-menu'),
			'settings back reopens the right-click menu');
		/* 运行状态 row opens the renamed health panel (DOM assembly asserted) */
		runRow._fire('click', { stopPropagation() {} });
		const hpT = sPanelT();
		assert.ok(hpT.textContent.includes('运行状态'), 'health panel titled 运行状态 (#14)');
		assert.ok(hpT.textContent.includes('后台通知通道'), 'health detail rows render');
		/* ← 返回设置: back into settings without close-and-reopen */
		const footT = hpT.children.find((c) => c.className === 'dsh-whale-panel-foot');
		const backBtnT = footT && footT.children.find((c) => (c.className || '').indexOf('dsh-whale-panel-back') >= 0);
		assert.ok(backBtnT && backBtnT.textContent.includes('返回'), 'health panel carries a back button');
		backBtnT._fire('click', { stopPropagation() {} });
		assert.ok(sPanelT().textContent.includes('⚙️ 设置'), 'back returns to the settings panel');
	}

	/* ============ 51 · 批2：闲置引导 / 好感度爱心里程碑 / 手册搜索 / 历史高亮 ============ */
	{
		const envG = makeEnv();
		envG.ready();
		const BG = envG.sandbox.__dshWhale;
		const bodyG = envG.sandbox.document.body;
		/* #11 idle guide: fires when idle, gated by unread, daily-capped */
		assert.ok(BG._idleGuide.lines.length >= 3, 'pet-guide line pool exists');
		BG._idleGuide.tick(true);
		assert.strictEqual(BG._idleGuide.count(), 1, 'guide fired (idle, affection < 10)');
		assert.ok(envG.bubble().classList.contains('show'), 'guide line spoken via bubble');
		assert.ok(BG._idleGuide.lines.some((l) => l.indexOf('摸') >= 0), 'guide mentions the pet gesture');
		/* unread pending ⇒ no idle chatter */
		BG._setHoldMs(0);
		envG.frame({ type: 'session/projection', sessionId: 'session-idle1', key: 'subagentTiming', value: { settledMs: 0 } });
		envG.frame({ type: 'session/projection', sessionId: 'session-idle1', key: 'title', value: '占用未读', seq: 1 });
		envG.frame({ type: 'session/event', sessionId: 'session-idle1', event: { type: 'turn/end', seq: 1, time: 1, data: {} } });
		assert.ok(BG.unreadCount() > 0, 'unread present for gating test');
		BG._idleGuide.tick(true);
		assert.strictEqual(BG._idleGuide.count(), 1, 'no idle chatter while unread pending');
		envG.badge()._fire('dblclick', { stopPropagation() {} });
		assert.strictEqual(BG.unreadCount(), 0, 'unread cleared');
		BG._idleGuide.tick(true);
		BG._idleGuide.tick(true);
		assert.strictEqual(BG._idleGuide.count(), 3, 'daily cap reached (3)');
		BG._idleGuide.tick(true);
		assert.strictEqual(BG._idleGuide.count(), 3, 'daily cap holds');
		/* #12' milestone: petting to affection 10 fires a ONE-TIME celebration */
		const petEvt = { stopPropagation() {}, preventDefault() {} };
		for (let i = 0; i < 10; i++) {
			envG.whale._fire('contextmenu', petEvt);
			envG.whale._fire('contextmenu', petEvt);
		}
		assert.strictEqual(BG.affection(), 10, 'ten pets recorded');
		await sleep(1400); /* milestone celebration fires at +1.2s */
		assert.ok(envG.bubble().textContent.includes('好感度 10'), `milestone line: ${envG.bubble().textContent}`);
		const heartEls = envG.rippleLayer().children.filter((c) => c.className === 'dsh-whale-heart');
		assert.ok(heartEls.length >= 12, `milestone heart burst rendered (${heartEls.length})`);
		/* hearts branch of the idle tick now that affection >= 10 */
		BG._idleGuide.tick(true);
		assert.strictEqual(BG._idleGuide.count(), 4, 'hearts tick consumes the counter too');
		/* #5 manual search: filter + status + restore */
		BG.openHelp();
		const mDrawer = bodyG.children.find((c) => (c.className || '').indexOf('dsh-whale-manual') >= 0);
		assert.ok(mDrawer, 'manual drawer open');
		const mIn = mDrawer.children.find((c) => (c.className || '').indexOf('dsh-whale-manual-search') >= 0);
		const mStatus = mDrawer.children.find((c) => c.className === 'dsh-whale-manual-status');
		const mList = mDrawer.children.find((c) => c.className === 'dsh-whale-history-list');
		const totalRows = mList.children.length;
		mIn.value = '红标';
		mIn._fire('input', {});
		assert.ok(mStatus.textContent.includes('找到'), `search count: ${mStatus.textContent}`);
		const hiddenCount = mList.children.filter((c) => c.classList.contains('dsh-whale-hide')).length;
		assert.ok(hiddenCount > 0 && hiddenCount < totalRows, 'non-matching rows hidden');
		assert.ok(mList.children.some((c) => c.classList.contains('dsh-whale-help-hit')), 'matched rows highlighted');
		mIn.value = '查无此词xyzzy';
		mIn._fire('input', {});
		assert.ok(mStatus.textContent.includes('未找到相关内容'), 'no-match status shown');
		mIn.value = '';
		mIn._fire('input', {});
		assert.strictEqual(mStatus.textContent, '', 'status cleared on empty query');
		assert.strictEqual(mList.children.filter((c) => c.classList.contains('dsh-whale-hide')).length, 0, 'all rows restored');
		mDrawer.children.find((c) => c.className === 'dsh-whale-panel-foot')
			.children.find((c) => c.className === 'dsh-whale-wardrobe-close')._fire('click', { stopPropagation() {} });
		/* #7 history search: highlight + "找到 N 条记录" */
		BG.pushHistory({ title: '修复登录页 bug', sessionId: 'session-h1', kind: 'done', at: Date.now() });
		BG.pushHistory({ title: '写周报并同步', sessionId: 'session-h2', kind: 'done', at: Date.now() });
		BG.openHistory();
		const hDrawer = bodyG.children.find((c) => (c.className || '') === 'dsh-whale-history');
		const hSearch = hDrawer.children.find((c) => c.className === 'dsh-whale-history-search');
		const hCount = hDrawer.children.find((c) => c.className === 'dsh-whale-history-count');
		const hList = hDrawer.children.find((c) => c.className === 'dsh-whale-history-list');
		assert.strictEqual(hCount.textContent, '', 'count line empty before searching');
		hSearch.value = '周报';
		hSearch._fire('input', {});
		assert.ok(hCount.textContent.includes('找到 1 条记录'), `match count line: ${hCount.textContent}`);
		const hitRow = hList.children.find((c) => c.className === 'dsh-whale-history-row');
		const hitText = hitRow.children.find((c) => c.className === 'dsh-whale-history-text');
		assert.ok(hitText.children.some((c) => c.textContent === '周报'), 'matched keyword rendered as a highlighted mark');
		hSearch.value = '查无此词';
		hSearch._fire('input', {});
		assert.ok(hList.textContent.includes('没有匹配的记录'), 'empty state still reachable');
		hDrawer.children.find((c) => c.className === 'dsh-whale-panel-foot')
			.children.find((c) => c.className === 'dsh-whale-wardrobe-close')._fire('click', { stopPropagation() {} });
	}

	/* ============ 52 · 批3：清空范围 / 点击涟漪 ============ */
	{
		const envR = makeEnv();
		envR.ready();
		const BR = envR.sandbox.__dshWhale;
		const bodyR = envR.sandbox.document.body;
		const DAY = 86400000;
		/* seed three records: 10 days old, 3 days old, 1 day old */
		BR.pushHistory({ title: '十天前任务', sessionId: 'session-r1', kind: 'done', at: Date.now() - 10 * DAY });
		BR.pushHistory({ title: '三天前任务', sessionId: 'session-r2', kind: 'done', at: Date.now() - 3 * DAY });
		BR.pushHistory({ title: '昨天任务', sessionId: 'session-r3', kind: 'done', at: Date.now() - 1 * DAY });
		BR.openHistory();
		const drawerR = bodyR.children.find((c) => (c.className || '') === 'dsh-whale-history');
		const clearRowR = drawerR.children.find((c) => c.className === 'dsh-whale-history-clear');
		const clearOpts = drawerR.children.find((c) => c.className === 'dsh-whale-history-clear-opts');
		assert.ok(clearOpts, 'clear options container exists');
		assert.ok(!clearOpts.classList.contains('show'), 'options hidden before arming');
		clearRowR._fire('click', { stopPropagation() {} });
		assert.ok(clearRowR.textContent.includes('选择要清空的范围'), 'arm prompt shown');
		assert.ok(clearOpts.classList.contains('show'), 'options expand on arm');
		const optTexts = clearOpts.children.map((c) => c.textContent);
		assert.strictEqual(optTexts.length, 3, 'three range options');
		assert.ok(optTexts[0].includes('清空全部') && optTexts[1].includes('7 天前') && optTexts[2].includes('30 天前'),
			`range options: ${optTexts.join(' | ')}`);
		/* ranged clear: only the 10-day-old record dies (#8) */
		clearOpts.children[1]._fire('click', { stopPropagation() {} });
		assert.strictEqual(BR.historyList().length, 2, '7-day clear keeps recent records');
		assert.ok(!BR.historyList().some((r) => r.title === '十天前任务'), 'old record dropped');
		assert.ok(BR.getClearAt() > Date.now() - 8 * DAY && BR.getClearAt() <= Date.now() - 7 * DAY + 5000,
			'clearAt back-dated to the cutoff');
		assert.ok(envR.bubble().textContent.includes('共 1 条'), `clear feedback: ${envR.bubble().textContent}`);
		assert.ok(!clearOpts.classList.contains('show'), 'options collapse after clear');
		/* re-tap on the title row cancels without deleting */
		clearRowR._fire('click', { stopPropagation() {} });
		clearRowR._fire('click', { stopPropagation() {} });
		assert.ok(!clearOpts.classList.contains('show') && BR.historyList().length === 2, 're-tap cancels safely');
		/* full clear still works */
		clearRowR._fire('click', { stopPropagation() {} });
		clearOpts.children[0]._fire('click', { stopPropagation() {} });
		assert.strictEqual(BR.historyList().length, 0, 'clear-all empties history');
		assert.ok(BR.getClearAt() >= Date.now() - 1000, 'full clear bumps clearAt to now');
		/* #13 single click spawns a ripple ring at the click point */
		envR.whale._fire('pointerdown', pt(1, 123, 77));
		envR.whale._fire('pointerup', pt(1, 123, 77));
		await sleep(320);
		assert.ok(envR.rippleLayer().children.some((c) => c.className === 'dsh-whale-ripple'), 'click spawns a ripple ring');
	}

	/* ============ 53 · 用户反馈轮：搜索大小写不敏感 / 指定时间提醒 ============ */
	{
		const envS = makeEnv();
		envS.ready();
		const BS = envS.sandbox.__dshWhale;
		const bodyS = envS.sandbox.document.body;
		/* CI history search: 'step' hits 'Step'; the mark keeps ORIGINAL casing */
		BS.pushHistory({ title: 'Fix Step bug', sessionId: 'session-s1', kind: 'done', at: Date.now() });
		BS.pushHistory({ title: '写周报', sessionId: 'session-s2', kind: 'done', at: Date.now() });
		BS.openHistory();
		const dS = bodyS.children.find((c) => (c.className || '') === 'dsh-whale-history');
		const sIn = dS.children.find((c) => c.className === 'dsh-whale-history-search');
		const sCnt = dS.children.find((c) => c.className === 'dsh-whale-history-count');
		const sList = dS.children.find((c) => c.className === 'dsh-whale-history-list');
		sIn.value = 'step';
		sIn._fire('input', {});
		assert.ok(sCnt.textContent.includes('找到 1 条记录'), `lowercase query finds Step: ${sCnt.textContent}`);
		const sRow = sList.children.find((c) => c.className === 'dsh-whale-history-row');
		const sText = sRow.children.find((c) => c.className === 'dsh-whale-history-text');
		assert.ok(sText.children.some((c) => c.textContent === 'Step'), 'mark keeps the ORIGINAL casing, not the query');
		sIn.value = 'STEP';
		sIn._fire('input', {});
		assert.ok(sCnt.textContent.includes('找到 1 条记录'), 'uppercase query also matches');
		dS.children.find((c) => c.className === 'dsh-whale-panel-foot')
			.children.find((c) => c.className === 'dsh-whale-wardrobe-close')._fire('click', { stopPropagation() {} });
		/* absolute-time reminder: three 时/分/秒 dropdowns, add button */
		BS.openReminders();
		const rPanel = bodyS.children.find((c) => c.className === 'dsh-whale-settings');
		const absRowEl = rPanel.children.find((c) => (c.className || '').indexOf('dsh-whale-remind-row') >= 0);
		assert.ok(absRowEl, 'absolute-time row exists');
		const steps = absRowEl.children.filter((ch) => (ch.className || '').indexOf('dsh-whale-step') === 0);
		assert.strictEqual(steps.length, 3, 'three stepper widgets (时/分/秒)，不再是展开一整列的下拉');
		const sVal = (w) => w.children.find((ch) => ch.className === 'dsh-whale-step-val');
		assert.ok(sVal(steps[0]) && sVal(steps[0]).value.length === 2, 'hour stepper value zero-padded');
		/* explicit text add row (a bare ➕ icon is unreadable — user feedback) */
		const addRowEl = rPanel.children.find((c) => (c.className || '').indexOf('dsh-whale-remind-addrow') >= 0);
		assert.ok(addRowEl && addRowEl.textContent.includes('添加提醒'), 'text add-row exists (no cryptic icon-only button)');
		const stored = () => JSON.parse(envS.sandbox.localStorage.getItem('dsh-whale:reminders') || '[]');
		/* wrap-around: hour 0 minus → 23 */
		sVal(steps[0]).value = '0';
		steps[0].children.find((c) => c.className === 'dsh-whale-step-btn')._fire('click', { stopPropagation() {} });
		assert.strictEqual(sVal(steps[0]).value, '23', 'hour wraps 0 → 23 on minus');
		/* typed input: clamped / garbage falls back */
		sVal(steps[1]).value = '99';
		sVal(steps[1])._fire('change', {});
		assert.strictEqual(sVal(steps[1]).value, '59', 'typed minute clamped to 59');
		sVal(steps[1]).value = 'abc';
		sVal(steps[1])._fire('change', {});
		assert.strictEqual(sVal(steps[1]).value, '00', 'garbage input falls back to 00');
		/* pick 9:05 via steppers */
		sVal(steps[0]).value = '09';
		sVal(steps[1]).value = '05';
		addRowEl._fire('click', { stopPropagation() {} });
		assert.strictEqual(stored().length, 1, 'HH:MM picked via steppers');
		const d1 = new Date(stored()[0].at);
		assert.strictEqual(d1.getHours(), 9, 'hour kept');
		assert.strictEqual(d1.getMinutes(), 5, 'minute kept');
		assert.strictEqual(d1.getSeconds(), 0, 'seconds default to 0');
		assert.ok(stored()[0].at > Date.now() - 2000, 'target is in the future (today, or tomorrow if already past)');
		/* 23:59:59 */
		sVal(steps[0]).value = '23';
		sVal(steps[1]).value = '59';
		sVal(steps[2]).value = '59';
		addRowEl._fire('click', { stopPropagation() {} });
		assert.strictEqual(stored().length, 2, 'HH:MM:SS picked via steppers');
		const d2 = new Date(stored()[1].at);
		assert.strictEqual(d2.getHours(), 23, 'hour kept (SS form)');
		assert.strictEqual(d2.getSeconds(), 59, 'seconds kept');
		assert.ok(stored()[1].text.includes('23:59:59'), 'pending label carries the concrete time');
		const rPanel2 = bodyS.children.find((c) => c.className === 'dsh-whale-settings');
		assert.ok(rPanel2.textContent.includes('点按取消') && rPanel2.textContent.includes('月'), 'pending rows show the concrete date/time');
		/* reminders panel is entered from the right-click MENU: back must
		 * say 返回菜单 and reopen the menu (navigation hierarchy 菜单→设置→子面板) */
		const remFoot = rPanel2.children.find((c) => c.className === 'dsh-whale-panel-foot');
		const remBack = remFoot && remFoot.children.find((c) => c.textContent.indexOf('返回菜单') >= 0);
		assert.ok(remBack, 'reminders panel carries a 返回菜单 back button');
		remBack._fire('click', { stopPropagation() {} });
		assert.ok(bodyS.children.find((c) => c.className === 'dsh-whale-menu'),
			'reminders back reopens the right-click menu (not settings)');
	}

	console.log(`ALL TESTS PASSED (${Math.round(performance.now() - t)}ms)`);
	/* the whale keeps timers; exit explicitly so node doesn't hang */
	process.exit(0);
}

main().catch((error) => {
	console.error('TEST FAILED:', error);
	process.exit(1);
});
