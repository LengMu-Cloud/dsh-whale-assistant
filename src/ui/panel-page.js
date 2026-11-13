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
					/* 页面底/文字直读 --wh-* token（DSH alias），亮暗主题自动跟随：
					 * 面板底=bg-layer-1 实底，卡片/行=bg-layer-2+card-stroke 描边，
					 * tint 一律走 interactive-bg-hover/active，不再自带深夜蓝硬编码 */
					'.dsh-whale-pp{width:min(100%,860px);margin:0 auto;padding:20px 26px;font-size:13px;color:var(--wh-panel-text);background:var(--wh-panel-bg)}',
					'.dsh-whale-pp-tabs{display:flex;gap:8px;margin:6px 0 18px}',
					'.dsh-whale-pp-tab{padding:7px 20px;border-radius:var(--wh-radius-full);cursor:pointer;border:1px solid var(--wh-panel-border);color:var(--wh-panel-muted);background:transparent;font-size:13px}',
					'.dsh-whale-pp-tab.on{background:var(--wh-panel-active);color:var(--wh-panel-text)}',
					'.dsh-whale-pp-sec{margin:20px 0 8px;font-weight:600;color:var(--wh-panel-head);font-size:12px}',
					'.dsh-whale-pp-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--wh-radius-s);cursor:pointer;background:var(--wh-card-bg);border:1px solid var(--wh-card-border);margin:5px 0}',
					'.dsh-whale-pp-row:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-pp-val{color:var(--wh-panel-muted)}',
					'.dsh-whale-pp-health{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:10px 14px;border-radius:var(--wh-radius-s);background:var(--wh-card-bg);border:1px solid var(--wh-card-border);margin:14px 0 0}',
					'.dsh-whale-pp select{background:var(--wh-panel-bg);color:var(--wh-panel-text);border:1px solid var(--wh-panel-border);border-radius:var(--wh-radius-s);padding:4px 8px;font-size:12px}',
					'.dsh-whale-pp-petbtns{display:flex;gap:10px;margin:10px 0}',
					'.dsh-whale-pp-petbtn{flex:1;padding:12px 10px;border-radius:var(--wh-radius-s);border:1px solid var(--wh-card-border);cursor:pointer;background:var(--wh-card-bg);color:var(--wh-panel-text);text-align:center;font-size:13px}',
					'.dsh-whale-pp-petbtn.on{background:var(--wh-panel-active);border-color:var(--wh-accent)}',
					'.dsh-whale-pp-status{color:var(--wh-panel-muted);margin:8px 0 4px;font-size:12px}',
					'.dsh-whale-pp-content .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-content .dsh-whale-manual-search{width:100%;margin:0 0 8px}',
					/* 使用说明 Tab：高度实测自适应窗口（用户反馈固定 calc 边界
					 * 悬空/局促——「直接适应窗口范围」）：底边=视口底-24px */
					'.dsh-whale-pp-manual{overflow-y:auto;padding-right:4px;overscroll-behavior:contain}',
					/* 周报 Tab：报告列表卡片化（旧抽屉壳的观感由这里补齐） */
					'.dsh-whale-pp-report{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m);padding:14px 16px;margin:14px 0 6px}',
					'.dsh-whale-pp-report .dsh-whale-history-list{max-height:none}',
					'.dsh-whale-pp-report .dsh-whale-report-summary{font-weight:600;color:var(--wh-panel-head);padding:8px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin-bottom:8px}',
					'.dsh-whale-pp-report .dsh-whale-history-row{display:flex;justify-content:space-between;padding:10px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin:5px 0}',
					/* 日期行假可点（主观痛点 9）：手型与 hover 高亮继承自旧抽屉
					 * 样式而页面无点击行为——指针与 hover 都收掉，tooltip 保留 */
					'.dsh-whale-pp-report .dsh-whale-history-row{cursor:default}',
					'.dsh-whale-pp-report .dsh-whale-history-row:hover{background:var(--wh-panel-hover)}',
					/* 页头（官方页 h1 20px/500 + 13px 描述行） */
					'.dsh-whale-pp-title{font-size:20px;font-weight:500;line-height:28px;color:var(--wh-panel-head);margin-top:2px}',
					'.dsh-whale-pp-desc{font-size:13px;line-height:20px;color:var(--wh-panel-muted);margin:4px 0 0}',
					/* 音色子行从属感（主观痛点 7）：左缩进一档 */
					'.dsh-whale-pp-tone-detail{margin-left:18px}',
					/* 试听按钮（11-11 三报）：select 重选同值不触发 change——
					 * 显式试听按钮兜住「想听已选中声音」的场景 */
					'.dsh-whale-tone-right{display:flex;align-items:center;gap:8px}',
					'.dsh-whale-tone-play{background:var(--wh-panel-bg);color:var(--wh-panel-text);border:1px solid var(--wh-panel-border);border-radius:var(--wh-radius-s);padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit}',
					'.dsh-whale-tone-play:hover{background:var(--wh-panel-hover)}',
					/* 桌宠未启用：按钮置灰（主观痛点 10） */
					'.dsh-whale-pp-petbtn.off{opacity:.45;cursor:default}',
					/* —— 周报新版式（11-13）：今日汇总置顶 + 按天折叠展开当日会话
					 * 明细 + token 占比条 + 会话行点击跳回。旧的「日期行假可点」
					 * 规则（.dsh-whale-history-row cursor:default，上方 51-54 行）
					 * 只匹配旧类名，新类名不受影响；全部走 --wh-* token 体系，
					 * 亮暗主题自动跟随 */
					/* 日期折叠头：可点（真可点了——旧评审的假可点收指针行为有意
					 * 变更），hover 抬到 panel-active 给出可点反馈 */
					'.dsh-whale-pp-report .dsh-whale-rep-day{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--wh-panel-hover);border-radius:var(--wh-radius-s);margin:5px 0;cursor:pointer}',
					'.dsh-whale-pp-report .dsh-whale-rep-day:hover{background:var(--wh-panel-active)}',
					/* 空日：无展开行为——指针与 hover 反馈都收掉（与 .rep-day:hover
					 * 同特异性、源序在后=胜出） */
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty{cursor:default}',
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-rep-day-left{color:var(--wh-panel-text)}',
					'.dsh-whale-rep-day-right{color:var(--wh-panel-muted);font-size:12px}',
					/* 展开后的会话明细行：cursor:pointer 只给折叠头与会话行 */
					'.dsh-whale-pp-report .dsh-whale-rep-srow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 12px 8px 24px;border-radius:var(--wh-radius-s);margin:3px 0;cursor:pointer}',
					'.dsh-whale-pp-report .dsh-whale-rep-srow:hover{background:var(--wh-panel-hover)}',
					'.dsh-whale-rep-smain{display:flex;flex-direction:column;min-width:0}',
					'.dsh-whale-rep-stitle{color:var(--wh-panel-text)}',
					'.dsh-whale-rep-smeta{color:var(--wh-panel-muted);font-size:12px;margin-top:2px}',
					'.dsh-whale-rep-sright{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}',
					'.dsh-whale-rep-stok{color:var(--wh-panel-muted);font-size:12px}',
					/* 占比条：4px 纯 CSS 条，底槽=panel-hover（token 体系下即宿主
					 * interactive-bg-hover），填充=accent */
					'.dsh-whale-rep-share{display:flex;align-items:center;gap:6px}',
					'.dsh-whale-rep-bar{width:90px;height:4px;border-radius:2px;background:var(--wh-panel-hover);overflow:hidden}',
					'.dsh-whale-rep-fill{height:100%;background:var(--wh-accent);border-radius:2px}',
					'.dsh-whale-rep-pct{color:var(--wh-panel-muted);font-size:11px}',
					/* —— 使用说明三层重构（11-13）：分区头 flex 化，右侧徽标/摘要
					 * 挤到行尾（::after 折叠箭头在 flex 里按普通项排到最右，旧
					 * float 规则对 flex 项自动失效）；全部走 --wh-* token 体系，
					 * 亮暗主题自动跟随 */
					'.dsh-whale-pp-manual .dsh-whale-manual-sec{display:flex;align-items:baseline;gap:8px}',
					'.dsh-whale-manual-badge{flex:none;font-size:10px;font-weight:500;line-height:16px;padding:0 7px;border-radius:var(--wh-radius-full);border:1px solid var(--wh-accent);color:var(--wh-accent);white-space:nowrap}',
					'.dsh-whale-manual-hint{margin-left:auto;font-size:10px;font-weight:400;color:var(--wh-panel-muted);white-space:nowrap}',
					/* 编号手势行两行式：说明行 flex-basis:100% 强制换行，左缩进
					 * 对齐正文（编号 18px + gap 10px = 28px） */
					'.dsh-whale-pp-manual .dsh-whale-help-row{flex-wrap:wrap;align-items:flex-start}',
					'.dsh-whale-pp-manual .dsh-whale-help-row .dsh-whale-manual-d{flex:1 1 100%;margin:0 0 2px 28px;padding:0}',
					/* —— 使用说明视觉重构（11-13 第二轮）：用户批「打开很乱、
					 * 一堆字堆上去、没有分类感」——条目卡片化 + 通知矩阵 +
					 * 机制内幕紧凑行。全部走 --wh-* token（唯一例外=搜索命中
					 * 底色沿用 style.css 既有 rgba 命中值，不新增色值）；选择器
					 * 全部钉在 .dsh-whale-pp-manual 作用域，历史抽屉/设置页零波及。
					 *特异性按 (0,2,0) 起步压过 style.css 的 (0,1,0) 基类规则 */
					/* ① 条目卡片：三步上手/日常操作/问题排障的每个条目一张轻卡片 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m);padding:9px 12px;margin:0 0 8px}',
					/* ② 卡片头行（标题）：12.5px/600 与描述行拉开视觉层级；编号
					 * 手势行同款卡片（类名保持 dsh-whale-help-row=测试/搜索契约） */
					'.dsh-whale-pp-manual .dsh-whale-manual-t{font-size:12.5px;font-weight:600;color:var(--wh-panel-text);line-height:18px}',
					'.dsh-whale-pp-manual .dsh-whale-help-text{font-size:12.5px;font-weight:600;color:var(--wh-panel-text);line-height:18px}',
					'.dsh-whale-pp-manual .dsh-whale-help-row{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m);padding:9px 12px;margin:0 0 8px}',
					/* 编号徽章：方形→圆形（18px 徽章居中排版走 inline-flex） */
					'.dsh-whale-pp-manual .dsh-whale-help-num{width:18px;height:18px;border-radius:50%;background:var(--wh-accent);color:#fff;font-size:10.5px;display:inline-flex;align-items:center;justify-content:center;flex:none}',
					/* ③ 描述行：muted 11.5px/1.6，头行下留 3px 呼吸；手势行说明行
					 * 缩进对齐正文（编号 18px + gap 10px = 28px，与上方既有规则
					 * 同特异性靠源序覆写其 margin） */
					'.dsh-whale-pp-manual .dsh-whale-manual-d{margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--wh-panel-muted)}',
					'.dsh-whale-pp-manual .dsh-whale-help-row .dsh-whale-manual-d{margin:3px 0 0 28px}',
					/* ④ 通知矩阵（「通知响了=该做什么」）：一句长横排 → 卡片内
					 * 4 行两列 grid，左列=状态（panel-text）右列=动词短句（muted） */
					'.dsh-whale-pp-manual .dsh-whale-manual-matrix{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:6px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-s{font-size:11.5px;line-height:1.6;color:var(--wh-panel-text);white-space:nowrap}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-a{font-size:11.5px;line-height:1.6;color:var(--wh-panel-muted)}',
					/* 搜索命中底色：style.css 的 (0,1,0) .help-hit 规则压不过上面的
					 * (0,2,0) 卡片底色——同值复写提特异性（色值沿用 style.css
					 * 既有命中底色，非新增） */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-help-hit,.dsh-whale-pp-manual .dsh-whale-help-row.dsh-whale-help-hit{background:rgba(255,199,0,0.12)}',
					/* 手册内 mark 高亮统一兜底（含手势行说明行——style.css 的
					 * mark 选择器组漏了它，顺手补齐），全部走 token */
					'.dsh-whale-pp-manual mark{background:var(--wh-highlight);color:var(--wh-panel-text);border-radius:2px;padding:0 1px}',
					/* ⑤ 机制内幕区（ℹ️ 更多细节）：无卡片——透明底单行紧凑行 +
					 * 分隔线，与主区卡片视觉分层；整区透明度 0.92 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-manual-detail{background:transparent;border:0;border-bottom:1px solid var(--wh-panel-divider);border-radius:0;padding:5px 2px;margin:0;opacity:.92;font-size:11.5px;line-height:1.55}',
					/* 标题与说明同行：inline 化 + 6px 间隔（标题 600/panel-text，
					 * 说明 muted——词条色 token 由上面共享规则带下来） */
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-t{display:inline;font-size:11.5px;line-height:inherit}',
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-d{display:inline;margin:0 0 0 6px;font-size:11.5px;line-height:inherit}'
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
		/* 📖 使用说明 Tab（11-08 自 openHelp 抽屉迁入；11-13 三层重构——设计者
		 * 视角 9 区 49 条全量平铺 → 纯用户视角「🚀 三步上手 / 🎮 日常操作 /
		 * 🔧 问题排障 / ℹ️ 更多细节」四区 36 条，机制内幕 19 条收进默认折叠
		 * 区）。搜索/折叠/命中高亮/孤头隐藏/折叠记忆/sticky 吸顶全保留；内容
		 * 抽成 PP_MANUAL_DATA 数据数组，渲染器只认数据（解释单源化）。 */
		var ppManualFoldMemo = {};
		var __ppManualResize = null; /* 手册滚动区的 resize 处理器——重复 mount 只留一个存活 */
		/* 手册内容=纯数据（11-13 重构）。g=编号行（三步上手 1-3 / 日常操作手势
		 * 1-8，编号两行式），t=词条，d=说明；badge/hint=分区头右侧徽标与摘要。
		 * 入口描述与真实入口逐一核对：右键菜单 6 项（⏰ 提醒我 / 声音 /
		 * 🎨 我的装扮 / 📜 历史任务 / ⚙️ 设置 / 🔄 刷新页面，menu.js 11-11
		 * 收口后现状）+ 桌宠窗口缝入的形态三项；侧边栏 4 Tab（TABS 表）。 */
		var PP_MANUAL_DATA = [
			{ sec: '🚀 三步上手', badge: '默认展开', items: [
				{ g: 1, t: '打开菜单', d: '右键小鲸鱼 → 提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 刷新页面；其余都在 DSH 左侧栏「小鲸鱼助手」页——设置 / 桌宠 / 周报 / 使用说明 四个 Tab。' },
				{ g: 2, t: '看通知、点跳转', d: '任务开始 / 完成 / 需要你操作时会响铃 + 冒气泡；双击气泡或通知直接跳到对应对话。红标数字 = 未读条数，单击读一条、双击全清。' },
				{ g: 3, t: '移动与形态', d: '按住鲸鱼拖到喜欢的位置，位置会记住；侧边栏「🐋 桌宠」Tab 或桌宠右键菜单可切换 🐋 完整形态 / 🫧 缩成气泡 / 🙈 躲猫猫。' }
			] },
			{ sec: '🎮 日常操作', hint: '手势 · 通知 · 常用设置', items: [
				{ g: 1, t: '按住拖动：移动我', d: '拖到喜欢的角落，位置会记住。' },
				{ g: 2, t: '左键单击：读通知 / 互动', d: '有未读就逐条读给你；没有未读就陪我聊一句。' },
				{ g: 3, t: '左键双击：游回角落', d: '游回右下角待命，中途可抓住。' },
				{ g: 4, t: '双击通知气泡：跳回对话', d: '直达对应对话，并把 DSH 窗口拉到前台。' },
				{ g: 5, t: '单击红标数字：读一条', d: '读过的自动消失（红标 -1）。' },
				{ g: 6, t: '双击红标数字：清空全部', d: '所有未读一键清零。' },
				{ g: 7, t: '右键：打开菜单', d: '提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 刷新页面。' },
				{ g: 8, t: '右键双击：摸摸头', d: '好感 +1，还有小心心飘出。' },
				{ t: '通知响了 = 该做什么', d: '✅ 完成 → 双击看结果；❌ 失败 / 截断 → 双击去看原因；❓ 需要你选择 / 🛡 需要你审核 → 只有等你点，双击直达决策处；🌡 上下文压力高 → 该收尾了（/compact）。' },
				{ t: '常用设置在哪', d: '声音 / 音量 / 音色 / 免打扰 / 开工通知 / 导出历史 → 侧边栏「⚙️ 设置」页：音色每行 ▶ 试听即点即听、免打扰时段点击循环切换；任务周报有专门的「📊 周报」Tab。' }
			] },
			{ sec: '🔧 问题排障', hint: '4 条', items: [
				{ t: '没声音？', d: '先看右键菜单 🔊 声音是否开、设置页音量拉起、避开免打扰时段；还不行点音色行的 ▶ 试听——试听也不响 = 系统音量 / 输出设备问题。' },
				{ t: '通知突然不来了？', d: '多半是页面放久了过期：刷新 DSH 页面——右键菜单 🔄 刷新页面（浏览器按 Ctrl+F5）；桌宠在岗时页内静默是正常的，铃在桌宠那边响。' },
				{ t: '装了新版没变化？', d: '刷新页面就会加载新代码（右键菜单 🔄 或 Ctrl+F5）；侧边栏页整个消失 = 管理页里插件被停用了。' },
				{ t: '点历史任务没反应？', d: 'DSH 关着时会自动重开窗口并跳转（约几秒）；刚重开 DSH 的几十秒内桌宠在换代，稍等再点。' }
			] },
			{ sec: 'ℹ️ 更多细节（机制内幕）', badge: '默认折叠', items: [
				{ t: '我是什么', d: '只读任务事件做播报和记录的打工小鲸鱼——不拦截、不修改任何任务行为，随便折腾不影响工作。' },
				{ t: '常驻与自愈', d: '桌宠跟着 DSH 走：开 DSH 就在（关窗≠退出），宿主每 30 秒体检、意外消失约 1 分钟内自动重生。' },
				{ t: '设置同步', d: '侧边栏页里改的音色 / 音量 / 免打扰等约 2 秒内自动下发到桌宠，不用两边各设。' },
				{ t: '红标计数规则', d: '完成 / 失败 / 截断 / 中止 / 提问 / 审核 / 定时提醒计入未读；开工、压力提醒、工具提示不计入；99+ 封顶。' },
				{ t: '定时提醒', d: '右键菜单设的闹钟到点播报；免打扰时段也照常响——自己定的闹钟不受免打扰约束。' },
				{ t: '中止与开工', d: '任务开始只播报、不算未读；手动中止不算失败，但也计入红标。' },
				{ t: '用量面板', d: '完成通知下方同时弹出本次消耗 / 全对话累计 / 上下文占用，与气泡同生同灭。' },
				{ t: '工具超时', d: '工具跑超过设定时长，状态面板逐秒显示「⚠️ 工具已运行 Ns」——只是提醒，不打断任务。' },
				{ t: '压力阈值', d: '上下文占用达到设定百分比提醒 /compact，回降到 50% 以下重新武装。' },
				{ t: '运行状态', d: '鲸鱼自查后台通知 / 用量读取 / 跳转三条链路；出问题头顶亮 ⚠️，点它看是哪条失效。' },
				{ t: '调试模式', d: '排障用：控制台输出调试信息 + 写 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。' },
				{ t: '历史双存储', d: '历史保留最近 50 条，本地 + 服务器双存储；支持搜索、清空、导出。' },
				{ t: '换浏览器历史还在吗', d: '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份；跨机器不同步。' },
				{ t: '想彻底遗忘某个对话', d: '两步：先清历史、再「清空通讯录」，两步都做才真正遗忘。' },
				{ t: '账本损坏', d: '极少数情况会自动隔离重建，~/.dsh/ 留有 .corrupt-时间戳 备份；想救回：先关 DSH、删掉后缀恢复原名再启动。' },
				{ t: '桌宠通知同款', d: '桌宠上的通知 / 红标 / 三行用量与页内完全同一套，双击气泡同样跳回对话。' },
				{ t: '怎么"关掉"桌宠', d: '右键 → 🙈 躲猫猫就是它的"关"：桌面只剩一颗小气泡，点一下随时召回；彻底退出关掉 DSH 即可，没有常驻后台进程。' },
				{ t: '摸摸头与装扮', d: '右键双击摸摸头：好感 +1、小心心飘出；完成任务攒进度解锁新装扮（右键菜单 → 🎨 我的装扮 查看）。' },
				{ t: '状态与情绪', d: '任务越多越累、会打瞌睡（拖一拖或双击就醒）；右键菜单标题看得到当前心情和进行中任务数。' }
			] }
		];
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
						/* 通知矩阵逐格恢复（11-13 视觉重构 _mCells 契约：格挂
						 * {el,text} 数组，与 _mT/_mD 同一恢复语义） */
						if (el._mCells) {
							for (var ci = 0; ci < el._mCells.length; ci++) el._mCells[ci].el.textContent = el._mCells[ci].text;
						}
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (rowSection && rowSection[i] >= 0 && rowSection[i] < secHits.length) secHits[rowSection[i]]++;
						if (el._mG) {
							highlightAll(el._mG, el._mTerm, q);
							/* 11-13 编号行带说明行：说明同样参与命中高亮 */
							if (el._mD) highlightAll(el._mD, el._mDesc, q);
						} else {
							if (el._mT) highlightAll(el._mT, el._mTerm, q);
							if (el._mD) highlightAll(el._mD, el._mDesc, q);
						}
						/* 通知矩阵逐格命中高亮（mark 逻辑同一套 highlightAll） */
						if (el._mCells) {
							for (var cj = 0; cj < el._mCells.length; cj++) highlightAll(el._mCells[cj].el, el._mCells[cj].text, q);
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
					/* 默认目录态=「🚀 三步上手」首开即展（主观痛点 6：置顶但折叠
					 * =对新手没置顶；11-13 重构沿用，仅随分区改名），其余三层全
					 * 折叠——机制内幕收进默认折叠区。用户点过的记住其选择 */
					var memoV = ppManualFoldMemo[s.title];
					var folded = memoV === undefined ? s.title !== '🚀 三步上手' : memoV !== false;
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
			var sec = function (t, badge, hint) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-sec';
				el.textContent = t;
				/* 分区头右侧徽标/摘要（11-13 三层重构）：折叠分区在收起态也能
				 * 一眼看到里面装了什么；flex 布局由注入 CSS 追加规则接管 */
				if (badge) {
					var bd = document.createElement('span');
					bd.className = 'dsh-whale-manual-badge';
					bd.textContent = badge;
					el.appendChild(bd);
				}
				if (hint) {
					var ht = document.createElement('span');
					ht.className = 'dsh-whale-manual-hint';
					ht.textContent = hint;
					el.appendChild(ht);
				}
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
			var item = function (term, desc, detail) {
				var el = document.createElement('div');
				/* 11-13 视觉重构：主区条目=轻卡片（CSS 接管）；机制内幕区
				 * 条目加 dsh-whale-manual-detail 走无卡片紧凑单行分层 */
				el.className = 'dsh-whale-manual-item' + (detail ? ' dsh-whale-manual-detail' : '');
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
			var gesture = function (n, text, desc) {
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
				if (desc) {
					/* 11-13 编号两行式：说明行挂在编号行下（复用 manual-d 的
					 * 搜索高亮/恢复契约：_mDesc/_mD 与词条行同构） */
					var d2 = document.createElement('div');
					d2.className = 'dsh-whale-manual-d';
					d2.textContent = desc;
					row.appendChild(d2);
					row._mDesc = desc;
					row._mD = d2;
				}
				row._mTerm = text;
				row._mG = text2;
				list.appendChild(row);
			};
			/* 通知矩阵卡片（11-13 视觉重构，用户批「4 种通知挤成一句长横排」）：
			 * PP_MANUAL_DATA 里该条的 d 是一句长横排（数据一字未改），渲染层
			 * 按用户拍板的四行两列短语转译成 mini 矩阵——左列=状态（panel-text
			 * 色）、右列=动词开头短句（muted 色）。矩阵短语挂 _mCells={el,text}
			 * 数组进搜索契约（highlightAll 会把 grid 压平，单串 _mD 挂点对矩阵
			 * 无意义，由逐格挂点顶上）；_mTerm/_mT 照常在行上，行级命中/隐藏/
			 * 折叠行为与普通条目完全一致 */
			var NOTIFY_DO_MATRIX = [
				['✅ 完成', '双击看结果'],
				['❌ 失败·截断', '双击看原因'],
				['❓🛡 需要你', '双击直达决策处'],
				['🌡 压力高', '该收尾了']
			];
			var notifyMatrix = function (term, pairs) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				el.appendChild(t);
				var grid = document.createElement('div');
				grid.className = 'dsh-whale-manual-matrix';
				var cells = [];
				pairs.forEach(function (p) {
					var st = document.createElement('span');
					st.className = 'dsh-whale-manual-mx-s';
					st.textContent = p[0];
					var act = document.createElement('span');
					act.className = 'dsh-whale-manual-mx-a';
					act.textContent = p[1];
					grid.appendChild(st);
					grid.appendChild(act);
					cells.push({ el: st, text: p[0] });
					cells.push({ el: act, text: p[1] });
				});
				el.appendChild(grid);
				el._mTerm = term;
				el._mT = t;
				el._mCells = cells;
				list.appendChild(el);
			};
			/* 内容渲染=遍历 PP_MANUAL_DATA（11-13 抽取）：行仍是 list 直接
			 * 子元素，rowSection 分区索引与搜索 children 遍历契约不破。
			 * 11-13 视觉重构：机制内幕区条目走 detail 紧凑行；「通知响了=
			 * 该做什么」按标题识别转译成通知矩阵卡片（数据未动） */
			PP_MANUAL_DATA.forEach(function (S) {
				sec(S.sec, S.badge, S.hint);
				var detail = S.sec.indexOf('更多细节') >= 0;
				S.items.forEach(function (it) {
					if (it.g) gesture(it.g, it.t, it.d);
					else if (it.t === '通知响了 = 该做什么') notifyMatrix(it.t, NOTIFY_DO_MATRIX);
					else item(it.t, it.d, detail);
				});
			});
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
		 * 近 7 天按日聚合 done/fail/killed/ask + tokens。11-13 版式升级（用户
		 * 批准方案）：旧「日期+计数+token 死列表」→ 今日汇总置顶 + 按天折叠
		 * 展开当日会话明细（标题/时刻/轮次/状态 + Σtoken + 当日占比条）+
		 * 会话行点击跳回——openSessionAt(endTime||at 翻页锚点) → 侧栏兜底，
		 * 与历史抽屉完全同链（drawers.js fillHistoryList 行点击）；空日
		 * 「这天没有任务记录」不可展开，空周保留原提示。 */
		var ppReportOpenDays = new Set(); /* 日期折叠展开态：模块级 Set，跨 Tab 切换/重渲存活（ppManualFoldMemo 同思路），默认全收起 */
		function mountWhaleReportTab(content) {
			var list = document.createElement('div');
			list.className = 'dsh-whale-history-list';
			function build() {
			list.textContent = ''; /* 重渲前清空——pullCloudHistory 回调二次 build 不叠加（11-11 用户实报双份） */
			var fmtK = function (n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n; };
			var weekAgo = Date.now() - 7 * 864e5;
			var days = {};
			var hasAny = false;
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				var at = rec.at || 0;
				if (at < weekAgo) continue;
				hasAny = true;
				var d = new Date(at);
				var key = (d.getMonth() + 1) + '月' + d.getDate() + '日';
				if (!days[key]) days[key] = { done: 0, fail: 0, killed: 0, ask: 0, tokens: 0, sessions: {} };
				var b = days[key];
				if (rec.kind === 'done') b.done++;
				else if (rec.kind === 'fail') b.fail++;
				else if (rec.kind === 'killed') b.killed++;
				else if (rec.kind === 'question' || rec.kind === 'approval') b.ask++; /* 计任务数；question/approval 的 turnTokens 为 null，不参与 token 求和 */
				if (rec.turnTokens) b.tokens += rec.turnTokens;
				/* 当日按 sessionId 分组（展开区会话明细行的数据源）。history 新
				 * →旧，组内首见=当日最新记录：标题取最新非「未命名任务」（全
				 * 未命名才回退原样），跳转锚点=最新记录的 endTime||at（多轮组
				 * 用 max 兜住乱序载荷，规范见 11-13 方案第 7 条） */
				var g = b.sessions[rec.sessionId || ''];
				if (!g) g = b.sessions[rec.sessionId || ''] = { n: 0, tokens: 0, hasBad: false, allDone: true, title: '', rawTitle: '', anchor: 0 };
				g.n++;
				if (rec.turnTokens) g.tokens += rec.turnTokens;
				if (rec.kind === 'fail' || rec.kind === 'killed') { g.hasBad = true; g.allDone = false; }
				else if (rec.kind !== 'done') g.allDone = false;
				if (!g.rawTitle) g.rawTitle = rec.title || '';
				if (!g.title && rec.title && rec.title !== '未命名任务') g.title = rec.title;
				var anchor = rec.endTime || rec.at || 0;
				if (anchor > g.anchor) g.anchor = anchor;
			}
			/* 今日汇总行（置顶卡片，沿用 .dsh-whale-report-summary 类名）：
			 * 今天的 key=本地日期；当日无记录也如实显示 0 */
			var now = new Date();
			var todayKey = (now.getMonth() + 1) + '月' + now.getDate() + '日';
			var tb = days[todayKey];
			var sumRow = document.createElement('div');
			sumRow.className = 'dsh-whale-report-summary';
			sumRow.title = '任务数与 token 按日聚合；周报窗口 7 天';
			sumRow.textContent = '今日 ' + todayKey + ' · ✅' + (tb ? tb.done : 0) + ' ❌' + (tb ? tb.fail : 0) + ' ⏹' + (tb ? tb.killed : 0) + ' ❓' + (tb ? tb.ask : 0) + ' · ' + fmtK(tb ? tb.tokens : 0) + ' tok · ' + (tb ? Object.keys(tb.sessions).length : 0) + ' 个对话';
			list.appendChild(sumRow);
			if (!hasAny) {
				var empty = document.createElement('div');
				empty.className = 'dsh-whale-history-empty';
				empty.textContent = '这 7 天还没有任务记录 🐳';
				list.appendChild(empty);
				return;
			}
			/* 每天一行（折叠头）：固定渲染窗口内 7 个本地日历日（今天起倒序，
			 * 按本地日期分量倒推——864e5 毫秒减法跨夏令时会日期漂移）。空日
			 * 「这天没有任务记录」：无箭头、不可展开、cursor:default */
			for (var dd = 0; dd < 7; dd++) {
				var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dd);
				var dkey = (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
				var db = days[dkey];
				var head = document.createElement('div');
				head.className = 'dsh-whale-rep-day' + (db ? '' : ' dsh-whale-rep-day-empty');
				head.title = '会话 token=当日该会话各轮消耗之和（turnTokens 口径）';
				var left = document.createElement('span');
				left.className = 'dsh-whale-rep-day-left';
				var right = document.createElement('span');
				right.className = 'dsh-whale-rep-day-right';
				if (!db) {
					left.textContent = dkey;
					right.textContent = '这天没有任务记录';
					head.appendChild(left);
					head.appendChild(right);
					list.appendChild(head);
					continue;
				}
				var open = ppReportOpenDays.has(dkey);
				var parts = [];
				if (db.done) parts.push('✅' + db.done);
				if (db.fail) parts.push('❌' + db.fail);
				if (db.killed) parts.push('⏹' + db.killed);
				if (db.ask) parts.push('❓' + db.ask);
				right.textContent = parts.join(' ') + (db.tokens ? ' · ' + fmtK(db.tokens) : '');
				left.textContent = (open ? '▾ ' : '▸ ') + dkey + ' · ' + Object.keys(db.sessions).length + ' 个对话';
				head.appendChild(left);
				head.appendChild(right);
				/* 整行点击切换展开/收起：重建整列表（build 开头已清空），展开
				 * 态从模块级 Set 读回——跨 Tab 切换/重渲存活 */
				head.addEventListener('click', (function (k) {
					return function (event) {
						event.stopPropagation();
						if (ppReportOpenDays.has(k)) ppReportOpenDays.delete(k);
						else ppReportOpenDays.add(k);
						build();
					};
				})(dkey));
				list.appendChild(head);
				if (!open) continue;
				/* 展开区：当日会话明细行，按组内最新活动倒序 */
				var sids = Object.keys(db.sessions);
				sids.sort(function (x, y) { return (db.sessions[y].anchor || 0) - (db.sessions[x].anchor || 0); });
				sids.forEach(function (sid) {
					var g2 = db.sessions[sid];
					var title2 = g2.title || g2.rawTitle || '（未命名）';
					var ad = new Date(g2.anchor || 0);
					var label = g2.hasBad ? '❌ 失败' : (g2.allDone ? '✅ 完成' : '混合');
					var pct = db.tokens > 0 ? Math.round(g2.tokens / db.tokens * 100) : 0;
					var srow = document.createElement('div');
					srow.className = 'dsh-whale-rep-srow';
					var main = document.createElement('div');
					main.className = 'dsh-whale-rep-smain';
					var st = document.createElement('div');
					st.className = 'dsh-whale-rep-stitle';
					st.textContent = title2;
					var sm = document.createElement('div');
					sm.className = 'dsh-whale-rep-smeta';
					sm.textContent = (ad.getHours() < 10 ? '0' : '') + ad.getHours() + ':' + (ad.getMinutes() < 10 ? '0' : '') + ad.getMinutes() + ' · ' + g2.n + ' 轮 · ' + label;
					main.appendChild(st);
					main.appendChild(sm);
					var sright = document.createElement('div');
					sright.className = 'dsh-whale-rep-sright';
					var stok = document.createElement('div');
					stok.className = 'dsh-whale-rep-stok';
					stok.textContent = fmtK(g2.tokens);
					var share = document.createElement('div');
					share.className = 'dsh-whale-rep-share';
					var bar = document.createElement('div');
					bar.className = 'dsh-whale-rep-bar';
					var fill = document.createElement('div');
					fill.className = 'dsh-whale-rep-fill';
					fill.style.width = pct + '%';
					bar.appendChild(fill);
					var pctEl = document.createElement('span');
					pctEl.className = 'dsh-whale-rep-pct';
					pctEl.textContent = '当日占比 ' + pct + '%';
					share.appendChild(bar);
					share.appendChild(pctEl);
					sright.appendChild(stok);
					sright.appendChild(share);
					srow.appendChild(main);
					srow.appendChild(sright);
					/* 与历史抽屉行点击完全同链（drawers.js 147-151）：带锚点直开
					 * →侧栏按 id →侧栏按标题；全失败给刷新提示 */
					srow.addEventListener('click', (function (sid2, anchor2, t2) {
						return function (event) {
							event.stopPropagation();
							if (openSessionAt(sid2, anchor2) || openViaSidebarById(sid2) || openViaSidebarByTitle(t2)) {
								uiSay('正在跳转到该对话… 🐳', 1500, sid2);
								return;
							}
							uiSay('跳转失败：右键菜单 🔄 刷新页面后重试（浏览器可按 Ctrl+F5）🥲', 3000, sid2);
						};
					})(sid, g2.anchor, title2));
					list.appendChild(srow);
				});
			}
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
