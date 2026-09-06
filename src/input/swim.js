		/* --- swim-back animation (directional, with ripple trail) --- */
		var swim = null;

		function cancelSwim() {
			if (!swim) return false;
			swim = null;
			whale.classList.remove('dsh-whale-swimming');
			if (figure) {
				figure.style.transition = 'none';
				figure.style.transform = '';
			}
			return true;
		}

		function finishSwim() {
			swim = null;
			whale.classList.remove('dsh-whale-swimming');
			/* ease the figure back to the logo orientation */
			if (figure) {
				figure.style.transition = 'transform 0.25s ease';
				figure.style.transform = '';
				setTimeout(function () {
					if (figure) figure.style.transition = 'none';
				}, 300);
			}
			/* arrival splash: flowing-water burst + a little bounce */
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
			whale.classList.add('dsh-whale-splash');
			setTimeout(function () {
				whale.classList.remove('dsh-whale-splash');
			}, 600);
			wiggle();
			updateStatusPos();
			uiSay(ARRIVAL_LINES[Math.floor(Math.random() * ARRIVAL_LINES.length)]);
		}

		function swimFrame(now) {
			var s = swim;
			if (!s) return;
			var t = Math.min(1, (now - s.start) / s.duration);
			var e = easeInOutCubic(t);
			var p = bezierPoint(s, e);
			whale.style.left = p.x + 'px';
			whale.style.top = p.y + 'px';
			var phi = bezierHeading(s, e);
			/* sine sway on top of the true heading */
			var sway = Math.sin(now / 110) * 5;
			if (figure) {
				figure.style.transform = 'rotate(' + (phi + sway) + 'deg) scaleX(-1)';
			}
			/* keep an open status panel on-screen while swimming */
			updateStatusPos();
			/* water trail from the (mirrored) tail */
			if (now - s.lastRipple > 55) {
				s.lastRipple = now;
				spawnRipple(p.x + TAIL_X, p.y + TAIL_Y);
				var behind = bezierPoint(s, Math.max(0, e - 0.06));
				spawnRipple(behind.x + TAIL_X, behind.y + TAIL_Y, 8);
			}
			if (t < 1) {
				requestAnimationFrame(swimFrame);
				return;
			}
			finishSwim();
		}

		/** Animated directional swim back to the default corner. */
		function swimToCorner() {
			closeCtxFloats(); /* swimming away closes any open float */
			var x0 = whale.offsetLeft;
			var y0 = whale.offsetTop;
			var x1 = window.innerWidth - whale.offsetWidth - DEFAULT_RIGHT;
			var y1 = window.innerHeight - whale.offsetHeight - DEFAULT_BOTTOM;
			safeRemove(POS_KEY);
			if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return;
			if (reducedMotion()) {
				applyPos(x1, y1);
				return;
			}
			/* gentle arc: control point bulges toward the upper-left of travel */
			var dx = x1 - x0;
			var dy = y1 - y0;
			var len = Math.sqrt(dx * dx + dy * dy) || 1;
			var nx = -dy / len;
			var ny = dx / len;
			var bulge = Math.min(140, len * 0.28);
			cancelSwim();
			whale.style.transition = 'none';
			whale.classList.add('dsh-whale-swimming');
			swim = {
				x0: x0,
				y0: y0,
				cx: (x0 + x1) / 2 + nx * bulge,
				cy: (y0 + y1) / 2 + ny * bulge,
				x1: x1,
				y1: y1,
				start: performance.now(),
				/* leisurely pace so the swim can be interrupted by grabbing it */
				duration: Math.max(900, Math.min(2600, 500 + len * 1.4)),
				lastRipple: 0
			};
			requestAnimationFrame(swimFrame);
		}

