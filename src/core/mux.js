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
	loadHistory();

	/* ------------------------------------------------------------------ */
