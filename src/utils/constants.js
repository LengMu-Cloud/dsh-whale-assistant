/** Centralized magic values (inline module authored after the split).
	 * Consumers reference these names instead of raw literals. */

	/** Whale patch version (M5.1). Build-time override: build-whale.js reads
	 * env PATCH_VERSION; the default here is the fallback single source. */
	var PATCH_VERSION = '0.3.3';

	/** Session id prefix that marks a user conversation ("main task").
	 * Spawned subagents use bare UUIDs and are treated as silent sub-tasks. */
	var SESSION_ID_PREFIX = 'session-';

	/** Notification bubble display durations (ms). */
	var DURATION_START = 4500;   /* turn/start 开工了 */
	var DURATION_END = 6000;     /* turn/end 完成/失败/截断 + status panel */
	var DURATION_ATTN = 6000;    /* approval/question */

	/** Unread badge / report-queue caps. */
	var UNREAD_CAP = 99;         /* badge shows '99+' above this */
	var REPORT_QUEUE_CAP = 999;  /* hard bound on the queue */

	/** Daily gear rollover poll interval (ms). */
	var GEAR_ROLLOVER_MS = 60000;