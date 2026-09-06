	/* Swim helpers (pure; no DOM state)                                   */
	/* ------------------------------------------------------------------ */
	function easeInOutCubic(t) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function bezierPoint(s, t) {
		var u = 1 - t;
		return {
			x: u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1,
			y: u * u * s.y0 + 2 * u * t * s.cy + t * t * s.y1
		};
	}

	/** Heading (degrees, clockwise from east) of the path tangent at t. */
	function bezierHeading(s, t) {
		var a = bezierPoint(s, t);
		var b = bezierPoint(s, Math.min(1, t + 0.02));
		return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
	}

	function reducedMotion() {
		var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		return !!(mq && mq.matches);
	}

	/* ------------------------------------------------------------------ */
	/* Ripple layer (fixed overlay, independent of the whale element)      */
	/* ------------------------------------------------------------------ */
	var rippleLayer = null;

	function ensureRippleLayer() {
		if (rippleLayer !== null) return rippleLayer;
		if (!document.body) return null;
		rippleLayer = document.createElement('div');
		rippleLayer.className = 'dsh-whale-ripple-layer';
		document.body.appendChild(rippleLayer);
		return rippleLayer;
	}

	/** One expanding, fading ring at viewport (x, y); self-removes. */
	function spawnRipple(x, y, size) {
		var layer = ensureRippleLayer();
		if (!layer) return;
		var ripple = document.createElement('div');
		ripple.className = 'dsh-whale-ripple';
		var s = size || 10;
		ripple.style.left = x + 'px';
		ripple.style.top = y + 'px';
		ripple.style.width = s + 'px';
		ripple.style.height = s + 'px';
		ripple.style.marginLeft = (-s / 2) + 'px';
		ripple.style.marginTop = (-s / 2) + 'px';
		layer.appendChild(ripple);
		setTimeout(function () {
			if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
		}, 900);
	}

	/**
	 * Water-like arrival splash, fully JS-driven (no CSS custom properties or
	 * keyframes — every transform/opacity is computed inline per frame, so it
	 * renders identically everywhere): elliptical water-surface rings, a fan
	 * of radiating water jets, and gravity-arc spray droplets.
	 * @param x - impact x (viewport px)
	 * @param y - impact y (viewport px)
	 * @param ringCount - elliptical rings (default 4)
	 * @param jetCount - radiating jets (default 8)
	 * @param sprayCount - gravity droplets (default 10)
	 */
	function spawnWaterSplash(x, y, ringCount, jetCount, sprayCount) {
		var layer = ensureRippleLayer();
		if (!layer) return;
		var rings = ringCount === undefined ? 4 : ringCount;
		var jets = jetCount === undefined ? 8 : jetCount;
		var sprays = sprayCount === undefined ? 10 : sprayCount;
		var parts = [];
		var i;

		/* elliptical water-surface rings (wider than tall) */
		for (i = 0; i < rings; i++) {
			var size = 18 + i * 8;
			var ring = document.createElement('div');
			ring.className = 'dsh-whale-waterring';
			ring.style.left = x + 'px';
			ring.style.top = y + 'px';
			ring.style.width = size + 'px';
			ring.style.height = Math.round(size * 0.45) + 'px';
			ring.style.marginLeft = (-size / 2) + 'px';
			ring.style.marginTop = (-size * 0.45 / 2) + 'px';
			layer.appendChild(ring);
			parts.push({ el: ring, delay: i * 70, kind: 'ring' });
		}
		/* radiating water jets (upward fan) */
		for (i = 0; i < jets; i++) {
			var jet = document.createElement('div');
			jet.className = 'dsh-whale-jet';
			jet.style.left = x + 'px';
			jet.style.top = y + 'px';
			layer.appendChild(jet);
			parts.push({
				el: jet,
				delay: i * 40,
				kind: 'jet',
				angle: -160 + i * (140 / Math.max(1, jets - 1)) + (Math.random() * 14 - 7)
			});
		}
		/* gravity spray droplets (arc up, then fall) */
		for (i = 0; i < sprays; i++) {
			var drop = document.createElement('div');
			drop.className = 'dsh-whale-spray';
			drop.style.left = x + 'px';
			drop.style.top = y + 'px';
			layer.appendChild(drop);
			parts.push({
				el: drop,
				delay: i * 30,
				kind: 'spray',
				dx: Math.random() * 90 - 45,
				up: -(14 + Math.random() * 22)
			});
		}

		/* animation clock is relative to the first frame, so it works with any
		 * rAF source (browser or test driver) */
		var epoch = null;
		var total = 900;
		function splashTick(now) {
			if (epoch === null) epoch = now;
			var t = now - epoch;
			var alive = false;
			for (var p = 0; p < parts.length; p++) {
				var part = parts[p];
				var local = t - part.delay;
				if (local < 0) continue;
				var u = local / total;
				if (u >= 1) {
					part.el.style.opacity = '0';
					continue;
				}
				alive = true;
				var ease = 1 - Math.pow(1 - u, 2); /* ease-out */
				if (part.kind === 'ring') {
					var s = 0.3 + ease * 3.4;
					part.el.style.opacity = String(0.9 * (1 - u));
					part.el.style.transform = 'scaleX(' + (s * 2.2).toFixed(2) + ') scaleY(' + s.toFixed(2) + ')';
				} else if (part.kind === 'jet') {
					part.el.style.opacity = String(0.95 * (1 - u));
					part.el.style.transform = 'rotate(' + part.angle.toFixed(1) + 'deg) translateX(' + (ease * 42).toFixed(1) + 'px)';
				} else {
					/* spray: sideways drift + sine arc up and back down */
					var px = part.dx * Math.sin(Math.PI * Math.min(1, u * 1.15));
					var py = part.up * Math.sin(Math.PI * Math.min(1, u));
					part.el.style.opacity = String(Math.max(0, 1 - u));
					part.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
				}
			}
			if (alive) {
				requestAnimationFrame(splashTick);
			} else {
				for (var q = 0; q < parts.length; q++) {
					if (parts[q].el.parentNode) parts[q].el.parentNode.removeChild(parts[q].el);
				}
			}
		}
		requestAnimationFrame(splashTick);
	}

