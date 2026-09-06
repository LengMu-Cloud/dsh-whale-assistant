/**
 * Unit tests for the alpha adapter's chip-gate policy — the pure function
 * in src/core/chip-gate.js, required directly (no DOM, no vm).
 *
 * The scenarios mirror the live-verified mutation patterns:
 *   page-load render / switch render / lazy tail / unarmed history chip /
 *   live turn double-fire tail / scroll-paging arming.
 *
 * 2026-09-02 revision: the gate NO LONGER detects turn/start at all. Every
 * composer-clear heuristic faked an 开工 when DSH's own flow mutations
 * landed in the confirmation window; start announcements belong to the
 * server event bus (authoritative turn/start). These tests pin that
 * contract: NO input sequence can ever produce a 'turn-start' action.
 *
 * Usage: node test-chip-gate.js
 */
const { decideChipAction } = require('./src/core/chip-gate.js');
const assert = require('assert');

function freshState(title) {
	return {
		lastKnownTitle: title || 'A — DeepSeek Harness',
		streamingArmed: false,
		armStreak: 0,
		lastArmAt: 0,
		renderUntil: 0,
		turnEndUntil: 0
	};
}
let now = 1000000;
const tick = (ms) => { now += ms; };
const facts = (o) => Object.assign({ now, title: 'A — DeepSeek Harness', addedEls: 1, addedChars: 10, chipCount: 0, inFlow: true }, o);

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; }

/* 1. page-load render: many nodes + several chips → skipped, disarmed */
{
	const st = freshState();
	const d = decideChipAction(st, facts({ addedEls: 120, addedChars: 9000, chipCount: 19, inFlow: true }));
	check('load render skipped', d.action === 'skip-render');
	check('load render disarms', st.streamingArmed === false);
	const d2 = decideChipAction(st, facts({ addedChars: 30 })); /* lazy tail inside cooldown */
	check('cooldown tail skipped', d2.action === 'skip-render');
	tick(3000); /* past cooldown */
	const d3 = decideChipAction(st, facts({ chipCount: 1, addedChars: 40 }));
	check('unarmed lone chip stays silent', d3.action === 'skip' && d3.reason === 'unarmed');
}

/* 2. conversation switch: title changes with the big render */
{
	const st = freshState();
	const d = decideChipAction(st, facts({ title: 'B — DeepSeek Harness', addedEls: 90, addedChars: 5000, chipCount: 7 }));
	check('switch render skipped via title', d.reason === 'title');
	tick(3000); /* title-render cooldown lapses */
	const d2 = decideChipAction(st, facts({ title: 'B — DeepSeek Harness', addedEls: 90, addedChars: 5000, chipCount: 1 }));
	check('late-title big render skipped', d2.action === 'skip-render' && d2.reason === 'bulk');
}

/* 3. backspace deletes the whole draft: the gate must stay SILENT. The old
 * pending-start policy held the clear and waited for flow evidence — and
 * DSH's own in-flow re-renders (timestamp refreshes, lazy rows) supplied
 * that "evidence", faking an 开工. Now nothing in the DOM can fire a start. */
{
	const st = freshState();
	const d = decideChipAction(st, facts({ addedChars: 0, inFlow: false, addedEls: 0 }));
	check('draft clear is just an arm batch', d.action === 'arm' && st.pendingStartAt === undefined);
	tick(1000);
	const d2 = decideChipAction(st, facts({ addedChars: 2 })); /* DSH refreshes a timestamp */
	tick(1000);
	const d3 = decideChipAction(st, facts({ addedChars: 900 })); /* lazy rows */
	check('flow mutations never fire turn/start', d2.action === 'arm' && d3.action === 'arm');
	tick(25000);
	check('still no start after any window', decideChipAction(st, facts({ addedChars: 5 })).action === 'arm');
}

/* 4. a REAL send (composer clears + user bubble + stream) also does NOT
 * fire the start from the DOM — the server turn/start owns it; the gate
 * only arms the adapter for the later chip */
{
	const st = freshState();
	const d = decideChipAction(st, facts({ addedChars: 60 }));
	tick(300);
	const d2 = decideChipAction(st, facts({ addedChars: 20 }));
	check('send only arms the adapter', d.action === 'arm' && d2.action === 'arm' && st.streamingArmed === true);
}

/* 5. live turn: streaming arms (2 batches), then ONE chip fires turn/end */
{
	const st = freshState();
	decideChipAction(st, facts({ addedChars: 20 }));
	tick(300);
	const d = decideChipAction(st, facts({ addedChars: 8 }));
	check('second streaming batch arms', d.action === 'arm' && st.streamingArmed === true);
	tick(500);
	const c = decideChipAction(st, facts({ chipCount: 1, addedChars: 25 }));
	check('armed chip fires turn/end', c.action === 'chip');
	check('fire sets cooldown + disarms', st.turnEndUntil > now && st.streamingArmed === false);
	/* the completion text renders in pieces: the chip re-renders 70ms later */
	tick(70);
	const dup = decideChipAction(st, facts({ chipCount: 1, addedChars: 12 }));
	check('duplicate chip in the tail blocked by cooldown', dup.action === 'skip-render' && dup.reason === 'turn-end-cooldown');
}

/* 6. very short turn inside the cooldown window: NOT double-fired, and the
 * next real turn (after cooldown) still fires */
{
	const st = freshState();
	st.streamingArmed = true;
	const c1 = decideChipAction(st, facts({ chipCount: 1 }));
	check('first chip fires', c1.action === 'chip');
	tick(4000); /* past the 3.5s cooldown — a new quick turn streams + finishes */
	decideChipAction(st, facts({ addedChars: 15 }));
	tick(300);
	decideChipAction(st, facts({ addedChars: 10 }));
	const c2 = decideChipAction(st, facts({ chipCount: 1 }));
	check('next turn fires after cooldown', c2.action === 'chip');
}

/* 7. scroll-paging: one-off in-flow rows never arm (needs 2 in 5s) */
{
	const st = freshState();
	decideChipAction(st, facts({ addedChars: 900, addedEls: 8 }));
	tick(6000); /* gap > 5s resets the streak */
	const d = decideChipAction(st, facts({ addedChars: 900, addedEls: 8 }));
	check('streak reset by gap', st.armStreak === 1 && st.streamingArmed === false);
	const c = decideChipAction(st, facts({ chipCount: 1, addedChars: 200, addedEls: 3 }));
	check('paged history chip silent', c.action === 'skip' || c.action === 'skip-render');
}

/* 8. failure row does not consume the chip path: armed state survives to
 * the policy (the adapter checks the failure text around the decision) */
{
	const st = freshState();
	st.streamingArmed = true;
	const d = decideChipAction(st, facts({ addedChars: 60 }));
	check('policy still armed for error-row batches', st.streamingArmed === true && d.action === 'arm');
}

console.log('ALL CHIP-GATE TESTS PASSED (' + passed + ' checks)');
