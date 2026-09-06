/**
 * dsh-whale — companion mascot for the DeepSeek Harness Web UI.
 *
 * - Draggable: pointer-drag moves it anywhere; position persists in
 *   localStorage ("dsh-whale:pos"). Double-click makes it SWIM back to the
 *   default corner: it turns to face the direction of travel (mirrored logo
 *   whale + live heading from the path tangent), undulates as it swims along
 *   a gentle arc, and trails expanding water ripples from its tail, ending
 *   with a little splash.
 * - Interactive: click shows a brief status summary / idle line.
 * - Job-aware: opens its OWN WebSocket to the host mux stream
 *   (/api/events.mux — a full broadcast, verified) and reports background-job
 *   transitions (started / completed / failed / killed) in a speech bubble,
 *   with a running-count badge. No polling, no interception of the app's
 *   socket, no interference with the app.
 * - Sub-task silence: background jobs (pwsh/bash/…) NEVER announce, and
 *   neither do spawned subagents — their turns are recognized by the bare-UUID
 *   session id and stay silent. Only the user's own conversations (session-
 *   prefixed ids) are the "main task" and announce turn/start + turn/end;
 *   approval/question requests announce for any session (the user must act).
 *
 * Baseline handling: the host pushes a `session/subscribed` frame whenever a
 * session (re)subscribes, immediately followed by that session's job baseline.
 * Jobs in that first baseline frame are adopted silently (no announcements),
 * so reloading the page never re-announces old jobs; only later transitions
 * speak.
 *
 * Exposed as window.__dshWhale for diagnostics/tests.
 */
(function () {
	'use strict';

	if (window.__dshWhale) return;
	window.__dshWhale = { sockets: [] };

