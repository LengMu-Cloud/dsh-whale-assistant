	/* affection: earned by petting the whale (right-click twice). Long-term
	 * progression — tiers unlock new reaction lines, future hidden gear. */
	var AFFECTION_KEY = 'dsh-whale:affection';
	var affection = 0;
	var AFFECTION_TIERS = [
		{ min: 0, lines: ['呜…被摸到了 🥹', '唔…舒服，再摸一下？😳', '摸头会变笨的啦！🐋', '干嘛啦，我还在上班呢 😤'] },
		{ min: 10, lines: ['嘿嘿，就喜欢被摸头 🐳💙', '你是我最好的同事啦 🥰', '摸一次，元气 +10！⚡', '好啦好啦，我知道你疼我 😌'] },
		{ min: 50, lines: ['我们已经是好朋友了呀 🐳✨', '这辈子就跟着你混了 🐋❤️', '摸头是暗号，接住了！🫶', '我的心，已经是你的形状了 💙'] }
	];
	function loadAffection() {
		var stored = safeGet(AFFECTION_KEY, function (v0) {
			/* migrate { value: N } -> v1 */
			return (v0 && typeof v0 === 'object' && typeof v0.value === 'number') ? v0 : null;
		});
		if (stored && typeof stored.value === 'number') affection = stored.value;
	}
	function saveAffection() {
		safeSet(AFFECTION_KEY, { value: affection });
	}
	function affectionTier() {
		var tier = AFFECTION_TIERS[0];
		for (var i = 0; i < AFFECTION_TIERS.length; i++) {
			if (affection >= AFFECTION_TIERS[i].min) tier = AFFECTION_TIERS[i];
		}
		return tier;
	}
	function petLine() {
		var lines = affectionTier().lines;
		return lines[Math.floor(Math.random() * lines.length)];
	}

	/* ------------------------------------------------------------------ */
	/* Mux frame handling                                                  */
	/* ------------------------------------------------------------------ */
	/**
	 * Sub-tasks (background jobs) never announce: no bubble, no unread, no
	 * sound — they only move the workload/mood state and feed the click
	 * summary. Only the main task (conversation turns) and attention
	 * requests (approval/question) produce notifications.
	 *
	 * A second kind of sub-task is a spawned SUBAGENT: its session id is a
	 * bare UUID and its turn events (turn/start, turn/end) flow on the same
	 * mux channel. Those turns are sub-task activity too and stay silent —
	 * only sessions whose id starts with `session-` (the user's own
	 * conversations) are treated as the main task.
	 */
