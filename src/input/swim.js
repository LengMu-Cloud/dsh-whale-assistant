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
			/* capture BEFORE nulling: the peek dive flips the completion path */
			var petPeek = !!(swim && swim.petPeek);
			var peekCb = (swim && swim.peekCb) || null;
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
			/* arrival splash: flowing-water burst + a little bounce。
			 * petPeek 到达不撒水花不扭动：主体随即收成小气泡——只做安静落定。 */
			if (!petPeek) {
				var w = whale.offsetWidth;
				var h = whale.offsetHeight;
				spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
				whale.classList.add('dsh-whale-splash');
				setTimeout(function () {
					whale.classList.remove('dsh-whale-splash');
				}, 600);
				wiggle();
			}
			updateStatusPos();
			/* 桌宠常驻（第九轮用户定稿）：没有进入/退出交接，只有躲猫猫潜入。
			 * 页内双击回游维持随机到达台词。 */
			if (petPeek) {
				/* 躲猫猫到达右下角：静默（主体随即收成小气泡），写回落点并回调
				 * 页面（收鲸鱼、显小气泡） */
				try { savePos(); } catch (e) {}
				if (peekCb) peekCb();
			} else {
				uiSay(ARRIVAL_LINES[Math.floor(Math.random() * ARRIVAL_LINES.length)]);
			}
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

		/** Shared swim core: bezier arc from the whale's CURRENT position to
		 * (x1, y1) with the ripple trail + arrival splash. opts.petPeek marks
		 * the hide-into-bubble dive (silent arrival + done callback).
		 * swimToCorner keeps its exact historical semantics (POS removal +
		 * bottom-right); tests drive this shape. */
		function startSwim(x1, y1, opts) {
			var x0 = whale.offsetLeft;
			var y0 = whale.offsetTop;
			if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return false;
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
			lastRipple: 0,
			petPeek: !!(opts && opts.petPeek),
			peekCb: (opts && typeof opts.peekCb === 'function') ? opts.peekCb : null
		};
			requestAnimationFrame(swimFrame);
			return true;
		}

		/** Animated directional swim back to the default corner. */
		function swimToCorner() {
			closeCtxFloats(); /* swimming away closes any open float */
			var x1 = window.innerWidth - whale.offsetWidth - DEFAULT_RIGHT;
			var y1 = window.innerHeight - whale.offsetHeight - DEFAULT_BOTTOM;
			safeRemove(POS_KEY);
			if (reducedMotion()) {
				applyPos(x1, y1);
				return;
			}
			startSwim(x1, y1);
		}

		/** 桌宠入场（第九轮用户定稿：桌宠常驻，无进入/退出交接）——PET_MODE
		 * 下 uiInit 的 loadPos 已把鲸鱼放回家（上次落点），这里只做两件事：
		 * 恢复透明度（pet 页 CSS opacity 0→1 淡入，首建区域的 DWM re-clip 帧
		 * 藏进淡入段）+ 立 entranceReady（页面从此才发首帧区域+ready 握手，
		 * 页鲸让位仲裁照旧）。鲸鱼开机即在家里，没有跨窗口交接=闪现无从谈起。 */
		function petEntranceSwim() {
			if (!whale) return;
			try { whale.style.opacity = '1'; } catch (e) {}
			try { if (window.__dshPetHost) window.__dshPetHost.entranceReady = true; } catch (e) {}
		}
		/** 躲猫猫潜入（用户定稿 11-02）：「隐藏小鲸鱼」=鲸鱼游到桌面右下角钻进
		 * 角落，到达回调页面（收鲸鱼、在原位弹出小气泡）。到达静默——主体
		 * 随即收起。 */
		function peekHide(done) {
			if (!whale) { if (done) done(); return; }
			closeCtxFloats();
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			var x1 = window.innerWidth - w - DEFAULT_RIGHT;
			var y1 = window.innerHeight - h - DEFAULT_BOTTOM;
			x1 = Math.max(0, Math.min(x1, window.innerWidth - w));
			y1 = Math.max(0, Math.min(y1, window.innerHeight - h));
			var fire = function () {
				try { savePos(); } catch (e) {}
				if (done) done();
			};
			if (reducedMotion() || !startSwim(x1, y1, { petPeek: true, peekCb: fire })) {
				applyPos(x1, y1);
				fire();
			}
		}

		/** 躲猫猫跳出（小气泡单击）：鲸鱼在气泡处现身——弹跳+水花+台词，
		 * 落点写回（下次开机从这起）。display 恢复由页面负责（peekShow 只管
		 * 鲸鱼自己的 choreography）。 */
		function peekShow() {
			if (!whale) return;
			try {
				whale.classList.add('dsh-whale-bounce');
				setTimeout(function () { try { whale.classList.remove('dsh-whale-bounce'); } catch (e2) {} }, 600);
			} catch (e3) {}
			var w = whale.offsetWidth;
			var h = whale.offsetHeight;
			spawnWaterSplash(whale.offsetLeft + w / 2, whale.offsetTop + h * 0.8);
			whale.classList.add('dsh-whale-splash');
			setTimeout(function () { try { whale.classList.remove('dsh-whale-splash'); } catch (e4) {} }, 600);
			wiggle();
			uiSay('我回来啦 🐋', 3200);
			try { savePos(); } catch (e5) {}
		}
		if (typeof window !== 'undefined' && window.__dshWhale) {
			window.__dshWhale.peekHide = peekHide;
			window.__dshWhale.peekShow = peekShow;
		}

