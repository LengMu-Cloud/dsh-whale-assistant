	var whale = null;
	var MUX_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/events.mux';

	/* ------------------------------------------------------------------ */
	/* Shared state between the mux channel and the UI                     */
	/* ------------------------------------------------------------------ */
	/** job id -> { status, label, kind, sessionId } */
	var known = new Map();
	/**
	 * Sessions whose next session/jobs frame is a silent baseline.
	 * Keyed by sessionId -> timestamp; a marker EXPIRES after BASELINE_TTL_MS,
	 * so a stale marker (subscribed with no jobs to baseline, e.g. an idle
	 * conversation) can never swallow the workload of a LATER brand-new job.
	 */
	var baselineSessions = new Map();
	var BASELINE_TTL_MS = 3000;
	var baselineTtlOverride = null; /* test seam */
	var pendingSay = [];
	var uiReady = false;
	/** sessionId of the report currently shown in the bubble (for late-title rewrites). */
	var currentSaySession = null;
