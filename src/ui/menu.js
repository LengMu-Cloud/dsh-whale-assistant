		/* --- right-click: single click opens the menu, double right-click
		 * pets the whale (affection +1). --- */
		var ctxMenu = null;
		var ctxPanel = null;
		var lastCtxAt = 0;
		var CTX_DBL_MS = 400;
		var CTX_MENU_W = 180;

		function closeCtxMenu() {
			if (ctxMenu) ctxMenu.classList.remove('show');
		}
		function closeCtxPanel() {
			if (ctxPanel) ctxPanel.classList.remove('show');
		}
		function closeCtxFloats() {
			closeCtxMenu();
			closeCtxPanel();
			closeCtxHistory();
		}

		/** Sub-panel footer. Back follows the navigation hierarchy
		 * 菜单 → 设置 → 子面板 (user request): panels entered from the
		 * right-click menu (提醒我) return TO THE MENU; panels entered from
		 * settings (音色/周报/运行状态) return to settings. */
		function mkPanelFoot(panel, onClose, backToMenu) {
			var foot = document.createElement('div');
			foot.className = 'dsh-whale-panel-foot';
			var backBtn = document.createElement('div');
			backBtn.className = 'dsh-whale-wardrobe-close dsh-whale-panel-back';
			if (backToMenu) {
				backBtn.textContent = '← 返回菜单';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					closeCtxPanel();
					openCtxMenu(whale.offsetLeft + 6, Math.max(8, whale.offsetTop - 12));
				});
			} else {
				backBtn.textContent = '← 返回设置';
				backBtn.addEventListener('click', function (event) {
					event.stopPropagation();
					openSettings();
				});
			}
			foot.appendChild(backBtn);
			var closeBtn = document.createElement('div');
			closeBtn.className = 'dsh-whale-wardrobe-close';
			closeBtn.textContent = '✕ 关闭';
			closeBtn.addEventListener('click', function (event) {
				event.stopPropagation();
				if (onClose) onClose();
				else closeCtxPanel();
			});
			foot.appendChild(closeBtn);
			panel.appendChild(foot);
		}

		/** Hearts float up from the whale's head (pet reaction, milestone
		 * celebration, idle affection — count defaults to the full burst). */
		function spawnHearts(count) {
			var layer = ensureRippleLayer();
			if (!layer) return;
			var x = whale.offsetLeft + whale.offsetWidth / 2;
			var y = whale.offsetTop + whale.offsetHeight * 0.3;
			var parts = [];
			var i;
			var total = count || 7;
			for (i = 0; i < total; i++) {
				var h = document.createElement('div');
				h.className = 'dsh-whale-heart';
				/* U+2764 + U+FE0E: force the TEXT variant so the CSS color
				 * (pink) applies — without the variation selector most
				 * platforms render the emoji face and ignore the color */
				h.textContent = '\u2764\uFE0E';
				h.style.left = x + 'px';
				h.style.top = y + 'px';
				layer.appendChild(h);
				parts.push({ el: h, delay: i * 60, dx: Math.random() * 70 - 35, up: -(26 + Math.random() * 22) });
			}
			var epoch = null;
			var total = 900;
			function heartsTick(now) {
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
					var ease = 1 - Math.pow(1 - u, 2);
					part.el.style.opacity = String(Math.max(0, 1 - u));
					part.el.style.transform = 'translate(' + (part.dx * ease).toFixed(1) + 'px,' +
						(part.up * Math.sin(Math.PI * Math.min(1, u))).toFixed(1) + 'px)';
				}
				if (alive) {
					requestAnimationFrame(heartsTick);
				} else {
					for (var q = 0; q < parts.length; q++) {
						if (parts[q].el.parentNode) parts[q].el.parentNode.removeChild(parts[q].el);
					}
				}
			}
			requestAnimationFrame(heartsTick);
		}

		/** Right-click double: pet the whale — reaction line + hearts + a
		 * happy bounce, and +1 affection (long-term progression). */
		function petWhale() {
			closeCtxFloats();
			touchActivity(); /* an explicit interaction wakes the whale */
			affection++;
			saveAffection();
			uiSay(petLine(), 3200);
			whale.classList.remove('dsh-whale-pet');
			void whale.offsetWidth;
			whale.classList.add('dsh-whale-pet');
			setTimeout(function () {
				whale.classList.remove('dsh-whale-pet');
			}, 720);
			spawnHearts();
			maybeCelebrateMilestone();
		}

		/** Affection milestones (#12'): crossing 10/50/100 fires a ONE-TIME
		 * bigger heart burst + a dedicated line. Remembered across reloads
		 * via localStorage; the celebration waits ~1.2s so it never tramples
		 * the pet reaction line (achievement-line lesson). */
		var AFF_MILESTONES = [
			{ at: 10, line: '好感度 10！我们熟起来了 🐳💙' },
			{ at: 50, line: '好感度 50！已经是最好的同事了吧 🥰' },
			{ at: 100, line: '好感度 100！这辈子就跟着你混了 🐋❤️✨' }
		];

		function maybeCelebrateMilestone() {
			var done = {};
			try {
				(localStorage.getItem('dsh-whale:affMs') || '').split(',').forEach(function (k) { if (k) done[k] = 1; });
			} catch (e) {}
			for (var i = 0; i < AFF_MILESTONES.length; i++) {
				var m = AFF_MILESTONES[i];
				var key = String(m.at);
				if (affection < m.at || done[key]) continue;
				done[key] = 1;
				try {
					localStorage.setItem('dsh-whale:affMs', Object.keys(done).join(','));
				} catch (e) {}
				setTimeout(function (mm) {
					return function () {
						uiSay(mm.line, 4200);
						spawnHearts(12);
					};
				}(m), 1200);
				return;
			}
		}

		/** Refresh + show the context menu near (clientX, clientY), flipping
		 * at the viewport edges. Content is rebuilt on every open so the
		 * sound label and mood header are always current. */
		function openCtxMenu(clientX, clientY) {
			closeCtxPanel();
			closeCtxHistory();
			var menu = ctxMenu || document.createElement('div');
			menu.className = 'dsh-whale-menu';
			menu.textContent = '';
			/* header: mood + live jobs */
			var head = document.createElement('div');
			head.className = 'dsh-whale-menu-head';
			var liveN = liveJobs().length;
			var moodName = MOOD_STAGES[moodStageIndex()].name;
			head.textContent = '🐳 ' + moodName + (liveN > 0 ? ' · ' + liveN + ' 个任务进行中' : ' · 待命中');
			menu.appendChild(head);
			/* reminder — 快捷操作 group first (#4) */
			var remindItem = document.createElement('div');
			remindItem.className = 'dsh-whale-menu-item';
			var pendingReminders = 0;
			try { pendingReminders = JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]').length; } catch (e) {}
			remindItem.textContent = '⏰ 提醒我' + (pendingReminders > 0 ? '（' + pendingReminders + ' 个待响）' : '');
			remindItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openReminders();
			});
			menu.appendChild(remindItem);
			/* sound toggle */
			var soundItem = document.createElement('div');
			soundItem.className = 'dsh-whale-menu-item';
			soundItem.textContent = soundMuted ? '🔇 声音：关' : '🔊 声音：开';
			soundItem.addEventListener('click', function (event) {
				event.stopPropagation();
				setSoundMuted(!soundMuted);
				uiSay(soundMuted ? '已静音 🔇' : '声音已开启 🔊', 1800);
				closeCtxMenu();
			});
			menu.appendChild(soundItem);
			/* group separator (#4): 快捷操作 above, 信息与设置 below */
			var menuSep = document.createElement('div');
			menuSep.className = 'dsh-whale-menu-sep';
			menu.appendChild(menuSep);
			/* help */
			var helpItem = document.createElement('div');
			helpItem.className = 'dsh-whale-menu-item';
			helpItem.textContent = '📖 使用说明';
			helpItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHelp();
			});
			menu.appendChild(helpItem);
			/* wardrobe */
			var dressItem = document.createElement('div');
			dressItem.className = 'dsh-whale-menu-item';
			dressItem.textContent = '🎨 我的装扮';
			dressItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openWardrobe();
			});
			menu.appendChild(dressItem);
			/* history */
			var historyItem = document.createElement('div');
			historyItem.className = 'dsh-whale-menu-item';
			historyItem.textContent = '📜 历史任务';
			historyItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openHistory();
			});
			menu.appendChild(historyItem);
			/* settings */
			var settingsItem = document.createElement('div');
			settingsItem.className = 'dsh-whale-menu-item';
			settingsItem.textContent = '⚙️ 设置';
			settingsItem.addEventListener('click', function (event) {
				event.stopPropagation();
				closeCtxMenu();
				openSettings();
			});
			menu.appendChild(settingsItem);
			if (!ctxMenu) document.body.appendChild(menu);
			ctxMenu = menu;
			/* position near the cursor, flipping at the viewport edges — the
			 * menu's REAL height is measured (the old fixed 170px guess grew
			 * to ~240px with 7 items and clipped the bottom rows off-screen:
			 * 设置 was literally unreachable when the whale sat low) */
			var mw = CTX_MENU_W;
			var mh = menu.offsetHeight || 170;
			var left = clientX;
			var top = clientY;
			if (left + mw > window.innerWidth - 8) left = clientX - mw;
			if (top + mh > window.innerHeight - 8) top = clientY - mh;
			menu.style.left = Math.max(8, left) + 'px';
			menu.style.top = Math.max(8, top) + 'px';
			menu.classList.remove('show');
			void menu.offsetWidth;
			menu.classList.add('show');
		}

		/** Clamp a floating panel near the whale (never off-screen) and show it.
		 * The panel is MEASURED while still invisible (opacity:0 keeps layout)
		 * — fixed size guesses broke as soon as a panel grew (the sound picker
		 * is ~2× the old estimate), pushing its rows off-screen: user-reported
		 * "设置显示不全/点了没反应". Below the whale first; flips above when
		 * there is no room; CSS caps height at the viewport and the panel
		 * scrolls internally. */
		function showFloatingPanel(panel, pw, ph) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || ph;
			var left = Math.round(whale.offsetLeft + whale.offsetWidth / 2 - w / 2);
			var top = whale.offsetTop + whale.offsetHeight + 10; /* prefer below */
			if (top + h > window.innerHeight - 8) top = whale.offsetTop - h - 10; /* flip above */
			if (top < 8) top = Math.max(8, whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			/* hard clamp: even a max-height-tall panel centered on a
			 * mid-screen whale must stay inside the viewport (bottom first,
			 * then top) — the panel scrolls internally beyond this */
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			if (left < 8) left = 8;
			panel.style.left = left + 'px';
			panel.style.top = Math.max(8, top) + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wide drawers (history/weekly report): anchored LEFT of the whale,
		 * flipping to its right when the wall is closer — same measured,
		 * viewport-clamped placement as showFloatingPanel. */
		function showSidePanel(panel, pw) {
			var w = panel.offsetWidth || pw;
			var h = panel.offsetHeight || Math.min(window.innerHeight - 16, 460);
			var left = whale.offsetLeft - w - 12;
			if (left < 8) left = whale.offsetLeft + whale.offsetWidth + 12;
			if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
			var top = Math.round(whale.offsetTop + whale.offsetHeight / 2 - h / 2);
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			if (top < 8) top = 8;
			panel.style.left = Math.max(8, left) + 'px';
			panel.style.top = top + 'px';
			panel.classList.remove('show');
			void panel.offsetWidth;
			panel.classList.add('show');
		}

		/** Wardrobe panel: gear progress + affection (dark, same language as
		 * the menu; opens near the whale, clamped to the viewport). */
		function openWardrobe() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-wardrobe';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎨 我的装扮';
			panel.appendChild(title);
			var i;
			for (i = 0; i < GEAR_DEFS.length; i++) {
				var def = GEAR_DEFS[i];
				var row = document.createElement('div');
				row.className = 'dsh-whale-wardrobe-row';
				var unlocked = unlockedGear.has(def.id);
				var leftTxt = document.createElement('span');
				leftTxt.textContent = def.emoji + ' ' + def.name;
				var rightTxt = document.createElement('span');
				if (unlocked) {
					rightTxt.textContent = '✅ 已解锁';
				} else {
					var need = Math.max(0, def.at - gearStats.tasksDone);
					rightTxt.textContent = '还差 ' + need + ' 个任务';
					row.classList.add('dsh-whale-wardrobe-locked');
				}
				row.appendChild(leftTxt);
				row.appendChild(rightTxt);
				panel.appendChild(row);
			}
			var affRow = document.createElement('div');
			affRow.className = 'dsh-whale-wardrobe-row dsh-whale-wardrobe-aff';
			var affL = document.createElement('span');
			affL.textContent = '❤️ 好感度';
			var affR = document.createElement('span');
			affR.textContent = '× ' + affection;
			affRow.appendChild(affL);
			affRow.appendChild(affR);
			panel.appendChild(affRow);
			mkPanelFoot(panel, null, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 210, 200);
		}

		/** 📖 使用说明: the full user manual, one scrollable side drawer.
		 * Covers what the whale is, every notification, every gesture, every
		 * settings row and where the data lives — THE authoritative doc for
		 * end users (the old 8-line gesture cheat sheet grew into this per
		 * user request, 2026-09-04). Lives in the side-drawer slot: wide,
		 * left of the whale, list scrolls, never stacks with other panels. */
		function openHelp() {
			closeCtxPanel();
			closeCtxHistory();
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history dsh-whale-manual';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📖 使用说明 ⚡ v' + PATCH_VERSION;
			panel.appendChild(title);
			/* keyword search (#5): filters rows live, jumps to the first hit */
			var mSearch = document.createElement('input');
			mSearch.className = 'dsh-whale-history-search dsh-whale-manual-search';
			mSearch.placeholder = '搜索说明…（如：红标、音色）';
			mSearch.addEventListener('click', function (event) { event.stopPropagation(); });
			panel.appendChild(mSearch);
			var mStatus = document.createElement('div');
			mStatus.className = 'dsh-whale-manual-status';
			panel.appendChild(mStatus);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			mSearch.addEventListener('input', function () {
				var q = (mSearch.value || '').trim();
				var rows = list.children;
				var n = 0;
				var first = null;
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers always stay visible */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (!first) first = el;
					}
				}
				mStatus.textContent = q ? (n > 0 ? '找到 ' + n + ' 条相关内容' : '未找到相关内容 🔍') : '';
				if (first && typeof first.scrollIntoView === 'function') {
					first.scrollIntoView({ block: 'nearest' });
				}
			});
			var sec = function (t) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				el.textContent = t;
				list.appendChild(el);
			};
			var item = function (term, desc) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				el.appendChild(t);
				if (desc) {
					var d = document.createElement('div');
					d.className = 'dsh-whale-manual-d';
					d.textContent = desc;
					el.appendChild(d);
				}
				list.appendChild(el);
			};
			var gesture = function (n, text) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-help-row';
				var num = document.createElement('span');
				num.className = 'dsh-whale-help-num';
				num.textContent = String(n);
				var text2 = document.createElement('span');
				text2.className = 'dsh-whale-help-text';
				text2.textContent = text;
				row.appendChild(num);
				row.appendChild(text2);
				list.appendChild(row);
			};
			sec('🚀 快速上手');
			item('右键点我：打开菜单', '所有功能都在右键菜单里——提醒我、装扮、历史任务、设置、使用说明。先记住这一个手势就够了。');
			item('点我一下：读通知', '有未读就逐条读给你（红标数字会减）；没有未读就陪我聊一句。');
			item('双击通知气泡：跳回对话', '任何完成/失败/提问通知，双击就能回到那条对话现场。');
			item('拖着我走：位置会记住', '按住我拖到喜欢的角落，刷新后还在这。');
			sec('🐳 我是什么');
			item('打工小鲸鱼，住在 DeepSeek Harness 右下角', '只读任务事件做播报和记录，不拦截、不修改任何任务行为，随便折腾不影响工作。任务在后台跑我也会看着，跑完 3 秒内告诉你。');
			sec('🔔 通知一览');
			item('[对话名]开工了 …', '任务开始跑。不进红标（不算未读）。');
			item('[对话名]完成了 …', '正常结束：响一声 + 红标 +1，下方同时弹出用量面板（本次消耗 / 全对话累计 / 上下文占用），和气泡同生同灭。');
			item('[对话名]失败了 …', '出错了：低沉音 + 红标 +1。双击通知气泡可回去看看。');
			item('[对话名]被截断了 …', '回复顶到 max tokens 上限，任务本身没坏。');
			item('[对话名]被中止了 ✋', '你手动停了任务，不算失败。');
			item('🤔 [对话名]需要你选择', '模型在等你作答：响铃 + 红标 +1。回到对话作答即收尾；任务还没跑完，用量等完成通知再统一看。');
			item('⚠️ [对话名]需要你审核', '有工具调用等你批准：同上。');
			item('上下文快挤爆了…建议 /compact', '上下文占用达到压力阈值时提醒一次。');
			item('⏰ 定时提醒', '右键菜单设的闹钟到点播报（不进红标，不带用量面板）。');
			sec('🐾 交互手势');
			gesture(1, '左键拖动：移动我');
			gesture(2, '左键单击：进行互动（读通知）');
			gesture(3, '左键双击：游回角落（中途可抓住）');
			gesture(4, '双击通知气泡：跳转对应对话');
			gesture(5, '左键单击红标数字：读通知');
			gesture(6, '左键双击红标数字：通知清空');
			gesture(7, '右键：打开菜单');
			gesture(8, '右键双击：触发摸摸头');
			sec('🎛️ 设置项详解');
			item('🔔 开工通知（开/关）', '关掉后"开工了"不再播报，其余通知不受影响。');
			item('🌙 免打扰', '时段内完成/失败不弹泡不响铃，只记红标；需要你动手的选择/审核照常提醒，急事不瞒你。');
			item('🔊 音量', '提示音音量，5 档循环。');
			item('🎵 音色（按通知设置）', '完成/失败/提问、定时提醒四类通知各选各的音效：单声叮 / 叮叮两连击 / 清脆上行 / 低沉下行 / 静音，下拉选中即生效并现场试听。');
			item('⏱️ 工具超时', '某个工具跑超过该时长时提示一次"可能卡住了"（只是提醒，不会打断任务）。');
			item('🚨 压力提醒', '上下文占用达到该百分比时提醒 /compact；回降到 50% 以下后重新武装。');
			item('📊 任务周报', '近 7 天按日统计任务数（完成/失败/中止/提问）与 token 消耗。');
			item('📤 导出历史', 'Markdown：复制全部历史到剪贴板；CSV：下载表格文件。');
			item('🩺 运行状态', '鲸鱼自查各条通知链路（后台通知/用量读取/跳转）；平时全部正常、不打扰，出问题我头上会亮 ⚠️，设置里点"运行状态"能看是哪一条。');
			item('🩺 调试模式', '排障用：开启后往控制台输出调试信息，并把取证数据写进 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。');
			sec('📜 历史与红标');
			item('红标数字 = 未读通知数', '左键单击读一条（读过的消失），双击一键清空。完成/失败/提问/审核计入，开工/提醒不计入。');
			item('📜 历史任务（右键菜单）', '保留最近 50 条：本地 + 服务器双存储，桌面壳和别的浏览器窗口看到同一份；支持搜索、清空、导出。');
			item('跳回对话', '双击通知气泡，或点历史抽屉里的任意一条记录。');
			sec('❤️ 陪伴小彩蛋');
			item('摸摸头', '右键双击我：好感 +1，还有小心心飘出。');
			item('状态与情绪', '任务越多我越累、会打瞌睡（左键单击唤醒）；右键菜单标题能看当前心情和进行中的任务数。');
			item('装扮与成就', '完成任务攒进度，解锁新装扮后去 右键菜单 → 🎨我的装扮 查看。');
			sec('🙋 常见问题');
			item('怎么没有声音？', '依次看：右键菜单 🔊 声音是否开 → 设置里音量 → 🎵 音色里对应通知是否选了"静音" → 是否在免打扰时段（深夜只记红标不出声）。');
			item('通知突然不来了？', '多半是页面放久了过期：按 Ctrl+F5 刷新即可恢复。我自己的链路自检在 设置 → 🩺 运行状态 里，哪条失效会明说。');
			item('后台任务会打扰我吗？', '不会：只有完成/失败/需要你动手时才提醒，中间过程只在状态面板安静展示；深夜时段只记红标不出声。');
			item('换浏览器历史还在吗？', '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份；跨机器不同步。');
			panel.appendChild(list);
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			showSidePanel(panel, 380);
		}

		/** History drawer: recent finished tasks (newest first), each row can
		 * jump back to its conversation via the session-opening hook. Uses a
		 * separate panel slot so it can be wider and left-anchored. */
		var ctxHistory = null;
		/** icon glyph for a history record kind */
		function historyIcon(kind) {
			if (kind === 'done') return { text: '✓', cls: 'dsh-whale-history-icon-done' };
			if (kind === 'fail') return { text: '✗', cls: 'dsh-whale-history-icon-fail' };
			if (kind === 'approval') return { text: '?', cls: 'dsh-whale-history-icon-approval' };
			if (kind === 'question') return { text: '?', cls: 'dsh-whale-history-icon-question' };
			if (kind === 'killed') return { text: '⏹', cls: 'dsh-whale-history-icon-killed' }; /* blue: user-stopped, not a truncation */
			return { text: '⏹', cls: 'dsh-whale-history-icon-cut' };
		}
		/** Case-insensitive indexOf（用户反馈）: 搜 step 必须命中 Step/STEP。 */
		function indexOfCI(hay, needle) {
			var n = (needle || '').toLowerCase();
			if (!n) return -1;
			return (hay || '').toLowerCase().indexOf(n);
		}
		/** Render `text` into `el` with the first `q` occurrence highlighted
		 * (#7), windowed around the match so long titles stay compact. The
		 * match is case-insensitive but the marked text keeps its ORIGINAL
		 * casing (copied from `text`, not from `q`). */
		function setHighlightText(el, text, q) {
			var idx = indexOfCI(text, q);
			if (idx < 0) { el.textContent = truncate(text, 16); return; }
			var start = Math.max(0, idx - 4);
			var end = Math.max(start + 24, idx + q.length + 8);
			var frag = (start > 0 ? '…' : '') + text.slice(start, end);
			var rel = idx - start;
			el.textContent = '';
			el.appendChild(document.createTextNode(frag.slice(0, rel)));
			var hit = document.createElement('mark');
			hit.textContent = frag.substr(rel, q.length);
			el.appendChild(hit);
			el.appendChild(document.createTextNode(frag.slice(rel + q.length)));
		}

		/* search result count line (#7) — created by openHistory, updated here */
		var historyCountEl = null;

		/** (Re)fill the history list element from the current `history`.
		 * Called by openHistory AND after each cloud pull — the server merge
		 * can bring records saved by other windows while the drawer is open. */
		function fillHistoryList(list) {
			list.textContent = '';
			if (history.length === 0) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '还没有任务记录哦 🐳';
				list.appendChild(empty);
				if (historyCountEl) historyCountEl.textContent = '';
				return;
			}
			var shown = 0;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				if (historySearch &&
					indexOfCI(rec.title, historySearch) < 0 &&
					indexOfCI(rec.sessionId, historySearch) < 0) continue;
				shown++;
				var row = document.createElement('div');
				row.className = 'dsh-whale-history-row';
				var icon = document.createElement('span');
				var ic = historyIcon(rec.kind);
				icon.className = 'dsh-whale-history-icon ' + ic.cls;
				icon.textContent = ic.text;
				var text = document.createElement('span');
				text.className = 'dsh-whale-history-text';
				var titleFull = rec.title || '（未命名）';
				if (historySearch && indexOfCI(titleFull, historySearch) >= 0) setHighlightText(text, titleFull, historySearch);
				else text.textContent = truncate(titleFull, 16);
				var time = document.createElement('span');
				time.className = 'dsh-whale-history-time';
				var d = new Date(rec.at || 0);
				/* date + time: tasks pile up across days, HH:MM alone is ambiguous */
				time.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
					(d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
					(d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
				row.appendChild(icon);
				row.appendChild(text);
				row.appendChild(time);
				row.addEventListener('click', (function (sessionId, endTime, title) {
					/* the app's own sidebar navigation: the guaranteed fallback
					 * when the conversation-plugin hook is missing (stale page) */
					function openViaSidebar() {
						var divs = document.getElementsByTagName('div');
						for (var i = 0; i < divs.length; i++) {
							var cls = divs[i].className;
							var clsStr = typeof cls === 'string' ? cls : (cls && cls.baseVal) || '';
							if (clsStr.indexOf('sessionRow') < 0) continue;
							var t = (divs[i].textContent || '').trim();
							if (t && title && t.indexOf(title) === 0) {
								divs[i].click();
								return true;
							}
						}
						return false;
					}
					return function (event) {
						event.stopPropagation();
						closeCtxHistory();
						var opener = window.__dshOpenSession;
						if (typeof opener === 'function') {
							try {
								/* endTime (fallback: the record's `at`) lets the host
								 * page back until the log covers the moment this
								 * record happened */
								opener(sessionId, endTime);
								uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
								return;
							} catch (error) { /* fall through to the sidebar */ }
						}
						if (openViaSidebar()) {
							uiSay('正在跳转到该对话… 🐳', 1500, sessionId);
							return;
						}
						uiSay('跳转失败：请按 Ctrl+F5 刷新页面后重试 🥲', 3000, sessionId);
					};
				})(rec.sessionId, rec.endTime || rec.at, rec.title));
				list.appendChild(row);
			}
			if (historyCountEl) {
				historyCountEl.textContent = historySearch ? ('找到 ' + shown + ' 条记录') : '';
			}
			if (shown === 0) {
				var noMatch = document.createElement('div');
				noMatch.className = 'dsh-whale-history-empty';
				noMatch.textContent = '没有匹配的记录 🔍';
				list.appendChild(noMatch);
			}
		}
		/** History search text (drawer-local, not persisted). */
		var historySearch = '';

		/** 🎵 音色: per-notification sound picker — 每种通知各选各的音效，
		 * 点选即切换并现场试听。 */
		function openSoundPicker() {
			var KINDS = [
				{ key: 'soundDone', kind: 'done', label: '✅ 完成通知', opts: ['ding', 'bell', 'chime', 'none'] },
				{ key: 'soundFail', kind: 'fail', label: '❌ 失败通知', opts: ['thud', 'ding', 'bell', 'chime', 'none'] },
				{ key: 'soundAttn', kind: 'attention', label: '❓ 提问回答', opts: ['chime', 'ding', 'bell', 'none'] },
				{ key: 'soundRemind', kind: 'remind', label: '⏰ 定时提醒', opts: ['bell', 'ding', 'chime', 'thud', 'none'] }
			];
			var LABELS = { ding: '单声叮', bell: '叮叮（两连击）', chime: '清脆上行', thud: '低沉下行', none: '静音' };
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			/* extra width: label + its dropdown must fit on ONE row (层级) */
			panel.className = 'dsh-whale-settings dsh-whale-sound-panel';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🎵 音色';
			panel.appendChild(title);
			/* one dropdown per kind (user feedback: 同类交互统一走下拉/紧凑控件，
			 * 取代把所有选项铺满一屏的列表）；改动即试听，无需重建面板 */
			KINDS.forEach(function (k) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = k.label;
				row.appendChild(l);
				var sel = document.createElement('select');
				sel.className = 'dsh-whale-sound-sel';
				k.opts.forEach(function (opt) {
					var opt2 = document.createElement('option');
					opt2.value = opt;
					opt2.textContent = LABELS[opt];
					sel.appendChild(opt2);
				});
				sel.value = CONFIG[k.key];
				sel.addEventListener('click', function (event) { event.stopPropagation(); });
				sel.addEventListener('change', function () {
					var pa = {}; pa[k.key] = sel.value;
					if (applyConfig(pa)) saveConfig();
					playDing(k.kind); /* 现场试听 */
				});
				row.appendChild(sel);
				panel.appendChild(row);
			});
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 220);
		}

		/** ⏰ 提醒: presets in the right-click menu; persisted in
		 * localStorage so they survive reloads; a 20s interval fires due
		 * ones as bubble + attention chime + unread badge. */
		function loadReminders() {
			try { return JSON.parse(localStorage.getItem('dsh-whale:reminders') || '[]'); } catch (e) { return []; }
		}
		function saveReminders(list) {
			try { localStorage.setItem('dsh-whale:reminders', JSON.stringify(list)); } catch (e) {}
		}
		function openReminders() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '⏰ 提醒我';
			panel.appendChild(title);
			var PRESETS = [5, 10, 25, 60];
			PRESETS.forEach(function (min) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				row.textContent = '➕ ' + min + ' 分钟后提醒';
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var list = loadReminders();
					list.push({ at: Date.now() + min * 60000, text: min + ' 分钟时间到了' });
					saveReminders(list);
					uiSay('好，' + min + ' 分钟后提醒你 ⏰', 2000);
					openReminders();
				});
				panel.appendChild(row);
			});
			/* 指定时间提醒（用户需求）：时/分/秒三个紧凑步进器一行排开，
			 * −/+ 点按加减、也可直接键入数字，越界环绕/夹紧；已过今天的
			 * 时刻自动顺延到明天。存绝对时间戳，触发器零改动。 */
			var absSec = document.createElement('div');
			absSec.className = 'dsh-whale-settings-section';
			absSec.textContent = '指定时间（时 / 分 / 秒）';
			panel.appendChild(absSec);
			var absRow = document.createElement('div');
			absRow.className = 'dsh-whale-settings-row dsh-whale-remind-row';
			/* 时/分/秒三个步进器（用户反馈：原生 select 展开一大列太占页面；
			 * −/+ 点按加减、也可直接键入数字，越界环绕/夹紧） */
			var mkStep = function (max, def, step) {
				var wrap = document.createElement('span');
				wrap.className = 'dsh-whale-step';
				var inp = document.createElement('input');
				inp.className = 'dsh-whale-step-val';
				var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
				inp.value = pad(def);
				var mkBtn = function (txt, delta) {
					var b = document.createElement('span');
					b.className = 'dsh-whale-step-btn';
					b.textContent = txt;
					b.addEventListener('click', function (event) {
						event.stopPropagation();
						var v = (parseInt(inp.value, 10) || 0) + delta;
						if (v < 0) v = max; /* wrap around */
						if (v > max) v = 0;
						inp.value = pad(v);
					});
					return b;
				};
				wrap.appendChild(mkBtn('−', -step));
				wrap.appendChild(inp);
				wrap.appendChild(mkBtn('+', step));
				inp.addEventListener('click', function (event) { event.stopPropagation(); });
				inp.addEventListener('change', function () {
					/* typed input: clamp into range, garbage falls back to 0 */
					var v = parseInt(inp.value, 10);
					if (isNaN(v) || v < 0) v = 0;
					if (v > max) v = max;
					inp.value = pad(v);
				});
				wrap._val = function () {
					return Math.min(max, Math.max(0, parseInt(inp.value, 10) || 0));
				};
				return wrap;
			};
			/* sensible default: one hour from now, on the hour */
			var stH = mkStep(23, (new Date(Date.now() + 3600000)).getHours(), 1);
			var stM = mkStep(59, 0, 5);
			var stS = mkStep(59, 0, 5);
			absRow.appendChild(stH);
			absRow.appendChild(stM);
			absRow.appendChild(stS);
			panel.appendChild(absRow);
			/* 文字添加行（用户反馈：一个孤零零的 ➕ 图标没人看得懂） */
			var addRow = document.createElement('div');
			addRow.className = 'dsh-whale-settings-row dsh-whale-remind-addrow';
			addRow.textContent = '➕ 添加提醒';
			addRow.addEventListener('click', function (event) {
				event.stopPropagation();
				addAbsoluteReminder();
			});
			panel.appendChild(addRow);
			var addAbsoluteReminder = function () {
				var h = stH._val(), mi = stM._val(), s = stS._val();
				var target = new Date();
				target.setHours(h, mi, s, 0);
				if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1); /* 已过 → 明天 */
				var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
				var label = pad(h) + ':' + pad(mi) + ':' + pad(s);
				var list = loadReminders();
				list.push({ at: target.getTime(), text: '定时提醒 ' + label });
				saveReminders(list);
				uiSay('好，' + (target.getDate() === new Date().getDate() ? '今天' : '明天') + ' ' + label + ' 提醒你 ⏰', 2600);
				openReminders();
			};
			var list = loadReminders();
			list.sort(function (a, b) { return a.at - b.at; });
			list.forEach(function (r, idx) {
				var left = Math.max(0, Math.round((r.at - Date.now()) / 60000));
				var d = new Date(r.at);
				var pad2 = function (v) { return v < 10 ? '0' + v : '' + v; };
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				row.textContent = '⏳ ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
					pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
					'（还剩约 ' + left + ' 分钟，点按取消）';
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					var rest = loadReminders();
					rest.splice(idx, 1);
					saveReminders(rest);
					openReminders();
				});
				panel.appendChild(row);
			});
			/* 提醒我 is entered from the RIGHT-CLICK MENU (no settings row):
			 * back goes to the menu, not settings (user request) */
			mkPanelFoot(panel, null, true);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 230, 200);
		}
		setInterval(function () {
			var list = loadReminders();
			var nowT = Date.now();
			var due = [];
			var keep = [];
			for (var ri = 0; ri < list.length; ri++) {
				if (list[ri].at <= nowT) due.push(list[ri]);
				else keep.push(list[ri]);
			}
			if (due.length === 0) return;
			saveReminders(keep);
			for (var di = 0; di < due.length; di++) {
				var msg = '⏰ ' + due[di].text;
				say(msg, 6000);
				/* snapshot=false: a reminder is NOT a task outcome — reading it
				 * later must never resurrect a "此次任务消耗 X tokens" panel
				 * from whatever turn happened to be last (user-reported bug) */
				pushReport(msg, 6000, undefined, false);
				playDing('remind'); /* 音色面板可选（soundRemind，默认铃铛） */
			}
		}, 20000);

		/** 📊 任务周报: last-7-day buckets from the history records, drawn in
		 * the same drawer style as the history list (fixed height, list
		 * scrolls). Lives in the side-drawer slot: opening it CLOSES the
		 * settings panel — both float next to the whale, and stacked they
		 * hide each other (the drawer rendered "empty" for its whole life
		 * because its list div was never appended to the panel — only the
		 * title + close ever made it into the DOM). */
		function openReport() {
			closeCtxPanel();
			pullCloudHistory(); /* warm: merge records saved by other windows */
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📊 任务周报（近 7 天）';
			panel.appendChild(title);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			var days = {};
			var order = [];
			var weekAgo = Date.now() - 7 * 864e5;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				var at = rec.at || 0;
				if (at < weekAgo) continue;
				var d = new Date(at);
				var key = (d.getMonth() + 1) + '月' + d.getDate() + '日';
				if (!days[key]) { days[key] = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0, titles: [] }; order.push({ key: key, at: at }); }
				var b = days[key];
				if (rec.kind === 'done') b.done++;
				else if (rec.kind === 'fail') b.fail++;
				else if (rec.kind === 'killed') b.killed++;
				else if (rec.kind === 'question' || rec.kind === 'approval') b.ask++;
				if (rec.turnTokens) b.tokens += rec.turnTokens;
				if (rec.title && rec.title !== '未命名任务' && b.titles.indexOf(rec.title) < 0) b.titles.push(rec.title);
			}
			order.sort(function (a, b2) { return b2.at - a.at; });
			var totals = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0 };
			order.forEach(function (o) {
				var b = days[o.key];
				totals.done += b.done; totals.fail += b.fail; totals.killed += b.killed; totals.ask += b.ask; totals.tokens += b.tokens;
			});
			var fmtK = function (n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? Math.round(n / 1000) + 'K' : n; };
			var sumRow = document.createElement('div');
			sumRow.className = 'dsh-whale-report-summary';
			sumRow.textContent = '本周：✅' + totals.done + ' 失败' + totals.fail + ' ⏹' + totals.killed + ' ❓' + totals.ask + ' · ' + fmtK(totals.tokens) + ' tok';
			list.appendChild(sumRow);
			if (order.length === 0) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '这 7 天还没有任务记录 🐳';
				list.appendChild(empty);
			}
			order.forEach(function (o) {
				var b = days[o.key];
				var row = document.createElement('div');
				row.className = 'dsh-whale-history-row';
				row.title = b.titles.join('\n');
				var text = document.createElement('span');
				text.className = 'dsh-whale-history-text';
				text.textContent = o.key;
				var time = document.createElement('span');
				time.className = 'dsh-whale-history-time';
				var parts = [];
				if (b.done) parts.push('✅' + b.done);
				if (b.fail) parts.push('❌' + b.fail);
				if (b.killed) parts.push('⏹' + b.killed);
				if (b.ask) parts.push('❓' + b.ask);
				time.textContent = parts.join(' ') + (b.tokens ? ' · ' + fmtK(b.tokens) : '');
				row.appendChild(text);
				row.appendChild(time);
				list.appendChild(row);
			});
			panel.appendChild(list);
			/* entered from settings too (任务周报 row): back/close footer */
			mkPanelFoot(panel, closeCtxHistory);
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			showSidePanel(panel, 300);
		}

		/** 📤 导出历史: Markdown → clipboard; CSV → file download. */
		function exportHistory(fmt) {
			if (!history.length) { uiSay('还没有历史可导出哦 🐳', 2000); return; }
			if (fmt === 'csv') {
				var rows = ['time,kind,title,session,tokens'];
				for (var i = history.length - 1; i >= 0; i--) {
					var r = history[i];
					var d = new Date(r.at || 0);
					var ts = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.toTimeString().slice(0, 8);
					rows.push([ts, r.kind || '', '"' + String(r.title || '').replace(/"/g, '""') + '"', r.sessionId || '', r.turnTokens == null ? '' : r.turnTokens].join(','));
				}
				var blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
				var a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = 'whale-history.csv';
				a.click();
				uiSay('CSV 已下载 📤', 2000);
				return;
			}
			var lines = ['# 小鲸鱼任务历史', ''];
			for (var j = 0; j < history.length; j++) {
				var rr = history[j];
				var dd = new Date(rr.at || 0);
				var icon = rr.kind === 'done' ? '✅' : rr.kind === 'fail' ? '❌' : rr.kind === 'killed' ? '⏹' : '❓';
				lines.push('- ' + icon + ' ' + (rr.title || '（未命名）') + ' — ' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日 ' + dd.toTimeString().slice(0, 5) + (rr.turnTokens ? ' · ' + rr.turnTokens + ' tok' : ''));
			}
			var md = lines.join('\n');
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(md).then(function () { uiSay('Markdown 已复制 📋', 2200); }, function () { uiSay('复制失败 🥲', 2000); });
			} else {
				uiSay('剪贴板不可用 🥲', 2000);
			}
		}

		function openHistory() {
			closeCtxPanel(); /* drawers and floating panels never stack */
			pullCloudHistory(function () {
				/* the server merge may have brought records from other windows:
				 * re-fill the list body when the pull settles */
				if (ctxHistory && ctxHistory.isConnected) {
					var liveList = ctxHistory.querySelector('.dsh-whale-history-list');
					if (liveList) fillHistoryList(liveList);
				}
			});
			var panel = ctxHistory || document.createElement('div');
			panel.className = 'dsh-whale-history';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '📜 历史任务';
			panel.appendChild(title);
			var search = document.createElement('input');
			search.className = 'dsh-whale-history-search';
			search.placeholder = '🔍 搜标题 / 会话…';
			search.value = historySearch;
			search.addEventListener('input', function () {
				historySearch = search.value;
				fillHistoryList(list);
			});
			search.addEventListener('click', function (event) { event.stopPropagation(); });
			panel.appendChild(search);
			/* #7: "找到 N 条记录" line under the search box */
			historyCountEl = document.createElement('div');
			historyCountEl.className = 'dsh-whale-history-count';
			panel.appendChild(historyCountEl);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			fillHistoryList(list);
			panel.appendChild(list);
			var clearRow = document.createElement('div');
			clearRow.className = 'dsh-whale-history-clear';
			clearRow.textContent = '🗑 清空历史';
			/* #8: ranged clear — clearAt compares `at < clearAt`, so a
			 * back-dated generation marker drops only old records, both
			 * locally and in the cloud merge (host needs no changes). */
			var clearOpts = document.createElement('div');
			clearOpts.className = 'dsh-whale-history-clear-opts';
			var doClear = function (cutoff, label) {
				var before = history.length;
				if (cutoff === null) {
					history.length = 0;
				} else {
					for (var i = history.length - 1; i >= 0; i--) {
						if ((history[i].at || 0) < cutoff) history.splice(i, 1);
					}
				}
				bumpClearAt(cutoff === null ? undefined : cutoff);
				try { safeSet(HISTORY_KEY, history); } catch (e) {}
				pushCloudHistory();
				historySearch = '';
				fillHistoryList(list);
				clearRow.dataset.armed = '0';
				clearOpts.classList.remove('show');
				clearRow.textContent = '🗑 清空历史';
				showSidePanel(panel, 280); /* drawer shrank: re-clamp */
				uiSay(label + '，共 ' + (before - history.length) + ' 条 🧹', 2400);
			};
			var mkClearOpt = function (text, cutoff) {
				var opt = document.createElement('div');
				opt.className = 'dsh-whale-history-clear-opt';
				opt.textContent = text;
				opt.addEventListener('click', function (event) {
					event.stopPropagation();
					doClear(cutoff, text);
				});
				clearOpts.appendChild(opt);
			};
			mkClearOpt('清空全部', null);
			mkClearOpt('仅清空 7 天前', Date.now() - 7 * 86400000);
			mkClearOpt('仅清空 30 天前', Date.now() - 30 * 86400000);
			clearRow.addEventListener('click', function (event) {
				event.stopPropagation();
				if (clearRow.dataset.armed !== '1') {
					clearRow.dataset.armed = '1';
					clearRow.textContent = '⚠️ 选择要清空的范围';
					clearOpts.classList.add('show');
					/* the drawer just grew: re-measure + re-clamp so the
					 * options never run past the screen edge (same fix as
					 * the settings (?) hints) */
					showSidePanel(panel, 280);
					return;
				}
				/* tapping the title row again = cancel */
				clearRow.dataset.armed = '0';
				clearOpts.classList.remove('show');
				clearRow.textContent = '🗑 清空历史';
				showSidePanel(panel, 280);
			});
			panel.appendChild(clearRow);
			panel.appendChild(clearOpts);
			mkPanelFoot(panel, closeCtxHistory, true); /* ← 返回菜单 / ✕ 关闭 — 与其他子面板统一 */
			if (!ctxHistory) document.body.appendChild(panel);
			ctxHistory = panel;
			/* fixed-height drawer with a scrollable list: long histories never
			 * grow past the viewport — the LIST scrolls, not the drawer */
			showSidePanel(panel, 280);
		}
		function closeCtxHistory() {
			if (ctxHistory) ctxHistory.classList.remove('show');
		}

		/** Settings panel: notify-on-start toggle, stuck threshold, volume.
		 * Each row is a cycle; changes apply + persist immediately. Reuses the
		 * floating-panel slot (ctxPanel) for outside-click close. */
		function openSettings() {
			closeCtxHistory(); /* drawers and floating panels never stack */
			var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
			var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '⚙️ 设置';
			panel.appendChild(title);
			var mkSection = function (label) {
				var sec = document.createElement('div');
				sec.className = 'dsh-whale-settings-section';
				sec.textContent = label;
				panel.appendChild(sec);
			};
			var mkRow = function (label, valueText, onChange, keepOpen, hint) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = label;
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				/* (?) explainer (#6): CLICK-toggled one-line hint with an
				 * explicit 收起 button — never a hover tooltip (user rejected
				 * those, 2026-09-03); re-clicking (?) alone felt wrong. */
				if (hint) {
					var tip = document.createElement('div');
					tip.className = 'dsh-whale-settings-hint';
					var tipT = document.createElement('span');
					tipT.className = 'dsh-whale-settings-hint-t';
					tipT.textContent = hint;
					tip.appendChild(tipT);
					var tipX = document.createElement('span');
					tipX.className = 'dsh-whale-settings-hint-x';
					tipX.textContent = '收起 ▴';
					tipX.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.remove('show');
					});
					tip.appendChild(tipX);
					row.appendChild(tip);
					var q = document.createElement('span');
					q.className = 'dsh-whale-settings-q';
					q.textContent = '?';
					q.addEventListener('click', function (event) {
						event.stopPropagation();
						tip.classList.toggle('show');
						/* re-measure + re-clamp: an expansion near a screen
						 * edge must flip/shrink, never run off-screen */
						showFloatingPanel(panel, 220, 200);
					});
					row.appendChild(q);
				}
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onChange();
					/* rows that open ANOTHER panel (音色/周报) must not
					 * rebuild the settings panel afterwards — the rebuild used
					 * to paint the settings content straight over the panel
					 * that had just opened, so clicking 音色 did "nothing"
					 * (user-reported bug). */
					if (!keepOpen) openSettings();
				});
				panel.appendChild(row);
				return row;
			};
			mkSection('通知');
			mkRow('🔔 开工通知', CONFIG.notifyOnStart ? '开' : '关', function () {
				if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
			}, false, '任务开始跑时说一声"开工了"；关掉后只有结果通知（完成/失败等）才说话。');
			var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
			var dndCur = CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : '关';
			var dndIdx = -1;
			DND_PRESETS.forEach(function (pr, i) {
				if (pr && pr[0] + '-' + pr[1] === dndCur) dndIdx = i;
			});
			mkRow('🌙 免打扰', dndCur, function () {
				var next = DND_PRESETS[(dndIdx + 1) % DND_PRESETS.length];
				if (next) applyConfig({ dndEnabled: true, dndFrom: next[0], dndTo: next[1] });
				else applyConfig({ dndEnabled: false });
				saveConfig();
			}, false, '该时段只默默记红标不出声；需要你选择/审核的急事照常提醒。');
			mkSection('声音');
			mkRow('🔊 音量', Math.round(CONFIG.volume * 100) + '%', function () {
				var i = VOL_STEPS.indexOf(CONFIG.volume);
				if (applyConfig({ volume: VOL_STEPS[(i + 1) % VOL_STEPS.length] })) saveConfig();
			}, false, '提示音大小，点一下换一档。');
			mkRow('🎵 音色', '按通知设置 →', function () {
				openSoundPicker();
			}, true, '完成/失败/提问、定时提醒四类通知各配各的音效。');
			mkSection('监控');
			mkRow('⏱️ 工具超时', Math.round(CONFIG.toolStuckMs / 1000) + 's', function () {
				var i = TOOL_PRESETS.indexOf(CONFIG.toolStuckMs);
				if (applyConfig({ toolStuckMs: TOOL_PRESETS[(i + 1) % TOOL_PRESETS.length] })) saveConfig();
			}, false, '单个工具跑超过这个时长就提醒一次"可能卡住了"，不会打断任务。');
			var P_PRESETS = [50, 60, 70, 80, 90];
			mkRow('🚨 压力提醒', (CONFIG.pressureWarnPct || 70) + '%', function () {
				var i = P_PRESETS.indexOf(CONFIG.pressureWarnPct || 70);
				if (applyConfig({ pressureWarnPct: P_PRESETS[(i + 1) % P_PRESETS.length] })) saveConfig();
			}, false, '上下文占用到这个百分比就提醒 /compact，防止回复被截断。');
			mkSection('数据');
			mkRow('📊 任务周报', '最近 7 天', function () {
				openReport();
			}, true, '最近 7 天每天完成多少任务、花了多少 tokens。');
			mkRow('📤 导出历史', 'Markdown', function () {
				exportHistory('md');
			}, true, '把全部历史整理成 Markdown 复制到剪贴板。');
			mkRow('📤 导出历史', 'CSV 下载', function () {
				exportHistory('csv');
			}, true, '把全部历史下载成 CSV 表格文件。');
			/* 诊断 group; the manual is NOT a row here: 使用说明 lives in the
			 * right-click menu only (user request, 2026-09-04 — settings
			 * stays settings, the manual is a doc) */
			mkSection('诊断');
			mkRow('🩺 运行状态', '点此查看', function () {
				openHealthPanel();
			}, true, '鲸鱼自查各条通知链路是否正常；平时全部正常、不打扰，出问题我头上会亮 ⚠️。');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			mkRow('🩺 调试模式', debugNow ? '开（取证中）' : '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
			}, false, '排障时才开：往控制台输出调试信息，平时保持关闭。');
			/* 设置 itself is opened from the right-click menu: back goes to
			 * the menu (user request: bottom-left 返回菜单) */
			mkPanelFoot(panel, null, true);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 220, 200);
		}

		/** 🩺 Health detail panel (core/health.js detects, THIS side renders:
		 * the panel slots live in uiInit's closure so the health module —
		 * an IIFE-scope inline module — delegates here). */
		function openHealthPanel() {
			closeCtxPanel();
			closeCtxHistory();
			var health = window.__dshWhale && window.__dshWhale._health;
			var rep = (health && health.state().lastReport) || (health && health.run()) || { server: 'ok', dom: 'ok', jump: 'warn' };
			var panel = ctxPanel || document.createElement('div');
			panel.className = 'dsh-whale-settings';
			panel.textContent = '';
			var title = document.createElement('div');
			title.className = 'dsh-whale-wardrobe-title';
			title.textContent = '🩺 运行状态';
			panel.appendChild(title);
			var rows = [
				['后台通知通道', rep.server === 'fail' ? '❌ 失效（收不到后台/失败通知）' : '✅ 正常'],
				['用量读取', rep.dom === 'fail' ? '❌ 异常（tokens 面板可能为空）' : '✅ 正常'],
				['气泡跳转', rep.jump === 'ok' ? '✅ 可用' : '⚠️ 不可用（走侧栏兜底）']
			];
			for (var i = 0; i < rows.length; i++) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-settings-row';
				var l = document.createElement('span');
				l.className = 'dsh-whale-settings-label';
				l.textContent = rows[i][0];
				var v = document.createElement('span');
				v.className = 'dsh-whale-settings-value';
				v.textContent = rows[i][1];
				row.appendChild(l);
				row.appendChild(v);
				panel.appendChild(row);
			}
			var hint = document.createElement('div');
			hint.className = 'dsh-whale-settings-section';
			hint.textContent = '多数失效是页面过期：按 Ctrl+F5 刷新即可恢复；仍失效请看控制台 [🐋] 日志';
			panel.appendChild(hint);
			/* footer via shared helper: ← 返回设置 / ✕ 关闭 */
			mkPanelFoot(panel);
			if (!ctxPanel) document.body.appendChild(panel);
			ctxPanel = panel;
			showFloatingPanel(panel, 260, 190);
		}

		whale.addEventListener('contextmenu', function (event) {
			event.preventDefault();
			event.stopPropagation();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				/* double right-click: pet the whale */
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			openCtxMenu(event.clientX, event.clientY);
		});

		/* clicking anywhere else closes the floats (right button excluded —
		 * it is handled by the contextmenu path above). The history drawer is
		 * exempt too: its rows act on the CLICK event, and hiding the panel on
		 * pointerdown detaches them before that click ever arrives. */
		document.addEventListener('pointerdown', function (event) {
			if (event.button === 2) return;
			var t = event.target;
			if (ctxMenu && ctxMenu.contains(t)) return;
			if (ctxPanel && ctxPanel.contains(t)) return;
			if (ctxHistory && ctxHistory.contains(t)) return;
			closeCtxFloats();
		});

		/* right-click outside the whale: close the floats; a double
		 * right-click anywhere in the window still pets the whale */
		document.addEventListener('contextmenu', function (event) {
			var floatsOpen = (ctxMenu && ctxMenu.classList.contains('show')) ||
				(ctxPanel && ctxPanel.classList.contains('show'));
			if (!floatsOpen) return; /* outside the whale: browser menu as usual */
			event.preventDefault();
			var now = Date.now();
			if (now - lastCtxAt < CTX_DBL_MS) {
				lastCtxAt = 0;
				petWhale();
				return;
			}
			lastCtxAt = now;
			closeCtxFloats();
		});

		function applyPos(x, y) {
			var width = whale.offsetWidth;
			var height = whale.offsetHeight;
			x = Math.max(0, Math.min(x, window.innerWidth - width));
			y = Math.max(0, Math.min(y, window.innerHeight - height));
			whale.style.left = x + 'px';
			whale.style.top = y + 'px';
			whale.style.right = 'auto';
			whale.style.bottom = 'auto';
		}

		function savePos() {
			safeSet(POS_KEY, {
				x: whale.offsetLeft,
				y: whale.offsetTop
			});
		}

		function loadPos() {
			var pos = safeGet(POS_KEY, function (v0) {
				/* migrate { x, y } -> v1 */
				return (v0 && typeof v0 === 'object' && typeof v0.x === 'number' && typeof v0.y === 'number') ? v0 : null;
			});
			if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
				applyPos(pos.x, pos.y);
				return true;
			}
			return false;
		}

		var wiggleTimer = null;

		function wiggle() {
			whale.classList.remove('dsh-whale-wiggle');
			void whale.offsetWidth; /* restart the animation */
			whale.classList.add('dsh-whale-wiggle');
			/* the one-shot wiggle must be dropped after it finishes,
			 * otherwise the finished animation keeps overriding the idle
			 * bob (dsh-whale-bob) and the whale freezes until reload. */
			if (wiggleTimer) clearTimeout(wiggleTimer);
			wiggleTimer = setTimeout(function () {
				wiggleTimer = null;
				whale.classList.remove('dsh-whale-wiggle');
				void whale.offsetWidth; /* let the bob restart cleanly */
			}, 500);
		}

		function liveJobs() {
			var out = [];
			known.forEach(function (view) {
				if (view.status === 'running' || view.status === 'stopping') out.push(view);
			});
			return out;
		}

		/** The click summary stays pure interaction: task status or an idle
		 * line. Token/pressure lives in the status panel on task completion. */
		function clickSummary() {
			if (asleep) return '呼… Zzz 💤';
			var live = liveJobs();
			var summary;
			if (live.length > 0) {
				var names = live.slice(0, 3)
					.map(function (view) { return '「' + truncate(taskTitle(view), live.length > 1 ? 22 : 30) + '」'; })
					.join('、');
				summary = live.length + ' 个子任务进行中：' + names + (live.length > 3 ? ' 等' : '') + ' ' + pickTail('busy');
				if (moodStageIndex() >= 3 && Math.random() < 0.4) {
					summary += ' ……还在跑，我盯着呢 🫠';
				}
			} else {
				summary = pickIdleLine();
			}
			/* recent failure: give a gentle recall hint (window from config) */
			var failAt = recentFailAt();
			if (failAt !== null && (Date.now() - failAt) < CONFIG.recentFailWindowMs) {
				summary += '\n上次任务失败了哦，双击红色通知回去看看 🥲';
			}
			return summary;
		}

