	/* ------------------------------------------------------------------ */
	var audioCtx = null;

	function ensureAudio() {
		if (audioCtx === null) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) {
				audioCtx = false;
				return false;
			}
			try {
				audioCtx = new AC();
			} catch (error) {
				audioCtx = false;
				return false;
			}
		}
		if (audioCtx === false) return false;
		if (audioCtx.state === 'suspended') {
			/*
			 * Autoplay policy: the first playback may hit a suspended context.
			 * resume() is ASYNC — returning false here would silently drop the
			 * ring, so schedule a re-pump once the context actually runs.
			 */
			var p;
			try {
				p = audioCtx.resume();
			} catch (error) {
				return false;
			}
			if (p && typeof p.then === 'function') {
				p.then(function () {
					if (dingKinds.length > 0) pumpDings();
				}).catch(function () {
					/* resume rejected; stay silent rather than crash */
				});
			}
			return false;
		}
		return audioCtx.state === 'running' ? audioCtx : false;
	}

	/**
	 * One synthesized notification. 'done' = bicycle-bell "ding-ding": two
	 * metallic strikes (2400Hz fundamental + 2×/2.76× inharmonic partials)
	 * with a long resonant decay. 'fail' = dull descending minor third
	 * (550 → 415). Back-to-back dings stay clear because the queue gap
	 * (DING_GAP_MS) outlasts the ring's decay.
	 * 'attention' = soft rising three-note chime. Dings are QUEUED: the next
	 * one waits for the previous ring to finish, so rapid notifications never
	 * overlap; a burst collapses to its latest sound.
	 */
	var dingKinds = [];
	var dingPlaying = false;
	var dingGen = 0;
	var DING_GAP_MS = 1900; /* ring tail is ~1.35s: the next ding waits out the full decay */

	function renderDing(kind) {
		/* volume 0 = fully silent. Skip the oscillators entirely: an
		 * exponentialRamp to 0 is ILLEGAL in the Web Audio API (target must
		 * be > 0) and would throw a RangeError on every notification. */
		if (typeof CONFIG === 'object' && CONFIG && CONFIG.volume <= 0) return true;
		var ctx = ensureAudio();
		if (!ctx) return false;
		var t0 = ctx.currentTime;
		var ring = function (startAt, freq, dur, vol) {
			var osc = ctx.createOscillator();
			var gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			/* master volume from CONFIG (0..1); never zero — exponential
			 * ramps require a positive target */
			var v = Math.max(0.0001, vol * CONFIG.volume);
			gain.gain.setValueAtTime(0.0001, startAt);
			gain.gain.exponentialRampToValueAtTime(v, startAt + 0.005);
			gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(startAt);
			osc.stop(startAt + dur + 0.05);
		};
		/* per-notification sound (设置 → 音色: 每种通知单独选) */
		var scheme = kind === 'done' ? CONFIG.soundDone
			: kind === 'fail' ? CONFIG.soundFail
			: kind === 'remind' ? CONFIG.soundRemind
			: CONFIG.soundAttn;
		if (scheme === 'ding') {
			/* single clean strike: E6 + soft octave */
			ring(t0, 1319, 0.6, 0.15);
			ring(t0, 2638, 0.45, 0.045);
			return true;
		}
		if (scheme === 'bell') {
			/* bicycle bell — two strikes, inharmonic partials */
			var strikes = [
				{ t: 0, d: 0.55, g: 0.16 },
				{ t: 0.32, d: 0.7, g: 0.13 }
			];
			var partials = [
				{ mult: 1, rel: 1 },
				{ mult: 2, rel: 0.35 },
				{ mult: 2.76, rel: 0.2 }
			];
			var BASE = 2400;
			for (var s = 0; s < strikes.length; s++) {
				for (var p = 0; p < partials.length; p++) {
					ring(t0 + strikes[s].t, BASE * partials[p].mult, strikes[s].d, strikes[s].g * partials[p].rel);
				}
			}
			return true;
		}
		if (scheme === 'chime') {
			/* soft two-note rise, marimba-ish */
			ring(t0, 784, 0.35, 0.14);
			ring(t0 + 0.14, 1046, 0.5, 0.12);
			return true;
		}
		/* kind-specific built-ins (when not overridden above) and 'none' */
		/* 'none' means SILENT — the kind-specific built-ins below must not
		 * ring either (pre-existing bug: attention 选静音仍会响内置琶音) */
		if (scheme === 'none') return true;
		if (kind === 'fail') {
			/* thud: dull descending minor third */
			ring(t0, 550, 0.22, 0.15);
			ring(t0 + 0.18, 415, 0.3, 0.11);
			return true;
		}
		if (kind === 'attention') {
			var chimes = [523, 659, 784];
			for (var c = 0; c < chimes.length; c++) {
				ring(t0 + c * 0.18, chimes[c], 0.3, 0.13);
			}
			return true;
		}
		return true; /* 'none': counted as played, silence */
	}

	function pumpDings() {
		if (dingPlaying || dingKinds.length === 0) return;
		dingPlaying = true;
		var kind = dingKinds.shift();
		var gen = dingGen;
		if (!renderDing(kind)) {
			/* audio not ready yet (autoplay resume pending): put the ring back
			 * and retry when the context actually runs */
			dingKinds.unshift(kind);
			dingPlaying = false;
			ensureAudio(); /* schedules the resume().then(pumpDings) retry */
			return;
		}
		setTimeout(function () {
			if (gen !== dingGen) return; /* reset invalidated the queue */
			dingPlaying = false;
			pumpDings();
		}, DING_GAP_MS);
	}

	/** 免打扰窗口：开着且当前本地时间落在 [from, to) 内（支持跨零点）。 */
	function dndActive() {
		if (!CONFIG.dndEnabled) return false;
		var toMin = function (v) {
			var p = /^(\d{1,2}):(\d{2})$/.exec(v || '');
			return p ? (+p[1]) * 60 + (+p[2]) : null;
		};
		var from = toMin(CONFIG.dndFrom);
		var to = toMin(CONFIG.dndTo);
		if (from === null || to === null || from === to) return false;
		var d = new Date();
		var cur = d.getHours() * 60 + d.getMinutes();
		return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
	}

	function playDing(kind) {
		if (soundMuted) return; /* right-click menu: one-tap mute */
		/* 免打扰: completion/failure sounds are dropped (attention still
		 * rings — the user must act on those regardless of the hour) */
		if (dndActive() && (kind === 'done' || kind === 'fail')) return;
		if (dingKinds.length >= 6) {
			/* an extreme burst: drop the oldest backlog so the queue stays sane */
			dingKinds.splice(0, dingKinds.length - 5);
		}
		dingKinds.push(kind);
		pumpDings();
	}

	/** Sound on/off for the dings, persisted ("dsh-whale:sound"). */
	var SOUND_KEY = 'dsh-whale:sound';
	var soundMuted = false;
	{
		soundMuted = safeGet(SOUND_KEY, function (v0) {
			/* migrate bare 'off'/'on' -> v1 envelope */
			return typeof v0 === 'string' ? v0 : null;
		}) === 'off';
	}
	function setSoundMuted(muted) {
		soundMuted = !!muted;
		safeSet(SOUND_KEY, soundMuted ? 'off' : 'on');
	}

	/* ------------------------------------------------------------------ */
	/* Live status: busy-tool bubbles, token/pressure, sleep, gear         */
