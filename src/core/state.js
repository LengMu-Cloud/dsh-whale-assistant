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

	/* 桌宠仲裁（第一批）：pet.enabled 时页面鲸鱼休眠——隐藏 + 静默
	 * （台词 uiSay / 音效 playDing 入口拦下），但数据管线照跑（DOM 采集、
	 * 历史与台账继续记录），桌宠关闭后页面鲸鱼无缝回来。宿主 /events 轮询
	 * 响应带 pet.enabled，server-events 消费后调 applyPetDormant；
	 * localStorage 缓存让 client.js 在下一次 boot 时先于任何请求隐藏元素
	 * （防双鲸闪现）。状态放 core：core 的静默门（dings/server-events）与
	 * ui 的静默门（uiSay）都读它，core→ui 方向边不加。
	 * **内存态必须从同一份缓存初始化**（2026-10-31 真机洞）：client.js 开机
	 * 已按缓存 display:none，而内存态若从 false 起步，hello 送来
	 * pet.enabled=false 会撞上幂等闸门早退（false===false）——元素永久隐藏。
	 * 从缓存起步后，缓存"休眠"+内存"休眠"一致，第一次 hello=false 即正常
	 * 走唤醒分支清 display + 改写缓存。 */
	var petDormant = false;
	try { petDormant = localStorage.getItem('dsh-whale:petDormant') === '1'; } catch (e) {}
	/** 11-05 开机防双鲸第二层：是否消费过**权威**桌宠状态（hello/轮询/帧）。
	 * 非桌宠页开机一律先藏（不信任缓存 0——每次关 DSH 都会把它写成 0），
	 * 由权威状态强制应用或 6s 兜底 reveal 唤醒；bootReveal 只在
	 * 「从未见过权威状态且内存态非休眠」时出手（缓存 1 的开机不许被它吵醒）。 */
	var petStateSeen = false;
	function applyPetDormant(v, force) {
		v = !!v;
		petStateSeen = true;
		var changed = v !== petDormant;
		if (!changed && !force) return;
		/* force（11-05）：权威状态每 3s 轮询都会再来一次——值未变时 DOM
		 * 应用必须零抖动，尤其唤醒分支的 resize 会重座菜单锚点。只在
		 * 「真从隐藏翻出来」时派发 resize。 */
		var wasHidden = false;
		try {
			var el0 = whale || document.getElementById('dsh-whale');
			wasHidden = !!(el0 && el0.style.display === 'none');
		} catch (e0) {}
		petDormant = v;
		try { localStorage.setItem('dsh-whale:petDormant', v ? '1' : '0'); } catch (e) {}
		try {
			/* target: uiInit 的 whale 优先（client.js 的 holder 与它同一节点） */
			var el = whale || document.getElementById('dsh-whale');
			if (!el) return;
			if (v) {
				/* 让位（11-01 终版）：ready 握手时桌宠鲸鱼已出现在页鲸正上方
				 * （完全重叠）——瞬间隐藏即不可见，任何下潜/位移动画反而会
				 * 从桌宠鲸鱼底下"剥离"出第二只。桌宠随后从交接位自然游走。 */
				el.style.display = 'none';
			} else {
				/* 唤醒（真机洞 10-31#1）：loadPos 曾在 display:none 下执行，
				 * offsetWidth=0 让 seatFromAnchor 算出垃圾位——醒来后盒子尺寸
				 * 才真实。清除残留变换 + 重派 resize（menu.js 的锚点重座逻辑
				 * 原样复用，零新增 core→ui 依赖边），鲸鱼回到贴角正确位。
				 * 唤醒场景（第九轮常驻版）=桌宠进程死亡/平台不支持/开机先藏
				 * 后被权威状态唤醒的页内兜底。 */
				el.style.transition = 'none';
				el.style.transform = '';
				el.style.display = '';
				if (wasHidden) {
					try { window.dispatchEvent(new Event('resize')); } catch (e2) {}
				}
			}
		} catch (e) {}
	}
	function petStateEverSeen() { return petStateSeen; }
