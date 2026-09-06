	function uiSay(text, duration, sessionId) {
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
