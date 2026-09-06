	/* ------------------------------------------------------------------ */
	/* UI: speech bubble, badge, drag, click, swim-back                    */
	/* ------------------------------------------------------------------ */
	var POS_KEY = 'dsh-whale:pos';
	var DEFAULT_RIGHT = 18;
	var DEFAULT_BOTTOM = 18;
	var IDLE_LINES = [
		'我在旁边待命，一切顺利 🐋✨',
		'海面风平浪静～ 🌊😌',
		'任务都清空了，随时可以开工 💪',
		'别看我，我只是一只勤劳的小鲸鱼 🐳💦',
		'点击我，随时汇报进度哦 👀',
		'好无聊呀，给我找点活干吧 🥱',
		'今天也是元气满满的一天！🌟',
		'我在看海，也在看你 😊'
	];
	/** Said when the whale is grabbed mid-swim. */
	var CATCH_LINES = [
		'哎呀！被你抓住了！😱',
		'哇——别抓我！🫣',
		'咕噜咕噜…被抓到了 💦',
		'我游得还不够快呀 😤',
		'好吧好吧，你赢了 😝',
		'呜呜，放开我！🥺',
		'你这是偷袭！🐋💢'
	];
	/** Said when the whale finishes swimming back to its corner. */
	var ARRIVAL_LINES = [
		'我游回角落啦～ 🌊',
		'我游回角落啦！💦🐋',
		'我游回角落啦～ 🐳',
		'我游回角落啦，呼～ 😮‍💨'
	];
	/** Random emotional tail per report kind. */
	var VERB_TAILS = {
		running: ['🐋', '🐋💪', '🚀', '冲鸭！🐳', '走起！✨'],
		completed: ['✅', '🎉', '✨', '🎊', '完美！🌟', '漂亮！👏'],
		failed: ['⚠️', '😢', '💔', '翻车了 😿', '唔…😖'],
		killed: ['⏹️', '🫡', '好吧 🕊️'],
		stopping: ['🛑', '⏳'],
		remind: ['⏳', '🐳💦', '💪', '⏰'],
		busy: ['💪', '🔥', '冲呀！🚀']
	};

	function pickTail(key) {
		var list = VERB_TAILS[key];
		if (!list || list.length === 0) return '';
		/* a burnt-out whale lets its weariness leak into report tails */
		if (moodKey === 'burnt' && WEARY_TAILS[key] && Math.random() < 0.5) {
			return WEARY_TAILS[key][Math.floor(Math.random() * WEARY_TAILS[key].length)];
		}
		return list[Math.floor(Math.random() * list.length)];
	}

