	/* ------------------------------------------------------------------ */
	/* Own mux WebSocket (independent of the app's connection)             */
	/* ------------------------------------------------------------------ */
	var reconnectDelay = 1000;
	var reconnectTimer = null;
	var connectedOnce = false;

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
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			startMux();
		}, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 15000);
	}

	startMux();
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
