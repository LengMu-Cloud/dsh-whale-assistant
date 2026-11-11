		/* ———— 小鲸鱼助手侧边栏页（2026-11-08，方案见对话） ————
		 * 官方 slots API（client.js 注册 sidebar.panellist id=whale-assistant +
		 * main key=whale-assistant，order 30）的页面半区挂载面：React 包装经
		 * window.__dshWhalePanel.mount(root) 调进来。UI 住在页面半区——
		 * CONFIG/saveConfig/applyConfig 与抽屉打开函数（音色/周报/运行状态）
		 * 都在 uiInit 闭包里，client 半部零依赖原则不破。
		 * 桌宠页（PET_MODE）没有 ModuleLoader=没有侧边栏：本文件在桌宠页
		 * 只定义不触发，桌宠右键设置保留抽屉形态（方案边界）。
		 * Tab：⚙️ 设置（健康条+全项迁移）/ 🐋 桌宠（三态控制，POST /pet/ctrl
		 * form —— 该路由仅栅栏无 token，页内鲸历史同款通道）。 */
		var __whalePanelCss = false;
		var __ppToneOpen = false; /* 音色展开态跨 re-render 存活（主观痛点 7） */
		function mountWhalePanelPage(root) {
			if (!__whalePanelCss) {
				__whalePanelCss = true;
				var css = document.createElement('style');
				css.textContent = [
					/* 11-11 真机修复轮（用户实报「展开后没法往下滑」+「关于全屏才
					 * 看得见」）：页面此前从未自带滚动——宿主 main 面板容器定高
					 * 裁切，官方页全是 pageBody 自滚。结构分层：root（pp-host）=
					 * 全宽自滚容器，page（pp）=860px 居中栏。**pp 与 pp-host 从此
					 * 不同元素**——11-11 的双类源序冲突坑永久消失 */
					'.dsh-whale-pp-host{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
					/* 自带深夜蓝底（11-11 审计 P2-4）：页面嵌在 DSH main 区而 DSH 有
					 * 明暗双主题（body[data-ds-dark-theme]）——透明底+固定浅字在亮
					 * 主题下不可读。rgba 底在暗色宿主上几乎无感，亮色下自持可读 */
					'.dsh-whale-pp{width:min(100%,860px);margin:0 auto;padding:20px 26px;font-size:13px;color:var(--dsw-panel-text);background:var(--dsw-panel-bg)}',
					'.dsh-whale-pp-tabs{display:flex;gap:8px;margin:6px 0 18px}',
					'.dsh-whale-pp-tab{padding:7px 20px;border-radius:var(--dsw-radius-full);cursor:pointer;border:1px solid var(--dsw-panel-border);color:var(--dsw-panel-muted);background:transparent;font-size:13px}',
					'.dsh-whale-pp-tab.on{background:var(--dsw-panel-active);color:var(--dsw-panel-text)}',
					'.dsh-whale-pp-sec{margin:20px 0 8px;font-weight:600;color:var(--dsw-panel-head);font-size:12px}',
					'.dsh-whale-pp-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--dsw-radius-s);cursor:pointer;background:rgba(99,150,255,0.07);margin:5px 0}',
					'.dsh-whale-pp-row:hover{background:var(--dsw-panel-hover)}',
					'.dsh-whale-pp-val{color:var(--dsw-panel-muted)}',
					'.dsh-whale-pp-health{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-radius:var(--dsw-radius-s);background:rgba(99,150,255,0.07);margin:14px 0 0}',
					'.dsh-whale-pp select{background:var(--dsw-panel-bg);color:var(--dsw-panel-text);border:1px solid var(--dsw-panel-border);border-radius:var(--dsw-radius-s);padding:4px 8px;font-size:12px}',
					'.dsh-whale-pp-petbtns{display:flex;gap:10px;margin:10px 0}',
					'.dsh-whale-pp-petbtn{flex:1;padding:12px 10px;border-radius:var(--dsw-radius-s);border:1px solid var(--dsw-panel-border);cursor:pointer;background:rgba(99,150,255,0.07);color:var(--dsw-panel-text);text-align:center;font-size:13px}',
					'.dsh-whale-pp-petbtn.on{background:var(--dsw-panel-active);border-color:var(--dsw-accent)}',
					'.dsh-whale-pp-status{color:var(--dsw-panel-muted);margin:8px 0 4px;font-size:12px}',
					'.dsh-whale-pp-content .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-content .dsh-whale-manual-search{width:100%;margin:0 0 8px}',
					/* 使用说明 Tab：高度实测自适应窗口（用户反馈固定 calc 边界
					 * 悬空/局促——「直接适应窗口范围」）：底边=视口底-24px */
					'.dsh-whale-pp-manual{overflow-y:auto;padding-right:4px;overscroll-behavior:contain}',
					/* 周报 Tab：报告列表卡片化（旧抽屉壳的观感由这里补齐） */
					'.dsh-whale-pp-report{background:rgba(99,150,255,0.07);border:1px solid var(--dsw-panel-border);border-radius:var(--dsw-radius-m);padding:14px 16px;margin:14px 0 6px}',
					'.dsh-whale-pp-report .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-report .dsh-whale-report-summary{font-weight:600;color:var(--dsw-panel-head);padding:8px 14px;background:rgba(99,150,255,0.15);border-radius:var(--dsw-radius-s);margin-bottom:8px}',
					'.dsh-whale-pp-report .dsh-whale-history-row{display:flex;justify-content:space-between;padding:10px 14px;background:rgba(99,150,255,0.10);border-radius:var(--dsw-radius-s);margin:5px 0}',
					/* 日期行假可点（主观痛点 9）：手型与 hover 高亮继承自旧抽屉
					 * 样式而页面无点击行为——指针与 hover 都收掉，tooltip 保留 */
					'.dsh-whale-pp-report .dsh-whale-history-row{cursor:default}',
					'.dsh-whale-pp-report .dsh-whale-history-row:hover{background:rgba(99,150,255,0.10)}',
					/* 页头（官方页 h1 20px/500 + 13px 描述行） */
					'.dsh-whale-pp-title{font-size:20px;font-weight:500;line-height:28px;color:var(--dsw-panel-head);margin-top:2px}',
					'.dsh-whale-pp-desc{font-size:13px;line-height:20px;color:var(--dsw-panel-muted);margin:4px 0 0}',
					/* 音色子行从属感（主观痛点 7）：左缩进一档 */
					'.dsh-whale-pp-tone-detail{margin-left:18px}',
					/* 试听按钮（11-11 三报）：select 重选同值不触发 change——
					 * 显式试听按钮兜住「想听已选中声音」的场景 */
					'.dsh-whale-tone-right{display:flex;align-items:center;gap:8px}',
					'.dsh-whale-tone-play{background:var(--dsw-panel-bg);color:var(--dsw-panel-text);border:1px solid var(--dsw-panel-border);border-radius:var(--dsw-radius-s);padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit}',
					'.dsh-whale-tone-play:hover{background:var(--dsw-panel-hover)}',
					/* 桌宠未启用：按钮置灰（主观痛点 10） */
					'.dsh-whale-pp-petbtn.off{opacity:.45;cursor:default}'
				].join('');
				(document.head || document.body).appendChild(css); /* vm mock 无 head */
			}
			root.textContent = '';
			/* 11-11 真机修复轮：滚动分层（见 CSS 注释）——root 只当滚动容器，
			 * 860px 栏挪进内层 page */
			var page = document.createElement('div');
			page.className = 'dsh-whale-pp';
			root.appendChild(page);
			var tabBar = document.createElement('div');
			tabBar.className = 'dsh-whale-pp-tabs';
			var content = document.createElement('div');
			content.className = 'dsh-whale-pp-content';
			/* 页头（11-11 基线②/主观痛点 1：官方页 h1 20px/500 + 13px 描述行是
			 * 新人定位的第一锚点——此前直接进 Tab 条，页面没有身份） */
			var ppTitle = document.createElement('div');
			ppTitle.className = 'dsh-whale-pp-title';
			ppTitle.textContent = '小鲸鱼助手';
			var ppDesc = document.createElement('div');
			ppDesc.className = 'dsh-whale-pp-desc';
			ppDesc.textContent = '任务播报与记录——设置、周报、使用说明都在这里。';
			page.appendChild(ppTitle);
			page.appendChild(ppDesc);
			page.appendChild(tabBar);
			page.appendChild(content);
			var TABS = [['settings', '⚙️ 设置'], ['pet', '🐋 桌宠'], ['report', '📊 周报'], ['help', '📖 使用说明']];
			var curTab = 'settings';
			var tabBtns = {};
			TABS.forEach(function (t) {
				var b = document.createElement('button');
				b.className = 'dsh-whale-pp-tab';
				b.textContent = t[1];
				b.addEventListener('click', function (event) {
					event.stopPropagation();
					curTab = t[0];
					render();
				});
				tabBtns[t[0]] = b;
				tabBar.appendChild(b);
			});
			function render() {
				TABS.forEach(function (t) { tabBtns[t[0]].classList.toggle('on', curTab === t[0]); });
				content.textContent = '';
				if (curTab === 'settings') renderSettings(content);
				else if (curTab === 'pet') renderPet(content);
				else if (curTab === 'report') mountWhaleReportTab(content);
				else mountWhaleManualTab(content);
			}
			function ppSection(host, label) {
				var sec = document.createElement('div');
				sec.className = 'dsh-whale-pp-sec';
				sec.textContent = label;
				host.appendChild(sec);
			}
			/* 行语义与 openSettings 逐条同源（同一份 CONFIG/applyConfig）——
			 * 改动即生效，整页重渲（页面区重渲不波及鲸鱼浮层） */
			function ppRow(host, label, valueText, onChange) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onChange();
				});
				host.appendChild(row);
			}
			function renderSettings(host) {
				/* 健康条（常驻）：数据源=health.js 自检状态（openHealthPanel 同源）。
				 * 小节标题「运行状态」（主观痛点 8：老用户拿旧地图找不到它） */
				ppSection(host, '🩺 运行状态');
				var health = window.__dshWhale && window.__dshWhale._health;
				var rep = null;
				try {
					rep = (health && health.state().lastReport) || (health && health.run()) || null;
				} catch (e) { rep = null; }
				if (!rep) rep = { server: 'ok', dom: 'ok', jump: 'warn' };
				var strip = document.createElement('div');
				strip.className = 'dsh-whale-pp-health';
				var healthItems = [
					['后台通知', rep.server === 'fail' ? '❌' : '✅'],
					['用量读取', rep.dom === 'fail' ? '❌' : '✅'],
					/* 跳转恒 warn 级（health.js 只产 ok|warn）；详情=鲸鱼头顶 ⚠️
					 * 的 openHealthPanel 浮层（menu.js 同源三行） */
					['气泡跳转', rep.jump === 'ok' ? '✅' : '⚠️']
				];
				healthItems.forEach(function (it) {
					var s = document.createElement('span');
					s.textContent = it[0] + ' ' + it[1];
					strip.appendChild(s);
				});
				host.appendChild(strip);
				/* 恢复提示常驻在三个状态下面（11-09 用户拍板：详细自查展开区
				 * 与状态条内容重复，砍掉；链路异常时鲸鱼头顶 ⚠️ chip 仍可点
				 * 旧浮层看详情——鲸鱼锚定场景不违和） */
				var hint = document.createElement('div');
				hint.className = 'dsh-whale-pp-status';
				hint.textContent = '多数失效是页面过期：右键菜单 🔄 刷新页面（或浏览器 Ctrl+F5）即可恢复；「气泡跳转 ⚠️」在浏览器窗口属常态（走侧栏兜底）；仍失效请看控制台 [🐋] 日志';
				host.appendChild(hint);
				ppSection(host, '通知');
				ppRow(host, '🔔 开工通知', CONFIG.notifyOnStart ? '开' : '关', function () {
					if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
					render();
				});
				var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
				var dndCur = CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : '关';
				var dndIdx = -1;
				DND_PRESETS.forEach(function (pr, i) {
					if (pr && pr[0] + '-' + pr[1] === dndCur) dndIdx = i;
				});
				/* 免打扰循环修复（11-09 用户实报「只有关没有开」）：关态下
				 * dndIdx=-1，(−1+1)%5=0 命中 null 档=仍是关——从关永远点不开。
				 * 关态视为站在 0 档上，下一步跳 1 档（首个时段）；开态未匹配
				 * （自定义时段）→ 下一档回关，语义不变。 */
				if (!CONFIG.dndEnabled) dndIdx = 0;
				ppRow(host, '🌙 免打扰', dndCur, function () {
					var next = DND_PRESETS[(dndIdx + 1) % DND_PRESETS.length];
					if (next) applyConfig({ dndEnabled: true, dndFrom: next[0], dndTo: next[1] });
					else applyConfig({ dndEnabled: false });
					saveConfig();
					render();
				});
				ppSection(host, '声音');
				/* 总静音（主观痛点 4）：菜单 🔇 的页面镜像——菜单里静音着时
				 * 页内调音量依然无声，此前页面无法解释这个现象 */
				ppRow(host, '🔊 声音总开关', window.__dshWhale.soundMuted && window.__dshWhale.soundMuted() ? '关（静音中）' : '开', function () {
					if (window.__dshWhale.setSoundMuted) window.__dshWhale.setSoundMuted(!window.__dshWhale.soundMuted());
					render();
				});
				var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
				ppRow(host, '🔊 音量', Math.round(CONFIG.volume * 100) + '%', function () {
					var i = VOL_STEPS.indexOf(CONFIG.volume);
					if (applyConfig({ volume: VOL_STEPS[(i + 1) % VOL_STEPS.length] })) saveConfig();
					render();
				});
				/* 🎵 音色：四个下拉行内展开（11-09 用户反馈浮层盖 DSH 侧边栏）
				 * ——语义与旧浮层选择器同源：改选即应用+持久化+现场试听 */
				var toneOpen = __ppToneOpen;
				var toneDetail = document.createElement('div');
				toneDetail.className = 'dsh-whale-pp-tone-detail';
				toneDetail.style.display = toneOpen ? 'block' : 'none';
				var KINDS = [
					{ key: 'soundDone', kind: 'done', label: '✅ 完成通知', opts: ['ding', 'bell', 'chime', 'none'] },
					{ key: 'soundFail', kind: 'fail', label: '❌ 失败通知', opts: ['thud', 'ding', 'bell', 'chime', 'none'] },
					{ key: 'soundAttn', kind: 'attention', label: '❓ 提问回答', opts: ['chime', 'ding', 'bell', 'none'] },
					{ key: 'soundRemind', kind: 'remind', label: '⏰ 定时提醒', opts: ['bell', 'ding', 'chime', 'thud', 'none'] }
				];
				var LABELS = { ding: '单声叮', bell: '叮叮（两连击）', chime: '清脆上行', thud: '低沉下行', none: '静音' };
				KINDS.forEach(function (k) {
					var row = document.createElement('div');
					row.className = 'dsh-whale-pp-row';
					var l = document.createElement('span');
					l.textContent = k.label;
					var sel = document.createElement('select');
					sel.className = 'dsh-whale-sound-sel';
					k.opts.forEach(function (opt) {
						var opt2 = document.createElement('option');
						opt2.value = opt;
						opt2.textContent = LABELS[opt];
						sel.appendChild(opt2);
					});
					/* 存量脏值（不在该类 opts）回落显示到第一项（11-11 审计 P3-7：
					 * sel.value 赋未知值=静默空白），CONFIG 不动 */
					if (k.opts.indexOf(CONFIG[k.key]) >= 0) sel.value = CONFIG[k.key];
					else sel.selectedIndex = 0;
					sel.addEventListener('click', function (event) { event.stopPropagation(); });
					/* 试听（11-11 三报：用户实报「选择音色没声音」）。显式「▶
					 * 试听」按钮兜住全部场景——原生 select **重选同值不触发
					 * change**（想听已选中的声音只能靠按钮），change 只覆盖
					 * 换值场景。previewDing=独立直渲通道（不进通知队列，点了
					 * 就响——11-11 三报延时修），总静音仍尊重 */
					var audition = function () {
						var mutedNow = false;
						try { mutedNow = !!(window.__dshWhale.soundMuted && window.__dshWhale.soundMuted()); } catch (e) { }
						if (!mutedNow) previewDing(k.kind);
						l.textContent = k.label + (mutedNow ? ' 🔇（总开关静音）' : ' ♪');
						setTimeout(function () { l.textContent = k.label; }, 1800);
					};
					sel.addEventListener('change', function () {
						var pa = {}; pa[k.key] = sel.value;
						if (applyConfig(pa)) saveConfig();
						audition();
					});
					var playBtn = document.createElement('button');
					playBtn.type = 'button';
					playBtn.className = 'dsh-whale-tone-play';
					playBtn.textContent = '▶ 试听';
					playBtn.addEventListener('click', function (event) {
						event.stopPropagation();
						audition();
					});
					var right = document.createElement('span');
					right.className = 'dsh-whale-tone-right';
					right.appendChild(sel);
					right.appendChild(playBtn);
					row.appendChild(l);
					row.appendChild(right);
					toneDetail.appendChild(row);
				});
				ppRow(host, '🎵 音色', toneOpen ? '收起 ↑' : '按通知设置 →', function () {
					toneOpen = !toneOpen;
					__ppToneOpen = toneOpen; /* 模块级记忆：别的行触发重渲也不收走展开态 */
					toneDetail.style.display = toneOpen ? 'block' : 'none';
				});
				host.appendChild(toneDetail);
				ppSection(host, '监控');
				var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
				ppRow(host, '⏱️ 工具超时', Math.round(CONFIG.toolStuckMs / 1000) + 's', function () {
					var i = TOOL_PRESETS.indexOf(CONFIG.toolStuckMs);
					if (applyConfig({ toolStuckMs: TOOL_PRESETS[(i + 1) % TOOL_PRESETS.length] })) saveConfig();
					render();
				});
				var P_PRESETS = [50, 60, 70, 80, 90];
				ppRow(host, '🚨 压力提醒', (CONFIG.pressureWarnPct || 70) + '%', function () {
					var i = P_PRESETS.indexOf(CONFIG.pressureWarnPct || 70);
					if (applyConfig({ pressureWarnPct: P_PRESETS[(i + 1) % P_PRESETS.length] })) saveConfig();
					render();
				});
			/* 行内闪现反馈（11-11 用户实报「点了没动静」）：exportHistory 的
			 * 反馈走 uiSay 鲸鱼气泡——桌宠运行时页鲸休眠=打在隐藏元素里零可
			 * 见反馈。页面行自带 ✓ 闪现，不依赖鲸鱼可见性 */
			function ppFlashRow(host, label, valueText, onDo) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				row.appendChild(l);
				row.appendChild(v);
				var flashTimer = null;
				row.addEventListener('click', function (event) {
					event.stopPropagation();
					onDo(function (okText) {
						v.textContent = okText;
						/* 连点先清旧定时器（11-11 审计 P3-2）：否则第一次的回落
						 * 会截断第二次的闪现 */
						if (flashTimer) clearTimeout(flashTimer);
						flashTimer = setTimeout(function () { v.textContent = valueText; }, 2000);
					});
				});
				host.appendChild(row);
			}
			ppSection(host, '数据');
			/* 📊 任务周报升格为独立 Tab（11-09）——本区只留导出动作；双行拆分
			 * 恢复 CSV 路径（合并单行时只有 Markdown 能触发） */
			ppFlashRow(host, '📤 导出历史', 'Markdown → 复制到剪贴板', function (flash) {
				if (!history.length) { flash('还没有记录可导出 🐳'); return; }
				/* 剪贴板写入是异步的：闪现必须由真实结果驱动（11-11 审计 P2-3
				 * ——无条件闪「已复制」会在写失败时假成功，而失败气泡在桌宠
				 * 在岗时打进隐藏元素零可见） */
				exportHistory('md', function (ok) { flash(ok ? '✓ Markdown 已复制 📋' : '复制失败 🥲'); });
			});
			ppFlashRow(host, '📤 导出历史', 'CSV → 下载文件', function (flash) {
				if (!history.length) { flash('还没有记录可导出 🐳'); return; }
				exportHistory('csv', function (ok) { if (ok) flash('✓ CSV 已下载 📤'); });
			});
			ppSection(host, '诊断');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			ppRow(host, '🩺 调试模式', debugNow ? '开（取证中）' : '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
				render();
			});
			ppSection(host, '关于');
			/* 版本行（11-11 基线⑫：官方设置页同款「当前版本」；取共享 IIFE
			 * 作用域的 PATCH_VERSION（core/constants.js，build 可覆写）） */
			var about = document.createElement('div');
			about.className = 'dsh-whale-pp-row';
			about.style.cursor = 'default';
			var al = document.createElement('span');
			setIconLabel(al, 'ℹ️ 当前版本');
			var av = document.createElement('span');
			av.className = 'dsh-whale-pp-val';
			av.textContent = '小鲸鱼助手 v' + PATCH_VERSION;
			about.appendChild(al);
			about.appendChild(av);
			host.appendChild(about);
		}
			function renderPet(host) {
				var status = document.createElement('div');
				status.className = 'dsh-whale-pp-status';
				status.textContent = '桌宠状态读取中…';
				host.appendChild(status);
				var btns = document.createElement('div');
				btns.className = 'dsh-whale-pp-petbtns';
				var FORMS = [['full', '🐋 完整形态'], ['bubble', '🫧 缩成气泡'], ['hidden', '🙈 躲猫猫']];
				var btnMap = {};
				var petEnabled = true; /* /state 返回未启用时按钮置灰+忽略点击 */
				function markForm(form) {
					FORMS.forEach(function (f) {
						if (btnMap[f[0]]) btnMap[f[0]].classList.toggle('on', f[0] === form);
					});
				}
				FORMS.forEach(function (f) {
					var b = document.createElement('button');
					b.className = 'dsh-whale-pp-petbtn';
					b.textContent = f[1];
					b.addEventListener('click', function (event) {
						event.stopPropagation();
						if (!petEnabled) return; /* 未启用：点击无效（主观痛点 10：注定失败的按钮=困惑发生器） */
						try {
							fetch('/api/whale-assistant/pet/ctrl', {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ action: 'form', value: f[0] })
							}).then(function (r) { return r.json(); }).then(function (j) {
								if (j && j.ok && j.pet) {
									markForm(j.pet.form);
									status.textContent = '已切换 ✓（桌宠形态：' + f[1] + '）';
								} else {
									status.textContent = '切换失败：' + (j && j.error || '未知错误');
								}
							}).catch(function (e) {
								status.textContent = '切换失败：' + (e && e.message || e);
							});
						} catch (e) {
							status.textContent = '切换失败：' + (e && e.message || e);
						}
					});
					btnMap[f[0]] = b;
					btns.appendChild(b);
				});
				host.appendChild(btns);
				var note = document.createElement('div');
				note.className = 'dsh-whale-pp-status';
				note.textContent = '躲猫猫＝游到右下角收成一颗小气泡，点一下气泡随时召回；桌宠跟随 DSH 宿主，关掉 DSH 才真正退出。';
				host.appendChild(note);
				/* 初始状态：/state 已暴露 pet（enabled/form/up/spawning，lib/index.js） */
				try {
					fetch('/api/whale-assistant/state').then(function (r) {
						return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status));
						}).then(function (j) {
							var pet = j && j.pet;
							markForm(pet && pet.form || 'full');
							if (!pet || !pet.enabled) {
								petEnabled = false;
								FORMS.forEach(function (f) { if (btnMap[f[0]]) btnMap[f[0]].classList.add('off'); });
								status.textContent = '桌宠未启用（平台不支持或引擎未挂桌宠）——页内鲸鱼顶班中，形态控制不可用';
							}
							else status.textContent = pet.up ? '桌宠在岗 ✓' : '桌宠暂离——页内鲸鱼顶班中，自愈心跳约 1 分钟内拉回';
						}).catch(function (e) {
						status.textContent = '桌宠状态读取失败：' + (e && e.message || e);
					});
				} catch (e) {
					status.textContent = '桌宠状态读取失败：' + (e && e.message || e);
				}
			}
			render();
		}
		/* 📖 使用说明 Tab（11-08 自 openHelp 抽屉原样迁入——搜索/折叠/命中高亮/
		 * 孤头隐藏全保留；抽屉壳（showSidePanel/页脚/视口封顶）随「右键菜单项
		 * 取消」一并退役，页面自然滚动。折叠记忆跨 Tab 切换存活。 */
		var ppManualFoldMemo = {};
		var __ppManualResize = null; /* 手册滚动区的 resize 处理器——重复 mount 只留一个存活 */
		function mountWhaleManualTab(content) {
			/* 固定高度滚动区（用户反馈「点开来突然变大」）：折叠/展开框尺寸
			 * 恒定，内容超出只在区内滚 */
			var wrap = document.createElement('div');
			wrap.className = 'dsh-whale-pp-manual';
			content.appendChild(wrap);
			var mSearch = document.createElement('input');
			mSearch.className = 'dsh-whale-history-search dsh-whale-manual-search';
			mSearch.placeholder = '搜索说明…（如：红标、音色）';
			mSearch.addEventListener('click', function (event) { event.stopPropagation(); });
			wrap.appendChild(mSearch);
			var mStatus = document.createElement('div');
			mStatus.className = 'dsh-whale-manual-status';
			wrap.appendChild(mStatus);
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			mSearch.addEventListener('input', function () {
				var q = (mSearch.value || '').trim();
				var rows = list.children;
				var n = 0;
				var first = null;
				/* 搜索先展开全部分区（过滤与折叠共用 display 隐藏，混用会互相
				 * 打架），清空查询后按记忆恢复折叠态 */
				for (var k = 0; k < rows.length; k++) {
					rows[k].classList.remove('dsh-whale-manual-folded');
				}
				if (q) {
					for (var k2 = 0; k2 < manualSecEls.length; k2++) {
						manualSecEls[k2].el.setAttribute('data-folded', '0');
					}
				} else {
					applyManualFolds();
				}
				var secHits = [];
				for (var s2 = 0; s2 < manualSecEls.length; s2++) secHits.push(0);
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers: visibility handled below（孤头隐藏） */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						if (el._mT) el._mT.textContent = el._mTerm;
						if (el._mD) el._mD.textContent = el._mDesc;
						if (el._mG) el._mG.textContent = el._mTerm;
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (rowSection && rowSection[i] >= 0 && rowSection[i] < secHits.length) secHits[rowSection[i]]++;
						if (el._mG) highlightAll(el._mG, el._mTerm, q);
						else {
							if (el._mT) highlightAll(el._mT, el._mTerm, q);
							if (el._mD) highlightAll(el._mD, el._mDesc, q);
						}
						if (!first) first = el;
					}
				}
				/* 搜索时隐藏零命中分区头（消孤头）；空查询全恢复 */
				for (var s3 = 0; s3 < manualSecEls.length; s3++) {
					manualSecEls[s3].el.classList.toggle('dsh-whale-hide', !!q && secHits[s3] === 0);
				}
				mStatus.textContent = q ? (n > 0 ? '找到 ' + n + ' 条相关内容' : '未找到相关内容 🔍') : '';
				if (first && typeof first.scrollIntoView === 'function') {
					first.scrollIntoView({ block: 'nearest' });
				}
			});
			var manualSecEls = [];
			function applyManualFolds() {
				for (var i = 0; i < manualSecEls.length; i++) {
					var s = manualSecEls[i];
					/* 默认目录态=全折叠；唯一例外「🚀 快速上手」首开即展（主观
					 * 痛点 6：置顶但折叠=对新手没置顶）。用户点过的记住其选择 */
					var memoV = ppManualFoldMemo[s.title];
					var folded = memoV === undefined ? s.title !== '🚀 快速上手' : memoV !== false;
					s.el.setAttribute('data-folded', folded ? '1' : '0');
					var end = i + 1 < manualSecEls.length ? manualSecEls[i + 1].start : list.children.length;
					for (var j = s.start + 1; j < end; j++) {
						list.children[j].classList.toggle('dsh-whale-manual-folded', folded);
					}
				}
			}
			function highlightAll(el, text, q) {
				if (!q) { el.textContent = text; return; }
				var lower = (text || '').toLowerCase();
				var ql = q.toLowerCase();
				el.textContent = '';
				var i = 0;
				for (;;) {
					var hitAt = lower.indexOf(ql, i);
					if (hitAt < 0) {
						el.appendChild(document.createTextNode((text || '').slice(i)));
						break;
					}
					if (hitAt > i) el.appendChild(document.createTextNode(text.slice(i, hitAt)));
					var mk = document.createElement('mark');
					mk.textContent = text.substr(hitAt, q.length);
					el.appendChild(mk);
					i = hitAt + q.length;
				}
			}
			var sec = function (t) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				el.textContent = t;
				/* 点击分区头折叠/展开该组：扁平结构不变（行仍是 list 直接
				 * 子元素），搜索断言遍历 children 的契约不破 */
				el.addEventListener('click', function (event) {
					event.stopPropagation();
					ppManualFoldMemo[t] = ppManualFoldMemo[t] === false ? true : false;
					applyManualFolds();
				});
				list.appendChild(el);
				manualSecEls.push({ title: t, el: el, start: list.children.length - 1 });
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
				/* 原文与节点引用留在行上——搜索高亮/恢复用（mark 拆分文本节点
				 * 后 textContent 仍是原文拼接，锁定断言不受影响） */
				el._mTerm = term;
				el._mDesc = desc || '';
				el._mT = t;
				el._mD = desc ? d : null;
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
				row._mTerm = text;
				row._mG = text2;
				list.appendChild(row);
			};
			sec('🚀 快速上手');
			item('右键点我：打开菜单', '快捷操作都在右键菜单里——提醒我、装扮、历史任务、⚙️ 设置；📖 使用说明住在 DSH 侧边栏的「小鲸鱼助手」页面里。先记住这两个入口就够了。');
			item('点我一下：读通知', '有未读就逐条读给你（红标数字会减）；没有未读就陪我聊一句。');
			item('拖着我走：位置会记住', '按住我拖到喜欢的角落，刷新后还在这。跳回对话的手势看下面「交互手势」。');
			sec('🐳 我是什么');
			item('打工小鲸鱼，住在 DeepSeek Harness 右下角', '只读任务事件做播报和记录，不拦截、不修改任何任务行为，随便折腾不影响工作。任务在后台跑我也会看着，跑完立刻播报（取名慢时最多等 3 秒）。');
			sec('🔔 通知一览');
			item('[对话名]开工了 …', '任务开始跑。不进红标（不算未读）。');
			item('[对话名]完成了 …', '正常结束：响一声 + 红标 +1，下方同时弹出用量面板（本次消耗 / 全对话累计 / 上下文占用），和气泡同生同灭。');
			item('[对话名]失败了 …', '出错了：低沉音 + 红标 +1。双击通知气泡可回去看看。');
			item('[对话名]被截断了 …', '回复顶到 max tokens 上限：按完成处理（完成音 + 红标 +1 + 用量面板），任务本身没坏，只是内容被切短了。');
			item('[对话名]被中止了 ✋', '你手动停了任务：不算失败，但也会计入红标。');
			item('🤔 [对话名]需要你选择', '模型在等你作答：响铃 + 红标 +1。回到对话作答即收尾；任务还没跑完，用量等完成通知再统一看。');
			item('⚠️ [对话名]需要你审核', '有工具调用等你批准：同上。');
			item('上下文快挤爆了…建议 /compact', '上下文占用达到压力阈值时提醒一次。');
			item('⏰ 定时提醒', '右键菜单设的闹钟到点播报（会计入红标，不带用量面板）；免打扰时段也照常响——自己定的闹钟不受免打扰约束。');
			sec('🐾 交互手势');
			gesture(1, '左键拖动：移动我');
			gesture(2, '左键单击：进行互动（读通知）');
			gesture(3, '左键双击：游回角落（中途可抓住）');
			gesture(4, '双击通知气泡：跳转对应对话');
			gesture(5, '左键单击红标数字：读通知');
			gesture(6, '左键双击红标数字：通知清空');
			gesture(7, '右键：打开菜单');
			gesture(8, '右键双击：触发摸摸头');
			sec('🐋 桌宠模式（桌面上的独立小鲸鱼）');
			item('常驻桌面：跟着 DSH 走，关窗≠退出', '打开 DSH 桌宠就出现在桌面右下角（PC 重启后再开 DSH 才有）；DSH 最小化也在场。它在时页内小金鱼休息（休眠）；万一出意外，宿主每 30 秒体检一次，最长约 1 分钟自动重生，不用重启 DSH。');
			item('设置同步：页面改了桌宠跟着变', '桌宠是独立窗口、独立存储——侧边栏页里改的音色/音量/免打扰/总静音等设置经宿主自动下发到桌宠（约 2 秒内生效），不用两边各设一遍。');
			item('右键小鲸鱼：三种形态', '🐋 完整形态（日常）/ 🫧 缩成气泡 / 🙈 隐藏小鲸鱼＝躲猫猫：游到右下角收成一只小气泡，点一下气泡就破、鲸鱼冒出来。');
			item('通知、红标、用量：页内同款', '桌宠上的通知与页内完全同一套——真名播报、红标未读、三行用量、读回；双击通知气泡直接跳回 DSH 对应对话并把窗口拉到前台。');
			item('怎么"关掉"桌宠？', '右键 → 🙈 隐藏小鲸鱼（躲猫猫）就是它的"关"——桌面只剩一颗小气泡，点一下随时召回。它跟着 DSH 宿主走：彻底退出关掉 DSH 即可，没有常驻后台进程。');
			sec('🎛️ 设置项详解');
			item('🔔 开工通知（开/关）', '关掉后"开工了"不再播报，其余通知不受影响。');
			item('🌙 免打扰', '从 4 组时段预设里循环选（不能任填时间）。时段内完成/失败静音且不弹泡、只记红标；需要你动手的选择/审核照常提醒——急事不瞒你。');
			item('🔊 音量', '提示音音量，5 档循环。');
			item('🎵 音色（按通知设置）', '完成/失败/提问、定时提醒四类通知各选各的音效：单声叮 / 叮叮两连击 / 清脆上行 / 低沉下行 / 静音，下拉选中即生效并现场试听（各类可选项略有差异，如完成类没有低沉下行）。');
			item('⏱️ 工具超时', '某个工具跑超过该时长时，鲸鱼下方的状态面板会持续显示「⚠️ [对话名] 工具已运行 Ns」并逐秒读数（只是提醒，不会打断任务）。');
			item('🚨 压力提醒', '上下文占用达到该百分比时提醒 /compact；回降到 50% 以下后重新武装。');
			item('📊 任务周报', '近 7 天按日统计任务数（完成/失败/中止/提问）与 token 消耗。');
			item('📤 导出历史', 'Markdown：复制全部历史到剪贴板；CSV：下载表格文件。');
			item('🩺 运行状态', '鲸鱼自查各条通知链路（后台通知/用量读取/跳转）；平时全部正常、不打扰，出问题我头上会亮 ⚠️，点那个 ⚠️ 就能看是哪一条失效（详情在鲸鱼锚定的浮层里）。');
			item('🩺 调试模式', '排障用：开启后往控制台输出调试信息，并把取证数据写进 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。');
			item('怎么没有声音？', '依次看：右键菜单 🔊 声音是否开 → 设置里音量 → 🎵 音色里对应通知是否选了"静音" → 是否在免打扰时段（完成/失败静音，选择/审核/提醒照常）。');
			sec('📜 历史与红标');
			item('红标数字 = 未读通知数', '左键单击读一条（读过的消失），双击一键清空。完成/失败/被截断/被中止/提问/审核/定时提醒计入；开工、上下文压力提醒、工具运行提示不计入。超过 99+ 封顶显示。');
			item('📜 历史任务（右键菜单）', '保留最近 50 条：本地 + 服务器双存储，桌面壳和别的浏览器窗口看到同一份；支持搜索、清空、导出。');
			item('想彻底遗忘某个对话？', '两步：先清历史、再「清空通讯录」——历史里存的名字快照会在下次加载时回流，两步都做才真正遗忘。');
			item('换浏览器历史还在吗？', '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份；跨机器不同步。');
			item('历史突然变空了？', '极少数情况下账本文件损坏会自动隔离重建，~/.dsh/ 下会出现 whale-assistant.json.corrupt-时间戳 备份文件。想救回：先关 DSH，把文件名末尾的 .corrupt-时间戳 后缀删掉、恢复原名，再启动。');
			item('跳回对话', '双击通知气泡，或点历史抽屉里的任意一条记录。');
			sec('❤️ 陪伴小彩蛋');
			item('摸摸头', '右键双击我：好感 +1，还有小心心飘出。');
			item('状态与情绪', '任务越多我越累、会打瞌睡（拖一拖或双击我就醒）；右键菜单标题能看当前心情和进行中的任务数。');
			item('装扮与成就', '完成任务攒进度，解锁新装扮后去 右键菜单 → 🎨我的装扮 查看（面板里能看到还差几个任务）。');
			sec('🙋 常见问题');
			item('通知突然不来了？', '多半是页面放久了过期：刷新页面即可恢复——官方桌面端没有 F5，用我的右键菜单 🔄 刷新页面；浏览器里按 Ctrl+F5。我自己的链路出问题时头顶会亮 ⚠️，点它就能看是哪一条失效。');
			item('插件更新了怎么加载新版？', '同样刷新页面：右键菜单 🔄 刷新页面（桌面端）或 Ctrl+F5（浏览器）——新版本在下次加载时自动生效。');
			item('后台任务会打扰我吗？', '不会：只有完成/失败/需要你动手时才响铃，中间过程只在状态面板安静展示。免打扰时段里完成/失败静音且不弹泡、只记红标；开工气泡与你自己定的定时提醒照常——急事不瞒你。');
			wrap.appendChild(list);
			applyManualFolds(); /* 目录态 */
			var rowSection = [];
			var curSec = -1;
			for (var si = 0; si < list.children.length; si++) {
				if (list.children[si].className.indexOf('dsh-whale-manual-sec') === 0) curSec++;
				rowSection.push(curSec);
			}
			/* 高度实测自适应窗口（11-11 用户反馈固定 calc 边界悬空）：滚动区
			 * 底边钉在视口底-24px——边界永远落在窗口范围里，不再悬空 */
			function fitManualHeight() {
				if (typeof wrap.getBoundingClientRect !== 'function') return; /* vm 测试桩 */
				/* 11-11 真机修复轮：滚动容器=页根（pp-host 分层后 content→page
				 * →root）。基准改用容器 clientHeight（比 window.innerHeight 准：
				 * main 区≠整窗，窗窗口模式下旧算法本来就会偏），并用 rect 差值
				 * 消除页面已滚动带来的 top 偏移（切 Tab 时页面可能不在顶部） */
				try {
					var scroller = content.parentNode && content.parentNode.parentNode;
					if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;
					var relTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
					var h = Math.round((scroller.clientHeight || 0) - relTop - 24);
					if (h < 320) h = 320;
					wrap.style.height = h + 'px';
				} catch (e) { /* 桩环境兜底 */ }
			}
			fitManualHeight();
			/* 窗口 resize 后重算（11-11 审计 P3-3：只算一次=窗口变小底边悬出
			 * 视口、变大底部留白）——先摘旧处理器再挂新的；vm 桩无
			 * addEventListener 时跳过 */
			if (typeof window.addEventListener === 'function') {
				if (__ppManualResize) window.removeEventListener('resize', __ppManualResize);
				__ppManualResize = fitManualHeight;
				window.addEventListener('resize', __ppManualResize);
			}
		}
		/* 📊 周报 Tab（11-09 自 openReport 侧抽屉迁入——抽屉/浮层从侧边栏页
		 * 打开会盖住 DSH 侧边栏，全部页内化）。聚合逻辑与旧抽屉逐行同源：
		 * 近 7 天按日聚合 done/fail/killed/ask + tokens，本周汇总行置顶。 */
		function mountWhaleReportTab(content) {
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			function build() {
			list.textContent = ''; /* 重渲前清空——pullCloudHistory 回调二次 build 不叠加（11-11 用户实报双份） */
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
			var fmtK = function (n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n; };
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
			}
			/* 报告卡片化（用户反馈「这是搞的啥」：旧列表裸奔在页面背景上） */
			var card = document.createElement('div');
			card.className = 'dsh-whale-pp-report';
			card.appendChild(list);
			content.appendChild(card);
			build();
			/* warm: merge records saved by other windows（vm/离线静默降级）——
			 * 合并完成后重渲一次，首开即见其他窗口保存的记录 */
			try { pullCloudHistory(function () { build(); }); } catch (e) { /* offline */ }
		}
		window.__dshWhalePanel = { mount: mountWhalePanelPage };
