	/** Centralized magic values (inline module authored after the split).
	 * Consumers reference these names instead of raw literals. */

	/** 桌宠模式（第一批）：pet 页在 whale.js 之前定义 window.__dshPetHost
	 * （形态菜单缝 + 页面注入证据）；普通 DSH 页面没有它。整个共享 IIFE
	 * 里凡属桌宠专属分支（枚举 feed 端点 / 历史惰性 / 跳转文案 / 菜单缝）
	 * 都以它为总开关。 */
	var PET_MODE = typeof window !== 'undefined' && !!window.__dshPetHost;

	/** 桌宠合成会话前缀（与 lib/pet.js enumerateFrames 跨端契约）：宿主枚举
	 * feed 里的会话 id 一律 'session-pet-sN'——必须带 'session-' 主会话前缀，
	 * 否则鲸鱼的子代理静默闸门会吞掉全部任务通知（冒烟实测 10-31）；
	 * N=宿主 per-boot 会话码，页面据此显示「任务 N」。 */
	var PET_SID_PREFIX = 'session-pet-s';

	/** Whale patch version (M5.1). Build-time override: build-whale.js reads
	 * env PATCH_VERSION; the default here is the fallback single source. */
	var PATCH_VERSION = '0.4.3-rc.1';

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