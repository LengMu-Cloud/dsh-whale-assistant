/**
 * Pure chip-gate policy for the alpha adapter — NO DOM, NO timers of its
 * own: every input is a fact gathered by the MutationObserver callback and
 * `now` is injected, so the whole policy is unit-testable. The test file
 * requires this module directly (the browser build shares it inside the
 * IIFE; `module` is undefined there so the export guard is a no-op).
 *
 * `st` is the adapter-owned state bag (mutated in place):
 *   lastKnownTitle   {string} document.title at the previous batch
 *   streamingArmed   {boolean} live streaming was seen for this conversation
 *   armStreak        {number} consecutive small in-flow batches
 *   lastArmAt        {number} ts of the last arming-eligible batch
 *   renderUntil      {number} skip-window after a detected (re)render
 *   turnEndUntil     {number} cooldown: no chip fires before this ts
 *
 * Facts for one batch `f`:
 *   now, title, addedEls, addedChars, chipCount, inFlow
 *
 * Returns one action:
 *   { action: 'skip-render', reason } — a (re)render was detected
 *   { action: 'skip' }                — nothing to do
 *   { action: 'arm' }                 — streaming evidence, stay quiet
 *   { action: 'chip' }                — fire turn/end for the single chip
 *
 * TURN/START IS NOT DETECTED HERE (2026-09-02 revision): every composer-
 * clear heuristic eventually mistook DSH's own flow mutations (timestamp
 * refreshes, lazy rows, in-flow re-renders) for a "confirmed send" and
 * faked an 开工 — and the tool box then hung waiting for a turn that never
 * existed. The server event bus carries the AUTHORITATIVE turn/start for
 * EVERY session (core/server-events.js owns start announcements now, with
 * a per-session throttle); the DOM adapter only detects the live FINISH
 * (chip) for zero latency, exactly as before.
 */
function decideChipAction(st, f) {
	var now = f.now;

	/* gate 1 — title: a switch re-renders the NEW conversation; anything in
	 * this batch belongs to it, never to a live turn */
	if (f.title !== st.lastKnownTitle) {
		st.lastKnownTitle = f.title;
		st.streamingArmed = false;
		st.armStreak = 0;
		st.renderUntil = now + 2500;
		return { action: 'skip-render', reason: 'title' };
	}
	/* gate 2 — render cooldown: lazy render tails of a just-detected render */
	if (now < st.renderUntil) {
		return { action: 'skip-render', reason: 'cooldown' };
	}

	var bigRender = f.addedEls > 40 || f.addedChars > 6000 || f.chipCount >= 2;

	/* gate 3 — bulk render (switch/jump/scroll-paging): whole-log re-renders
	 * and multi-chip batches, armed or not. A single chip while ARMED falls
	 * through (the finished message may re-render together with its chip). */
	if (bigRender && (f.chipCount !== 1 || !st.streamingArmed)) {
		st.streamingArmed = false;
		st.armStreak = 0;
		st.renderUntil = now + 2500;
		return { action: 'skip-render', reason: 'bulk' };
	}

	if (f.chipCount === 0) {
		/* gate 4 — arming: small text additions inside the flow at streaming
		 * cadence (two within 5s) arm the adapter; one-off scroll-paged rows
		 * never reach the streak */
		var flowEvidence = f.addedChars > 0 && f.inFlow;
		if (flowEvidence) {
			st.armStreak = now - st.lastArmAt < 5000 ? st.armStreak + 1 : 1;
			st.lastArmAt = now;
			if (st.armStreak >= 2) st.streamingArmed = true;
		} else {
			st.armStreak = 0;
		}
		return { action: 'arm' };
	}

	/* chips present — a live finish adds ONE new chip in a small batch */
	if (now < st.turnEndUntil) {
		return { action: 'skip-render', reason: 'turn-end-cooldown' };
	}
	/* gate 5 — a chip with no live streaming behind it: a re-rendered
	 * history row (big renders were already handled above) */
	if (!st.streamingArmed) {
		return { action: 'skip', reason: 'unarmed' };
	}
	if (bigRender) {
		/* single chip inside a big batch while armed: likely the finished
		 * message re-rendering together with its chip — allow, but treat as
		 * a render for the follow-up tail */
		st.renderUntil = now + 2500;
	}
	st.streamingArmed = false;
	st.armStreak = 0;
	/* completion text renders in pieces: the chip re-renders with it —
	 * never double-fire inside the tail (real turns need a new send +
	 * stream and cannot finish within 3.5s of the previous one) */
	st.turnEndUntil = now + 3500;
	return { action: 'chip' };
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { decideChipAction: decideChipAction };
}
