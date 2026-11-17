	/* ------------------------------------------------------------------ */
	/* Own mux WebSocket (independent of the app's connection)             */
	/* ------------------------------------------------------------------ */
	var reconnectDelay = 1000;
	var reconnectTimer = null;
	var connectedOnce = false;
	var muxFails = 0;
	var muxHoldMs = null; /* test seam: override the reconnect delay（2026-11-18 僵尸守卫回归用） */

	function startMux() {
		var socket;
		try {
			socket = new WebSocket(MUX_URL);
		} catch (error) {
			scheduleReconnect();
			return;
		}
		window.__dshWhale.sockets.push(socket);
		/* ring-cap the diagnostic socket list: dead sockets from past
		 * reconnects (sleep/wake cycles churn dozens over a long session)
		 * would otherwise accumulate for the page's whole life */
		while (window.__dshWhale.sockets.length > 4) window.__dshWhale.sockets.shift();

		socket.addEventListener('open', function () {
			reconnectDelay = 1000;
			muxFails = 0; /* 真连上了——清零回常态退避（守卫不误伤降级恢复场景） */
			if (!connectedOnce) {
				connectedOnce = true;
				/* one-time notice that the task channel is live */
				say('任务通道已连接，随时汇报 🐋✨', 3500);
			}
		});
		socket.addEventListener('message', function (event) {
			if (typeof event.data !== 'string') return;
			var envelope;
			try {
				envelope = JSON.parse(event.data);
			} catch (error) {
				return;
			}
			var payload = envelope && envelope.payload;
			if (!payload || typeof payload.type !== 'string') return;
			try {
				handleMuxPayload(payload);
			} catch (error) {
				/* never break the channel loop */
			}
		});
		socket.addEventListener('close', scheduleReconnect);
		socket.addEventListener('error', function () {
			/* close follows; nothing to do here */
		});
	}

	function scheduleReconnect() {
		if (reconnectTimer !== null) return;
		/* 僵尸通道守卫（2026-11-18 全面分析 D-P0-3）：宿主 0.1.2 起
		 * /api/events.mux 路由已移除——连不上就是永远连不上，1s→15s 永动
		 * 重连是每窗口一条的纯失败流量（sleep/wake 还会 churn sockets）。
		 * 3 次重连失败即熔停；切回可见态时放行一次重试（宿主降级/恢复
		 * 场景），open 成功即清零回常态退避。 */
		if (muxFails >= 3) return;
		muxFails++;
		var delay = (typeof muxHoldMs === 'number' && muxHoldMs >= 0) ? muxHoldMs : reconnectDelay;
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			startMux();
		}, delay);
		reconnectDelay = Math.min(reconnectDelay * 2, 15000);
	}

	startMux();
	/* 僵尸守卫的放行阀：切回可见态且已熔停时放行一次重试 */
	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'hidden') return;
		if (muxFails >= 3 && reconnectTimer === null) { muxFails = 0; startMux(); }
	});
	/* 诊断/测试缝（2026-11-18）：僵尸守卫状态与重连延时覆盖 */
	window.__dshWhale._muxState = function () {
		return { fails: muxFails, timer: reconnectTimer !== null, delay: reconnectDelay, connectedOnce: connectedOnce };
	};
	window.__dshWhale._muxHoldMs = function (ms) { muxHoldMs = ms; };
	loadConfig();
	loadGearStats();
	loadAffection();
	/* BUG-1 boot 推（11-16）：origin 幸存时把本地好感度补推服务端（账本缺货
	 * 兜底，与 pushPetConfig boot 一推同款；里程碑有变更即推、不随 boot 推）。
	 * origin 全新（重启后端口变了）本地无存量——不推，反向等 /pet/state
	 * 下发采用。pushPetSync 声明在 exports.js（跨模块提升，运行时顺序无关）。 */
	if (PET_MODE && affectionKnown) pushPetSync({ aff: affection });
	loadHistory();

	/* ------------------------------------------------------------------ */
