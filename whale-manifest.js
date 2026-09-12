/**
 * Module manifest — SINGLE source of truth for whale-patch/whale.js.
 *
 * Every entry carries ONE contiguous line range (1-based, inclusive) of the
 * ORIGINAL whale-patch/whale.js. Entry order = build order = original order.
 * All src/ files share one IIFE scope at runtime.
 *
 * Usage:  node _split.js          (cut whale.js -> src/*)
 *         node build-whale.js     (join src/* -> whale.js)
 */
'use strict';

const MANIFEST = [
	{ file: 'src/index.js',             start: 1, end: 35 },    /* header + IIFE entry (opens the single scope) */
	{ inline: true, file: 'src/utils/constants.js' },           /* authored constants INSIDE the IIFE (after entry) */
	{ inline: true, file: 'src/types.js' },                     /* JSDoc typedefs (comments only, no runtime effect) */
	{ inline: true, file: 'src/utils/storage.js' },             /* versioned localStorage wrapper + migrator */
	{ inline: true, file: 'src/utils/session-key.js' },         /* active-session id resolution (shared by alpha-adapter + server-events) */
	{ inline: true, file: 'src/core/config.js' },               /* user config (CONFIG) + persistence */
	{ inline: true, file: 'src/core/history.js' },              /* recent task history + persistence */
	{ inline: true, file: 'src/core/stuck.js' },                /* tool-stuck watchdog (running-job aware) */
	{ inline: true, file: 'src/core/chip-gate.js' },            /* pure chip-gate policy (unit-testable, no DOM) */
	{ inline: true, file: 'src/core/alpha-adapter.js' },        /* alpha-compat: synthesizes mux frames from DOM/fetch (dsh 0.1.2-alpha) */
	{ inline: true, file: 'src/core/dedup.js' },                /* cross-channel dedup keys (attention/fail) + ring caps */
	{ inline: true, file: 'src/core/server-events.js' },        /* polls whale-assistant host event buffer: background sessions + real failure reasons + batch fold */
	{ inline: true, file: 'src/core/health.js' },               /* dependency self-check: poll HTTP / usage reads / jump hook */
	{ file: 'src/core/state.js',        start: 36, end: 56 },   /* shared top-level state */
	{ file: 'src/core/reports.js',      start: 57, end: 165 },  /* say / pushReport / readNext / badge count */
	{ file: 'src/core/dings.js',        start: 166, end: 319 }, /* WebAudio dings + mute */
	{ file: 'src/ui/status-panel.js',   start: 320, end: 464 }, /* token/pressure panel */
	{ file: 'src/core/sleep.js',        start: 465, end: 494 }, /* sleep/wake state */
	{ file: 'src/core/gear.js',         start: 495, end: 584 }, /* daily gear achievements */
	{ file: 'src/core/affection.js',    start: 585, end: 638 }, /* petting affection */
	{ file: 'src/core/frames.js',       start: 639, end: 1077 },/* mux frame handlers */
	{ file: 'src/utils/fmt-title.js',   start: 1078, end: 1153 }, /* truncate / taskTitle */
	{ file: 'src/core/mux.js',          start: 1154, end: 1214 }, /* own mux WebSocket + reconnect */
	{ file: 'src/ui/swim-effects.js',   start: 1215, end: 1382 }, /* swim math + ripples + splash */
	{ file: 'src/ui/messages.js',       start: 1383, end: 1436 }, /* UI copy pools (idle/catch/arrival) */
	{ file: 'src/core/mood.js',         start: 1437, end: 1548 }, /* 班味 mood system */
	{ file: 'src/ui/bubble.js',         start: 1549, end: 1564 }, /* uiSay */
	{ file: 'src/ui/bootstrap.js',      start: 1565, end: 1724 }, /* uiInit head: bubble/badge/zzz/gestures */
	{ file: 'src/ui/menu.js',           start: 1725, end: 2107 }, /* right-click menu / pet / wardrobe / help */
	{ file: 'src/input/swim.js',        start: 2108, end: 2216 }, /* swim-back animation + catch */
	{ file: 'src/input/drag.js',        start: 2217, end: 2394 }, /* drag / click-summary / sleep timer / uiInit close */
	{ file: 'src/core/exports.js',      start: 2395, end: 2476 }, /* DOMContentLoaded + diagnostic seams + IIFE close */
];

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { MANIFEST };
}