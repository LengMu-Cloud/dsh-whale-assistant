	function uiSay(text, duration, sessionId) {
		/* 休眠期静默（桌宠在岗，页面鲸鱼只剩数据管线）——状态机在 core/state.js */
		if (petDormant) return;
		/* who owns the current bubble text — late-title rewrites must match */
		currentSaySession = sessionId || null;
		var bubble = document.querySelector('.dsh-whale-bubble');
		if (!bubble) return;
		bubble.textContent = text;
		bindBubbleHover(bubble);
		/* 1:1 lifecycle (user request): whenever the bubble switches or
		 * hides, the token/pressure panel below switches or hides WITH it —
		 * a stale usage panel must never outlive its notification and be
		 * mistaken for the next task's numbers. Report callers re-show the
		 * paired panel right after this call (same tick, no flicker). */
		hideStatusPanel();
		/* restart the pop-in animation on every message */
		bubble.classList.remove('show');
		void bubble.offsetWidth;
		bubble.classList.add('show');
		uiSay.visible = true;
		uiSay.remainMs = duration || 5000;
		uiSay.shownAt = Date.now();
		armBubbleHide(bubble, uiSay.remainMs);
		/* 动态边界（2026-11-04）：气泡原生只向上弹，鲸鱼贴顶时 2/3 出屏
		 * （实机 rect.top=-67）。show 前同步夹紧——offset 布局盒不受 pop
		 * 动画 transform 影响，判定无时序问题。 */
		clampBubble(true);
	}

	/** Keep the bubble inside the viewport (动态边界 2026-11-04): flip
	 * BELOW the whale when it would clip off the top (the
	 * `.dsh-whale-bubble-flip` variant mirrors the arrow and the pop
	 * animation), nudge horizontally with a margin when an edge clips it.
	 * Measured from the LAYOUT boxes (whale.offset* + bubble.offset*) which
	 * are immune to the pop animation's transform, so the call is safe both
	 * synchronously (uiSay, before .show) and live (updateStatusPos while
	 * the whale is dragged with a bubble open). Idempotent: clears the
	 * previous margin/flip first, then measures — flip can never oscillate
	 * because the measurement always happens in the un-flipped anchor. */
	function clampBubble(force) {
		var bubble = document.querySelector('.dsh-whale-bubble');
		if (!bubble || !whale) return;
		if (!force && !bubble.classList.contains('show')) return;
		bubble.style.marginLeft = '0px';
		bubble.classList.remove('dsh-whale-bubble-flip');
		if (!bubble.offsetWidth && !bubble.offsetHeight) return; /* vm stub */
		/* horizontal: the bubble is RIGHT-anchored (right:-8px), so for the
		 * over-constrained solve left = CBw - right - width - margin-left —
		 * a POSITIVE margin-left moves the box LEFT. To pull the box RIGHT
		 * (clipped at the left edge) the margin goes negative; to push it
		 * LEFT (clipped at the right edge) positive. 实机 11-04：两分支初版
		 * 写反，贴左气泡 left=-2 出屏 2px 实证后修正。 */
		var left = whale.offsetLeft + bubble.offsetLeft;
		var right = left + bubble.offsetWidth;
		if (left < 4) {
			bubble.style.marginLeft = (left - 4) + 'px';
		} else if (right > window.innerWidth - 4) {
			bubble.style.marginLeft = (right - (window.innerWidth - 4)) + 'px';
		}
		if (whale.offsetTop + bubble.offsetTop < 2) bubble.classList.add('dsh-whale-bubble-flip');
	}

	function armBubbleHide(bubble, ms) {
		clearTimeout(uiSay.timer);
		uiSay.timer = setTimeout(function () {
			uiSay.timer = null;
			uiSay.visible = false;
			bubble.classList.remove('show');
			hideStatusPanel();
		}, ms);
	}

	/* Hover pause (#9): mouse on the bubble freezes the countdown; leaving
	 * resumes the REMAINING time, floored at 1.5s so a bubble never vanishes
	 * the instant the cursor leaves. The paired panel below pauses with it
	 * (same 1:1 lifecycle). Bound once on the persistent bubble element. */
	function bubbleResumeMs(remainMs) {
		return Math.max(remainMs, 1500);
	}

	function bindBubbleHover(bubble) {
		if (uiSay.hoverBound) return;
		uiSay.hoverBound = true;
		bubble.addEventListener('mouseenter', function () {
			if (!uiSay.visible || !uiSay.timer) return;
			clearTimeout(uiSay.timer);
			uiSay.timer = null;
			uiSay.remainMs = Math.max(0, uiSay.remainMs - (Date.now() - uiSay.shownAt));
		});
		bubble.addEventListener('mouseleave', function () {
			if (!uiSay.visible || uiSay.timer) return;
			armBubbleHide(bubble, bubbleResumeMs(uiSay.remainMs));
		});
	}

	/** Faint transient note above the whale (clear-all feedback #10): never
	 * a bubble, never unread, never a sound — auto-fades, then removes. */
	function showWhaleNote(text, ms) {
		var host = document.getElementById('dsh-whale');
		if (!host) return;
		var note = document.createElement('div');
		note.className = 'dsh-whale-note';
		note.textContent = text;
		host.appendChild(note);
		setTimeout(function () {
			note.classList.add('out');
			setTimeout(function () {
				if (note.parentNode) note.parentNode.removeChild(note);
			}, 400);
		}, ms || 3000);
	}
