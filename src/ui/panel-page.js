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
					/* P3-9（UI 审美 v5 落地）：组签 +1.5px 字距——与抽屉版（3→2px）
					 * 收敛到同一签名，两语境同形 */
					'.dsh-whale-pp-sec{margin:20px 0 8px;font-weight:600;letter-spacing:1.5px;color:var(--wh-panel-head);font-size:12px}',
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
					'.dsh-whale-pp-content .dsh-whale-manual-search{width:100%;margin:0 0 8px;padding:8px 12px;font-size:13px}',
					/* 使用说明 Tab：高度实测自适应窗口（用户反馈固定 calc 边界
					 * 悬空/局促——「直接适应窗口范围」）：底边=视口底-24px */
					'.dsh-whale-pp-manual{overflow-y:auto;padding-right:4px;overscroll-behavior:contain}',
					/* 周报 Tab：报告列表卡片化（旧抽屉壳的观感由这里补齐）。
					 * P3-5（0.4.3 阶段 C，已批值变化）：收底圆角 12→16px（新
					 * l 档，Geist「大面卡配大圆角」层级语义，06 裁决采纳） */
					'.dsh-whale-pp-report{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-l);padding:14px 16px;margin:14px 0 6px}',
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
					/* P1-2b：空态 hover 也保持透明（与降级后的底色一致） */
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty:hover{background:transparent}',
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
					/* —— 使用说明卡片化重构（11-14，用户批「分区主层级小、子层级
					 * 大」的层级倒挂 + 「内容挤成一行」）：每个分区=一张完整融合
					 * 卡片（44px 可点卡头 + 与卡头同底同描边的体行，行间细分隔线，
					 * 末行收底圆角）——子内容被明确「包」在分区里；条目从独立重
					 * 卡片降级为卡体内行（14px 标题 / 13px 正文 / 20px 小徽章）。
					 * 颜色全部 --wh-* token（唯一例外=搜索命中底色沿用 style.css
					 * 既有 rgba 命中值）；选择器钉死 .dsh-whale-pp-manual 作用域，
					 * 历史抽屉/设置页零波及；特异性 (0,2,0) 起步压过 style.css
					 * 的 (0,1,0) 基类规则。扁平 DOM 不动：行仍是 list 直接子元素，
					 * 搜索 children 遍历 / data-folded 折叠记忆 / _m* 挂点契约全保 */
					/* ① 分区头=卡片头行：15px/600 主层级立起来，sticky 吸顶；
					 * 展开态与折叠态头行完全一致，chevron 圆片旋转指示状态；
					 * 展开时下角变方与体行融合、折叠时四角全圆自成一张卡 */
					'.dsh-whale-pp-manual .dsh-whale-manual-sec{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 10px 0 14px;margin:12px 0 0;background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-radius:var(--wh-radius-m) var(--wh-radius-m) 0 0;font-size:15px;font-weight:600;color:var(--wh-panel-text);top:0}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec[data-folded="1"]{border-radius:var(--wh-radius-m)}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec:hover{background-color:var(--wh-card-bg);background-image:linear-gradient(var(--wh-panel-hover),var(--wh-panel-hover))}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec-t{flex:none;line-height:22px}',
					/* 头行右侧：徽标/摘要退为 muted 小圆片/小字（原 accent 描边
					 * 徽章比主标题还抢眼——子层级压过父级的一大来源） */
					'.dsh-whale-pp-manual .dsh-whale-manual-badge{flex:none;margin-left:auto;font-size:11px;font-weight:500;line-height:20px;padding:0 9px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-panel-muted);white-space:nowrap}',
					'.dsh-whale-pp-manual .dsh-whale-manual-hint{margin-left:auto;font-size:11.5px;font-weight:400;color:var(--wh-panel-muted);white-space:nowrap}',
					/* 2026-11-18（用户实报「默认折叠跑到中间」）：badge 与 hint 都带
					 * margin-left:auto 时 flex 把剩余空间平摊进两个 auto 之间=徽标
					 * 被顶到行中央（唯「更多细节」分区两者兼有故暴露）。跟在徽标
					 * 后面的 hint 改吃 10px gap——auto 只剩 badge 一个，右侧簇
					 * [badge][hint][▸] 贴齐行尾；单项分区两条路径各不受影响。 */
					'.dsh-whale-pp-manual .dsh-whale-manual-badge + .dsh-whale-manual-hint{margin-left:0}',
					/* 头行 chevron：22px 圆片（style.css 的裸字符 ::after 覆写），
					 * 展开 ▸ 旋转 90° 朝下、折叠复位朝右，0.18s 过渡 */
					'.dsh-whale-pp-manual .dsh-whale-manual-sec::after{content:"▸";float:none;flex:none;width:22px;height:22px;line-height:22px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-panel-muted);font-size:10px;text-align:center;transform:rotate(90deg);transition:transform .18s ease;margin-left:2px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-sec[data-folded="1"]::after{transform:rotate(0deg)}',
					/* ② 卡片体=条目行：与卡头同底同描边、上下边裁掉，相邻行由
					 * (0,3,0) 内分隔线衔接——头行+体行融为一张完整卡片。类名
					 * dsh-whale-help-row / dsh-whale-manual-item 保持严格相等
					 * （测试/搜索契约），只动样式不动结构 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-top:0;border-bottom:0;border-radius:0;padding:10px 14px;margin:0}',
					'.dsh-whale-pp-manual .dsh-whale-help-row{background:var(--wh-card-bg);border:1px solid var(--wh-card-border);border-top:0;border-bottom:0;border-radius:0;padding:10px 14px;margin:0;flex-wrap:wrap;align-items:flex-start}',
					'.dsh-whale-pp-manual .dsh-whale-help-row+.dsh-whale-help-row,.dsh-whale-pp-manual .dsh-whale-help-row+.dsh-whale-manual-item,.dsh-whale-pp-manual .dsh-whale-manual-item+.dsh-whale-help-row,.dsh-whale-pp-manual .dsh-whale-manual-item+.dsh-whale-manual-item{border-top:1px solid var(--wh-panel-divider)}',
					/* ③ 卡片收底：分区最后一行（下一头行前 / 列表末尾）补下边+
					 * 下圆角（:has 相邻预测，WebView2/Chrome 105+；不支持的环境
					 * 退化为方角无下边，仅影响收尾观感，不影响功能） */
					'.dsh-whale-pp-manual .dsh-whale-history-list>*:has(+.dsh-whale-manual-sec),.dsh-whale-pp-manual .dsh-whale-history-list>*:last-child:not(.dsh-whale-manual-sec){border-bottom:1px solid var(--wh-card-border);border-radius:0 0 var(--wh-radius-m) var(--wh-radius-m)}',
					/* ④ 条目文字：标题 14px/600、正文 13px/1.6 muted——正文支持
					 * 数据内 \n 双行（主句+补充分行，pre-line 渲染），_mDesc 整串
					 * 高亮/恢复契约不变；编号徽章做小做精：20px accent-on-tint
					 * 圆片（原 18px 实心蓝抢过分区头——层级倒挂的另一来源） */
					'.dsh-whale-pp-manual .dsh-whale-manual-t{font-size:14px;font-weight:600;color:var(--wh-panel-text);line-height:20px;white-space:normal;word-break:keep-all}',
					'.dsh-whale-pp-manual .dsh-whale-help-text{font-size:14px;font-weight:600;color:var(--wh-panel-text);line-height:20px;white-space:normal}',
					'.dsh-whale-pp-manual .dsh-whale-help-num{box-sizing:border-box;flex:none;width:20px;height:20px;line-height:20px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);color:var(--wh-accent);font-size:11px;font-weight:600;text-align:center;display:inline-flex;align-items:center;justify-content:center}',
					'.dsh-whale-pp-manual .dsh-whale-manual-d{margin-top:4px;font-size:13px;line-height:1.6;color:var(--wh-panel-muted);white-space:pre-line;word-break:keep-all}',
					/* 编号手势行说明行：flex-basis:100% 强制换行，左缩进对齐正文
					 * （编号 20px + gap 10px = 30px） */
					'.dsh-whale-pp-manual .dsh-whale-help-row .dsh-whale-manual-d{flex:1 1 100%;margin:4px 0 0 30px;padding:0}',
					/* ⑤ 通知矩阵（「通知响了=该做什么」）：卡体内 4 行两列短语，
					 * 逐格 _mCells 搜索契约不变 */
					'.dsh-whale-pp-manual .dsh-whale-manual-matrix{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin-top:8px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-s{font-size:13px;line-height:1.6;color:var(--wh-panel-text);white-space:nowrap}',
					'.dsh-whale-pp-manual .dsh-whale-manual-mx-a{font-size:13px;line-height:1.6;color:var(--wh-panel-muted)}',
					/* ⑤b 末尾参考面板（11-14，用户批「1-8 编号节奏之后突然一堆
					 * 东西堆在那里」）：通知矩阵/常用设置两块参考内容不再与编号
					 * 条目同层平铺——外层保持卡片片段链（className 严格不变=
					 * 测试/搜索契约，样式走 :has 定向），内层软底内嵌盒+图标圆片，
					 * 与编号条目刻意「另起一格」 */
					'.dsh-whale-pp-manual .dsh-whale-manual-item:has(> .dsh-whale-manual-panel){padding:4px 10px 10px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel{background:var(--wh-panel-bg);border:1px solid var(--wh-panel-divider);border-radius:var(--wh-radius-s);padding:10px 12px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-h{display:flex;align-items:center;gap:8px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-ico{box-sizing:border-box;flex:none;width:20px;height:20px;line-height:20px;border-radius:var(--wh-radius-full);background:var(--wh-panel-hover);font-size:11px;text-align:center}',
					'.dsh-whale-pp-manual .dsh-whale-manual-panel-h .dsh-whale-manual-t{font-size:13.5px;line-height:20px}',
					/* ⑥ 搜索命中底色：style.css 的 (0,1,0) .help-hit 规则压不过上面的
					 * (0,2,0) 卡片底色——同值复写提特异性（色值沿用 style.css
					 * 既有命中底色，非新增） */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-help-hit,.dsh-whale-pp-manual .dsh-whale-help-row.dsh-whale-help-hit{background:rgba(255,199,0,0.12)}',
					/* 手册内 mark 高亮统一兜底（含手势行说明行），全部走 token */
					'.dsh-whale-pp-manual mark{background:var(--wh-highlight);color:var(--wh-panel-text);border-radius:2px;padding:0 1px}',
					/* ⑦ 机制内幕区（ℹ️ 更多细节）：无卡片——行与卡体同底色融合，
					 * 词条行内 600 + 说明行内 muted，行间 divider，7px 紧凑内边距
					 * （次级层级比主区条目更轻：字号 12.5px < 主区 14px） */
					'.dsh-whale-pp-manual .dsh-whale-manual-item.dsh-whale-manual-detail{padding:7px 14px;margin:0;font-size:12.5px;line-height:1.6}',
					/* 标题与说明同行：inline 化 + 8px 间隔（标题 600/panel-text，
					 * 说明 muted——词条色 token 由上面共享规则带下来） */
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-t{display:inline;font-size:12.5px;font-weight:600;line-height:inherit}',
					'.dsh-whale-pp-manual .dsh-whale-manual-detail .dsh-whale-manual-d{display:inline;margin:0 0 0 8px;font-size:12.5px;line-height:inherit}',
					/* ⑧ 节奏（4/8 倍数）：首区贴搜索框 4px，状态行收边去大留白 */
					'.dsh-whale-pp-manual .dsh-whale-history-list>.dsh-whale-manual-sec:first-child{margin-top:4px}',
					'.dsh-whale-pp-manual .dsh-whale-manual-status{padding:0 2px 2px;font-size:12px}',
					/* —— UI 审美 v5 落地（2026-11-19，批准 mockup-04/05 值）—— */
					/* P2-6a 健康条：✅ emoji → SVG 状态点（ok-dot=mockup-05 批准
					 * 画法；fail/warn 与周报语义圆片同族），inline-flex 光学居中
					 * （v4 用户裁决）。追修三：.wh-hdot 规则全局化——恢复提示行
					 * 在 .pp-health 作用域外也用 warn 圆片，作用域钉死会让行内
					 * SVG 无尺寸约束渲染成 300×150 默认画布（冒烟实锤） */
					'.dsh-whale-pp-health>span{display:inline-flex;align-items:center;gap:6px}',
					'.wh-hdot{display:inline-flex;flex:none;width:14px;height:14px;border-radius:var(--wh-radius-full);align-items:center;justify-content:center;vertical-align:middle}',
					'.wh-hdot svg{width:12px;height:12px;display:block}',
					'.wh-hdot-ok{background:rgba(34,197,94,.16)}',
					'.wh-hdot-fail{background:rgba(236,19,19,.16)}',
					'.wh-hdot-warn{background:rgba(245,158,11,.18)}',
					/* P1-4 语义色 class 路线（0.4.3 阶段 C）：SVG 工厂 hex 收口——
					 * 颜色挪 CSS（语义 token），几何/透明度留 attribute（vm 桩
					 * setAttribute 只存字符串，var() 进不了 attribute，05b §2.4
					 * 第 2 条）。子件类钩子：wh-dot-tint=低透明底片 / wh-dot-mark=
					 * stroke 线稿 / wh-dot-pt=实心点；色值与原 hex 逐一相等（等值
					 * 迁移，见交付对照表）。 */
					'.wh-rdot-done .wh-dot-tint,.wh-mdot-done .wh-dot-tint{fill:var(--wh-ok)}',
					'.wh-rdot-fail .wh-dot-tint,.wh-mdot-fail .wh-dot-tint{fill:var(--wh-danger)}',
					'.wh-rdot-ask .wh-dot-tint,.wh-mdot-ask .wh-dot-tint,.wh-rdot-warn .wh-dot-tint,.wh-mdot-warn .wh-dot-tint{fill:var(--wh-warn)}',
					'.wh-rdot-killed .wh-dot-tint{fill:var(--wh-neutral)}',
					'.wh-rdot-done .wh-dot-mark,.wh-mdot-done .wh-dot-mark,.wh-hdot-ok .wh-dot-mark{stroke:var(--wh-ok-strong);fill:none}',
					'.wh-rdot-fail .wh-dot-mark,.wh-mdot-fail .wh-dot-mark,.wh-hdot-fail .wh-dot-mark{stroke:var(--wh-danger-strong);fill:none}',
					'.wh-rdot-ask .wh-dot-mark,.wh-mdot-ask .wh-dot-mark,.wh-rdot-warn .wh-dot-mark,.wh-mdot-warn .wh-dot-mark,.wh-hdot-warn .wh-dot-mark{stroke:var(--wh-warn-strong);fill:none}',
					'.wh-rdot-ask .wh-dot-pt,.wh-mdot-ask .wh-dot-pt,.wh-rdot-warn .wh-dot-pt,.wh-mdot-warn .wh-dot-pt,.wh-hdot-warn .wh-dot-pt{fill:var(--wh-warn-strong)}',
					/* I-③-3 后半（0.4.3 阶段 C）：免打扰中指示 chip——通知区标题
					 * 行尾 ghost-chip（v5 语言最小实现，新增设计无批准 mockup、
					 * 待用户验）。sec 平时非 flex，chip 在场才 inline flex 化，
					 * margin-left:auto 推到行尾；letter-spacing 归零抗衡组签的
					 * 1.5px 宽距。 */
					'.dsh-whale-pp-sec .dsh-whale-pp-chip{margin-left:auto;flex:none;letter-spacing:0;font-weight:400}',
					/* P2-6b 开关类值 → 28×16 mini switch（accent 实轨/白钮；
					 * off=active 底/muted 钮——v4 用户裁决「做得还可以」保留） */
					'.dsh-whale-pp-switch{position:relative;flex:none;width:28px;height:16px;border-radius:var(--wh-radius-full);background:var(--wh-panel-active);display:inline-block;vertical-align:middle;transition:background .15s ease}',
					'.dsh-whale-pp-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--wh-panel-muted);transition:left .15s ease,background .15s ease}',
					'.dsh-whale-pp-switch.on{background:var(--wh-accent)}',
					'.dsh-whale-pp-switch.on::after{left:14px;background:#ffffff}',
					/* P2-6c 动作类值 → ghost chip：透明底（v5 二次裁决——与 select
					 * 灰底一眼可分）+1px 极弱描边+生产 muted 字色（.pp-val 继承） */
					'.dsh-whale-pp-val.dsh-whale-pp-chip{display:inline-block;padding:3px 10px;border:1px solid var(--wh-panel-border);border-radius:var(--wh-radius-s);background:transparent;font-size:12px;line-height:16px}',
					/* P1-2 周报数据排版：12px 语义圆片+等宽数字+空态降级（去卡片底
					 * 改虚线上分隔、12px/75% 透明——数据日自己浮出来） */
					'.dsh-whale-pp-report .wh-rdot{display:inline-block;width:12px;height:12px;vertical-align:-1.5px;margin:0 2px 0 6px}',
					'.dsh-whale-pp-report .wh-rnum{font-variant-numeric:tabular-nums;letter-spacing:.2px}',
					'.dsh-whale-pp-report .dsh-whale-report-summary{font-variant-numeric:tabular-nums}',
					'.dsh-whale-pp-report .dsh-whale-rep-day-right{font-variant-numeric:tabular-nums}',
					'.dsh-whale-pp-report .dsh-whale-rep-day-empty{background:transparent;border-top:1px dashed var(--wh-panel-divider);border-radius:0;padding:7px 14px;margin:0;opacity:.75}',
			/* —— P1-1 追修五（使用说明 Tab，设计专项方案+评审合并清单；每条独立回退=删行）—— */
			/* P2-1 分区头：15px/600 卡头图标按比例升 16px/-2px */
			'.dsh-whale-pp-manual .dsh-whale-manual-sec .dsh-whale-ico svg{width:16px;height:16px;transform:translateY(-2px)}',
			/* P2-2 组头：11px 字号语境 16px 槽/12px svg */
			'.dsh-whale-pp-manual .dsh-whale-manual-cat .dsh-whale-ico{width:16px}',
			'.dsh-whale-pp-manual .dsh-whale-manual-cat .dsh-whale-ico svg{width:12px;height:12px;transform:translateY(-1.5px)}',
			/* P2-3 参考面板圆片：svg 精确居中（text-align 对 svg 无效） */
			'.dsh-whale-pp-manual .dsh-whale-manual-panel-ico{display:inline-flex;align-items:center;justify-content:center}',
			'.dsh-whale-pp-manual .dsh-whale-manual-panel-ico svg{width:12px;height:12px;display:block}',
			/* P1-3+P2-4 矩阵左列语义圆片（repDot 12px 同族；-1.5px=wh-rdot 同值；display/flex-none 与 wh-rdot 同构） */
			'.dsh-whale-pp-manual .dsh-whale-manual-mx-s .wh-mdot{display:inline-block;flex:none;width:12px;height:12px;vertical-align:-1.5px;margin-right:4px}',
			/* DSH 官方位图槽（🖥️ 正文引用；值=pet/page.html L20 逐字节） */
			'.dsh-whale-ico-img{width:16px;height:16px;display:inline-block;vertical-align:middle;border-radius:4px;transform:translateY(-1.8px)}',
			/* —— 0.4.3 阶段 B（mock-b 批准面，2026-11-20）：昨夜摘要卡 / 周报改版 /
			 * 陪伴小账。类名逐字沿用 mockup（mock-* 前缀即批准规格，防转写漂移）；
			 * 唯一追加=.mock-sum-link 的 cursor:pointer（生产可点，mockup 是静态稿） */
			'.mock-sum-title{font-size:13.5px;font-weight:600;letter-spacing:.2px;display:flex;justify-content:space-between;align-items:baseline}',
			'.mock-sum-sub{font-size:11.5px;font-weight:400;color:#8b9096}',
			'.mock-sum-line{margin-top:10px;font-size:13px}',
			'.mock-sum-note{margin-top:8px;font-size:12px;color:#8b9096}',
			'.mock-sum-link{margin-top:10px;font-size:12px;color:var(--wh-accent);cursor:pointer}',
			'.mock-bignum{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.2px}',
			'.mock-taskrow{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:6px 10px;margin:6px 0 0;border-radius:6px}',
			'.mock-taskrow-fail{border-left:2px solid #f87171;background:rgba(248,113,113,.07)}',
			'.mock-taskrow .mut{color:#8b9096;font-size:11.5px;margin-left:auto;font-variant-numeric:tabular-nums}',
			'.mock-bars{display:flex;align-items:flex-end;gap:4px;height:34px;margin-top:8px}',
			'.mock-bars i{display:block;width:14px;border-radius:3px 3px 1px 1px;background:#2a2b30}',
			'.mock-bars i.on{background:linear-gradient(180deg,var(--wh-accent),rgba(122,143,255,.45))}',
			'.mock-days{display:flex;gap:4px;margin-top:4px}',
			'.mock-days span{width:14px;text-align:center;font-size:9.5px;color:#6b7077}'
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
			var TABS = [['settings', '⚙️ 设置'], ['pet', '🐋 小鲸鱼形态'], ['report', '📊 周报'], ['help', '📖 使用说明']];
			var curTab = 'settings';
			var tabBtns = {};
			TABS.forEach(function (t) {
				var b = document.createElement('button');
				b.className = 'dsh-whale-pp-tab';
				/* P1-1 追修四（11-19 用户实机反馈「页签还是 emoji」）：四页签
				 * 图形 SVG 化（⚙️🐋📊📖 全在 ICON_PATHS）；ghost 保 textContent
				 * 口径（页签文本断言与 repTabClick 文本定位不变） */
				setIconLabel(b, t[1]);
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
				/* P1-1 追修三：组签经 setIconLabel——🩺 运行状态的彩色 emoji →
				 * SVG 心电线稿（ghost 保口径）；无字形组签走原 textContent 路径 */
				setIconLabel(sec, label);
				host.appendChild(sec);
				return sec; /* 0.4.3 阶段 C：DND 指示 chip 需要锚回标题行 */
			}
			/* 行语义与 openSettings 逐条同源（同一份 CONFIG/applyConfig）——
			 * 改动即生效，整页重渲（页面区重渲不波及鲸鱼浮层） */
			function ppRow(host, label, valueText, onChange, chip) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				/* P2-6c（UI 审美 v5 落地）：动作类值 → ghost chip（透明底+极弱
				 * 描边，与 select 灰底一眼可分；字色维持生产 muted） */
				if (chip) v.classList.add('dsh-whale-pp-chip');
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
				/* P2-6a（UI 审美 v5 落地）：健康条 ✅ emoji → SVG 状态点（绿 tint
				 * 圆片+SVG 勾=mockup-05 批准 ok-dot；fail/warn 与周报语义圆片同
				 * 族）。emoji 原文进 ghost，textContent 口径（'后台通知 ✅'）逐字
				 * 不变 */
				function whHealthDot(kind) {
					var NS = 'http://www.w3.org/2000/svg';
					var wrap = document.createElement('span');
					wrap.className = 'wh-hdot wh-hdot-' + kind;
					var svg = document.createElementNS(NS, 'svg');
					svg.setAttribute('viewBox', '0 0 12 12');
					svg.setAttribute('aria-hidden', 'true');
					var add = function (name, attrs) {
						var el = document.createElementNS(NS, name);
						for (var k in attrs) el.setAttribute(k, attrs[k]);
						svg.appendChild(el);
					};
					/* P1-4 class 路线（0.4.3 阶段 C）：颜色挪注入 CSS
					 * （.wh-hdot-ok/-fail/-warn 的 .wh-dot-mark/.wh-dot-pt 规则，
					 * token=--wh-ok-strong/--wh-danger-strong/--wh-warn-strong），
					 * 几何留 attribute——vm 桩 setAttribute 只存字符串，var()
					 * 进不了 attribute（05b §2.4 第 2 条）。 */
					if (kind === 'ok') {
						add('path', { d: 'M2.8 6.4 5 8.6l4.2-5', 'class': 'wh-dot-mark', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
					} else if (kind === 'fail') {
						add('path', { d: 'M4.2 4.2l3.6 3.6M7.8 4.2 4.2 7.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
					} else {
						add('path', { d: 'M6 2.9v3.6', 'class': 'wh-dot-mark', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
						add('circle', { cx: 6, cy: 9.1, r: 0.8, 'class': 'wh-dot-pt' });
					}
					wrap.appendChild(svg);
					return wrap;
				}
				var healthItems = [
					{ label: '后台通知', fail: rep.server === 'fail' },
					{ label: '用量读取', fail: rep.dom === 'fail' },
					/* 跳转恒 warn 级（health.js 只产 ok|warn）；详情=鲸鱼头顶 ⚠️
					 * 的 openHealthPanel 浮层（menu.js 同源三行） */
					{ label: '气泡跳转', warn: rep.jump !== 'ok' }
				];
				healthItems.forEach(function (it) {
					var kind = it.fail ? 'fail' : (it.warn ? 'warn' : 'ok');
					var glyph = it.fail ? '❌' : (it.warn ? '⚠️' : '✅');
					var s = document.createElement('span');
					var gh = document.createElement('span');
					gh.className = 'dsh-whale-ico-ghost';
					gh.textContent = ' ' + glyph;
					s.appendChild(document.createTextNode(it.label));
					s.appendChild(gh);
					s.appendChild(whHealthDot(kind));
					strip.appendChild(s);
				});
				host.appendChild(strip);
				/* 恢复提示常驻在三个状态下面（11-09 用户拍板：详细自查展开区
				 * 与状态条内容重复，砍掉；链路异常时鲸鱼头顶 ⚠️ chip 仍可点
				 * 旧浮层看详情——鲸鱼锚定场景不违和） */
				var hint = document.createElement('div');
				hint.className = 'dsh-whale-pp-status';
				/* P1-1 追修三（11-19 用户实机反馈「提示行还是 emoji」）：行内 UI
				 * 引用图形同步 SVG——🔄=菜单刷新行同款线稿、⚠️=健康条 warn 圆片
				 * 同款、[🐋]=品牌鲸标进方括号；emoji 原文进 ghost，textContent
				 * 口径（'多数失效是页面过期' 前缀断言）逐字节不变 */
				hint.textContent = '';
				hint.appendChild(document.createTextNode('多数失效是页面过期：右键菜单 '));
				hint.appendChild(whInlineIcon('🔄'));
				hint.appendChild(document.createTextNode(' 刷新页面（或浏览器 Ctrl+F5）即可恢复；「气泡跳转 '));
				hint.appendChild(whHealthDot('warn'));
				var hintWarnGh = document.createElement('span');
				hintWarnGh.className = 'dsh-whale-ico-ghost';
				hintWarnGh.textContent = '⚠️';
				hint.appendChild(hintWarnGh);
				hint.appendChild(document.createTextNode('」在浏览器窗口属常态（走侧栏兜底）；仍失效请看控制台 ['));
				hint.appendChild(whInlineIcon('🐋'));
				hint.appendChild(document.createTextNode('] 日志'));
				host.appendChild(hint);
				/* 挂机心跳行（0.4.3 阶段 B，mock-a 批准面）：状态区末尾一行安静的
				 * 状态。显示条件=距 lastActivityAt ≥15 分钟 且 存在运行中任务
				 * （runSlots，status-panel 的运行态投影；无运行中任务=不显示）；
				 * 面板打开期间每 30s 自刷新；异常才换简述（stuck/fail 现有信号），
				 * 圆片 ok→warn。文本含批准的固定后缀（每 15 分钟自动更新…）。 */
				var hbRow = document.createElement('div');
				hbRow.className = 'dsh-whale-pp-status';
				host.appendChild(hbRow);
				ppRenderHeartbeat(hbRow);
				if (ppHbTimer) clearInterval(ppHbTimer);
				ppHbTimer = setInterval(function () {
					if (curTab !== 'settings') return; /* 别的 Tab 不刷（重进即重渲重挂） */
					ppRenderHeartbeat(hbRow);
				}, PP_HB_TICK_MS);
				var notifSec = ppSection(host, '通知');
				/* I-③-3 后半（0.4.3 阶段 C）：免打扰激活中的状态指示——通知区
				 * 标题行尾 ghost-chip「免打扰中 HH:MM–HH:MM」（dndActive 为真才
				 * 渲染）。ding 在 DND 期间本就不响（playDing 闸），指示只是让
				 * 状态可见。新增设计（无批准 mockup）：v5 ghost-chip 语言最小
				 * 实现，交付注明待用户验。dndActive 缺席（桩环境）静默跳过。 */
				try {
					if (dndActive()) {
						notifSec.style.display = 'flex';
						var dndChip = document.createElement('span');
						dndChip.className = 'dsh-whale-pp-val dsh-whale-pp-chip';
						dndChip.textContent = '免打扰中 ' + CONFIG.dndFrom + '–' + CONFIG.dndTo;
						notifSec.appendChild(dndChip);
					}
				} catch (eDndChip) { /* 桩环境兜底 */ }
				/* P2-6b（UI 审美 v5 落地）：开关类值 → 28×16 mini switch（用户
				 * 裁决保留）。「开/关」字面进 0 尺寸 ghost——textContent 口径
				 * （测试断言 includes('开')/includes('关') 与读屏）逐字不变，
				 * 状态视觉由 switch 承担 */
				function ppSwitchRow(host, label, isOn, offText, onChange, onText) {
					var row = document.createElement('div');
					row.className = 'dsh-whale-pp-row';
					var l = document.createElement('span');
					setIconLabel(l, label);
					var v = document.createElement('span');
					v.className = 'dsh-whale-pp-val';
					var ghost = document.createElement('span');
					ghost.className = 'dsh-whale-ico-ghost';
					ghost.textContent = isOn ? (onText || '开') : (offText || '关');
					var sw = document.createElement('span');
					sw.className = 'dsh-whale-pp-switch' + (isOn ? ' on' : '');
					v.appendChild(ghost);
					v.appendChild(sw);
					row.appendChild(l);
					row.appendChild(v);
					row.addEventListener('click', function (event) {
						event.stopPropagation();
						onChange();
					});
					host.appendChild(row);
				}
				ppSwitchRow(host, '🔔 开工通知', CONFIG.notifyOnStart, '关', function () {
					if (applyConfig({ notifyOnStart: !CONFIG.notifyOnStart })) saveConfig();
					render();
				});
				/* ⑳A 控件 select 化（11-17 用户拍板，第 48 章八节 A 项）：四个
				 * 「点击循环」行换原生 select（音色行 dsh-whale-sound-sel 同款
				 * 模式：脏值回落+click stopPropagation+change 即应用）——循环
				 * 行「调小先变大」根治，「能选不填」。设置链原样不动：
				 * applyConfig→saveConfig→pushPetConfig 中继照旧。行不带 click
				 * 翻转（select 自己管选择）；不 render()（重渲会重建 select，
				 * 音色行先例=change 后不重渲）。
				 * 下拉行工厂：opts=[{v,label}]，cur=当前存量值；不在 opts 时
				 * 动态补一个「当前值」选项（旧版本任意存量值显示不撒谎）。 */
				function ppSelectRow(host, label, opts, cur, onChange) {
					var row = document.createElement('div');
					row.className = 'dsh-whale-pp-row';
					var l = document.createElement('span');
					setIconLabel(l, label);
					var right = document.createElement('span');
					right.className = 'dsh-whale-tone-right';
					var sel = document.createElement('select');
					sel.className = 'dsh-whale-sound-sel';
					var hasCur = false;
					opts.forEach(function (o) {
						var opt2 = document.createElement('option');
						opt2.value = o.v;
						opt2.textContent = o.label;
						if (String(o.v) === String(cur)) hasCur = true;
						sel.appendChild(opt2);
					});
					/* 存量值不在预设里（旧版本/手改账本）：动态补当前值选项——
					 * 显示不撒谎，CONFIG 不动（选走即覆盖，选回不在列表照旧回落） */
					if (!hasCur) {
						var optCur = document.createElement('option');
						optCur.value = String(cur);
						optCur.textContent = String(cur) + '（当前）';
						sel.appendChild(optCur);
					}
					sel.value = String(cur);
					sel.addEventListener('click', function (event) { event.stopPropagation(); });
					sel.addEventListener('change', function () {
						onChange(sel.value);
					});
					right.appendChild(sel);
					row.appendChild(l);
					row.appendChild(right);
					host.appendChild(row);
				}
				var DND_PRESETS = [null, ['23:00', '08:00'], ['22:00', '07:00'], ['00:00', '06:00'], ['12:00', '14:00']];
				var dndOpts = [{ v: 'off', label: '关' }];
				DND_PRESETS.forEach(function (pr) {
					if (pr) dndOpts.push({ v: pr[0] + '-' + pr[1], label: pr[0] + '-' + pr[1] });
				});
				ppSelectRow(host, '🌙 免打扰', dndOpts,
					CONFIG.dndEnabled ? (CONFIG.dndFrom + '-' + CONFIG.dndTo) : 'off',
					function (v) {
						if (v === 'off') applyConfig({ dndEnabled: false });
						else {
							var seg = v.split('-');
							applyConfig({ dndEnabled: true, dndFrom: seg[0], dndTo: seg[1] });
						}
						saveConfig();
					});
				ppSection(host, '声音');
				/* 总静音（主观痛点 4）：菜单 🔇 的页面镜像——菜单里静音着时
				 * 页内调音量依然无声，此前页面无法解释这个现象。
				 * P2-6b：值改 mini switch（off 态=静音中，ghost 保留完整字面） */
				ppSwitchRow(host, '🔊 声音总开关', !(window.__dshWhale.soundMuted && window.__dshWhale.soundMuted()), '关（静音中）', function () {
					if (window.__dshWhale.setSoundMuted) window.__dshWhale.setSoundMuted(!window.__dshWhale.soundMuted());
					render();
				});
				var VOL_STEPS = [0, 0.25, 0.5, 0.75, 1];
				ppSelectRow(host, '🔊 音量', VOL_STEPS.map(function (v) {
					return { v: String(v), label: Math.round(v * 100) + '%' };
				}), String(CONFIG.volume), function (v) {
					if (applyConfig({ volume: parseFloat(v) })) saveConfig();
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
					/* P1-1 追修四：音色四行 ✅❌❓⏰ 图形 SVG 化（ghost 保口径）。
					 * 标签正文收进独立 span——试听反馈改 textContent 原位改写
					 * （旧 textContent 整体重赋会抹掉图标 DOM；不抓 setIconLabel
					 * 的尾文本节点——vm 测试桩无 lastChild，自建元素桩上稳妥） */
					l.appendChild(whInlineIcon(k.label.slice(0, k.label.indexOf(' '))));
					var labelRest = k.label.slice(k.label.indexOf(' '));
					var labelText = document.createElement('span');
					labelText.textContent = labelRest;
					l.appendChild(labelText);
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
						labelText.nodeValue = labelRest + (mutedNow ? ' 🔇（总开关静音）' : ' ♪');
						setTimeout(function () { labelText.nodeValue = labelRest; }, 1800);
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
				}, true); /* P2-6c：动作类值 → ghost chip */
				host.appendChild(toneDetail);
				ppSection(host, '监控');
				var TOOL_PRESETS = [5000, 8000, 15000, 30000, 60000];
				ppSelectRow(host, '⏱️ 工具超时', TOOL_PRESETS.map(function (ms) {
					return { v: String(ms), label: Math.round(ms / 1000) + 's' };
				}), String(CONFIG.toolStuckMs), function (v) {
					if (applyConfig({ toolStuckMs: parseInt(v, 10) })) saveConfig();
				});
				var P_PRESETS = [50, 60, 70, 80, 90];
				ppSelectRow(host, '🚨 压力提醒', P_PRESETS.map(function (pc) {
					return { v: String(pc), label: pc + '%' };
				}), String(CONFIG.pressureWarnPct || 70), function (v) {
					if (applyConfig({ pressureWarnPct: parseInt(v, 10) })) saveConfig();
				});
			/* 行内闪现反馈（11-11 用户实报「点了没动静」）：exportHistory 的
			 * 反馈走 uiSay 鲸鱼气泡——桌宠运行时页鲸休眠=打在隐藏元素里零可
			 * 见反馈。页面行自带 ✓ 闪现，不依赖鲸鱼可见性 */
			function ppFlashRow(host, label, valueText, onDo, chip) {
				var row = document.createElement('div');
				row.className = 'dsh-whale-pp-row';
				var l = document.createElement('span');
				setIconLabel(l, label);
				var v = document.createElement('span');
				v.className = 'dsh-whale-pp-val';
				v.textContent = valueText;
				if (chip) v.classList.add('dsh-whale-pp-chip'); /* P2-6c ghost chip */
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
			}, true); /* P2-6c：动作类值 → ghost chip */
			ppFlashRow(host, '📤 导出历史', 'CSV → 下载文件', function (flash) {
				if (!history.length) { flash('还没有记录可导出 🐳'); return; }
				exportHistory('csv', function (ok) { if (ok) flash('✓ CSV 已下载 📤'); });
			}, true);
			ppSection(host, '诊断');
			var debugNow = false;
			try { debugNow = localStorage.getItem('dsh-whale:debug') === 'on'; } catch (e) {}
			/* P2-6 追修（11-19 用户实机反馈「调试模式还是旧版」）：开关类值全量
			 * 统一——调试模式同样改 mini switch；「开（取证中）」字面进 ghost */
			ppSwitchRow(host, '🩺 调试模式', debugNow, '关', function () {
				try { localStorage.setItem('dsh-whale:debug', debugNow ? 'off' : 'on'); } catch (e) {}
				render();
			}, '开（取证中）');
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
				status.textContent = '形态状态读取中…';
				host.appendChild(status);
				var btns = document.createElement('div');
				btns.className = 'dsh-whale-pp-petbtns';
				var FORMS = [['full', '🐋 完整形态'], ['bubble', '🪟 缩成小窗'], ['hidden', '🙈 隐藏小鲸鱼']];
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
					/* P1-1（UI 审美 v5 落地）：三卡 🐋🪟🙈 彩色 emoji → SVG 线稿
					 * （鲸鱼 logo path / 圆角窗 / 闭眼，与桌宠 flyout 同一套
					 * ICON_PATHS）；ghost 保 textContent 口径（命名统一断言不变） */
					setIconLabel(b, f[1]);
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
									/* P1-1 追修（11-19 用户实机反馈「当前形态没同步更新」）：
									 * 提示行里的形态 emoji → 与三卡同款 SVG 线稿；ghost 保
									 * textContent 口径（'…当前形态：🐋 完整形态）'逐字节不变） */
									status.textContent = '';
									status.appendChild(document.createTextNode('已切换 ✓（当前形态：'));
									var curIco = document.createElement('span');
									setIconLabel(curIco, f[1]);
									status.appendChild(curIco);
									status.appendChild(document.createTextNode('）'));
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
				note.textContent = '「隐藏小鲸鱼」（躲猫猫）＝游到右下角收成一颗小气泡，点一下气泡随时召回；小鲸鱼跟着 DSH 宿主住，关掉 DSH 才真正退出。';
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
								status.textContent = '桌面形态未启用（平台不支持）——页内鲸鱼顶班中，形态控制不可用';
							}
							else status.textContent = pet.up ? '小鲸鱼在岗 ✓' : '小鲸鱼暂离——页内鲸鱼顶班中，自愈心跳约 1 分钟内拉回';
						}).catch(function (e) {
						status.textContent = '形态状态读取失败：' + (e && e.message || e);
					});
				} catch (e) {
					status.textContent = '形态状态读取失败：' + (e && e.message || e);
				}
			}
			render();
			/* 0.4.3 阶段 B：摘要气泡/外部入口的 Tab 直切缝。openTab 由最新挂载
			 * 实例注册生效；页面尚未挂载时点击方只置 ppPendingReportTab 意向位，
			 * 由这里消费（selectPanel → React mount 是异步的，意向位补齐时序缝） */
			try {
				window.__dshWhalePanel.openTab = function (t) {
					for (var i = 0; i < TABS.length; i++) {
						if (TABS[i][0] === t) {
							curTab = t;
							render();
							ppPendingReportTab = false;
							return true;
						}
					}
					return false;
				};
			} catch (eOpenTab) {}
			if (ppPendingReportTab) {
				ppPendingReportTab = false;
				curTab = 'report';
				render();
			}
		}
		/* 📖 使用说明 Tab（11-08 自 openHelp 抽屉迁入；11-13 三层重构——设计者
		 * 视角 9 区 49 条全量平铺 → 纯用户视角「🚀 三步上手 / 🎮 日常操作 /
		 * 🔧 问题排障 / ℹ️ 更多细节」四区 36 条，机制内幕 19 条收进默认折叠
		 * 区）。搜索/折叠/命中高亮/孤头隐藏/折叠记忆/sticky 吸顶全保留；内容
		 * 抽成 PP_MANUAL_DATA 数据数组，渲染器只认数据（解释单源化）。 */
		var ppManualFoldMemo = {};
		var __ppManualResize = null; /* 手册滚动区的 resize 处理器——重复 mount 只留一个存活 */
		/* 手册内容=纯数据（11-13 抽取 / 11-14 文案两行制）。g=编号行（三步
		 * 上手 1-3 / 日常操作手势 1-8，编号两行式），t=词条，d=说明——d 可含
		 * 一个 \n：第一行=主句（一句话说清这件事），第二行=补充说明（次要
		 * 信息），渲染层 pre-line 出两行，搜索高亮/恢复按整串契约不动；
		 * badge/hint=分区头右侧徽标与摘要。
		 * 入口描述与真实入口逐一核对（2026-11-18 全面分析 B-3 对齐实测）：
			 * 页内右键菜单 6 项（⏰ 提醒我 / 声音 / 🎨 我的装扮 / 📜 历史任务 /
			 * ⚙️ 设置 / 🔄 刷新页面，menu.js 11-11 收口后现状）；桌面形态菜单
			 * 8 行——刷新页换成两个二级组「🖥️ DSH 窗口 ›」（刷新 / 打开 DSH
			 * 窗口）与「🎭 切换形态 ›」（三项收进子菜单，radio 圆点标当前态）；
			 * 侧边栏 4 Tab（TABS 表）。 */
		var PP_MANUAL_DATA = [
			{ sec: '🚀 三步上手', badge: '默认展开', items: [
				{ g: 1, t: '打开菜单', d: '右键小鲸鱼：页内菜单 = 提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 🔄 刷新页面；桌面形态多两组：「🖥️ DSH 窗口 ›」（刷新 / 打开 DSH 窗口）和「🎭 切换形态 ›」（当前形态带实心圆点）。\n完整配置页在 DSH 左侧栏「小鲸鱼助手」：设置 / 小鲸鱼形态 / 周报 / 使用说明 四个 Tab。' },
				{ g: 2, t: '看通知、点跳转', d: '任务开始 / 完成 / 需要你操作时，小鲸鱼会响铃 + 冒气泡，双击气泡或通知直接跳到对应对话。\n气泡上的红标数字 = 未读条数：单击读一条，双击全部清空。' },
				{ g: 3, t: '移动与形态', d: '按住鲸鱼拖到喜欢的位置，位置会自动记住。\n侧边栏「🐋 小鲸鱼形态」Tab，或小鲸鱼右键菜单「🎭 切换形态」子菜单（当前形态带实心圆点）可切换：🐋 完整形态 / 🪟 缩成小窗 / 🙈 隐藏小鲸鱼。' }
			] },
			{ sec: '🎮 日常操作', hint: '手势 · 通知 · 常用设置', items: [
				{ g: 1, t: '按住拖动：移动我', d: '拖到喜欢的角落，位置会记住。' },
				{ g: 2, t: '左键单击：读通知 / 互动', d: '有未读就逐条读给你，没有未读就陪我聊一句。' },
				{ g: 3, t: '左键双击：游回角落', d: '游回右下角待命，中途可以抓住它。' },
				{ g: 4, t: '双击通知气泡：跳回对话', d: '直达对应对话，并把 DSH 窗口拉到前台。' },
				{ g: 5, t: '单击红标数字：读一条', d: '读过的自动消失，红标 -1。' },
				{ g: 6, t: '双击红标数字：清空全部', d: '所有未读一键清零。' },
				{ g: 7, t: '右键：打开菜单', d: '页内：提醒我 / 声音 / 我的装扮 / 历史任务 / 设置 / 🔄 刷新页面；桌面形态还有「🖥️ DSH 窗口 ›」「🎭 切换形态 ›」两个二级组。' },
				{ g: 8, t: '右键双击：摸摸头', d: '好感 +1，还有小心心飘出。' },
				{ t: '通知响了 = 该做什么', d: '✅ 完成 → 双击看结果；❌ 失败 / 截断 → 双击去看原因；❓ 需要你选择 / 🛡 需要你审核 → 只有等你点，双击直达决策处；🌡 上下文压力高 → 该收尾了（/compact）。' },
				{ t: '常用设置在哪', d: '声音 / 音量 / 音色 / 免打扰 / 开工通知 / 导出历史，都在侧边栏「⚙️ 设置」页。\n音色每行 ▶ 试听即点即听、免打扰时段点击循环切换；任务周报有专门的「📊 周报」Tab。' }
			] },
			{ sec: '🔧 问题排障', hint: '4 个常见问题', items: [
				{ t: '没声音？', d: '先查三处：右键菜单 🔊 声音是否开、设置页音量是否拉起、是否正处免打扰时段。\n还不行就点音色行的 ▶ 试听——试听也不响 = 系统音量 / 输出设备问题。' },
				{ t: '通知突然不来了？', d: '多半是页面放久了过期：右键菜单 🔄 刷新页面（浏览器按 Ctrl+F5）即可恢复。\n桌面形态在岗时页内静默是正常的，铃在小鲸鱼那头响。' },
				{ t: '装了新版没变化？', d: '刷新页面就会加载新代码：右键菜单 🔄 或 Ctrl+F5。\n侧边栏页整个消失 = 管理页里插件被停用了，去管理页重新启用。' },
				{ t: '点历史任务没反应？', d: 'DSH 关着时会自动重开窗口并跳转（约几秒）。\n刚重开 DSH 的几十秒内桌面小鲸鱼正在换代，稍等再点。' }
			] },
			{ sec: 'ℹ️ 更多细节（机制内幕）', badge: '默认折叠', hint: '5 组 19 条', items: [
				{ cat: '🐳 它与宿主', t: '我是什么', d: '只读任务事件做播报和记录的打工小鲸鱼——不拦截、不修改任何任务行为，随便折腾不影响工作。' },
				{ t: '常驻与自愈', d: '桌面小鲸鱼跟着 DSH 走，开 DSH 就在（关窗≠退出）；宿主每 30 秒体检，意外消失约 1 分钟内自动重生。' },
				{ t: '设置同步', d: '侧边栏页里改的音色 / 音量 / 免打扰等，约 2 秒内自动下发到桌面的小鲸鱼，不用两边各设。' },
				{ t: '状态与情绪', d: '任务越多越累、会打瞌睡（拖一拖或双击就醒）；右键菜单标题看得到当前心情和进行中任务数。' },
				{ cat: '🔔 通知与红标', t: '红标计数规则', d: '完成 / 失败 / 截断 / 中止 / 提问 / 审核 / 定时提醒计入未读；开工、压力提醒、工具提示不计入，99+ 封顶。' },
				{ t: '定时提醒', d: '右键菜单设的闹钟到点播报；免打扰时段也照常响——自己定的闹钟不受免打扰约束。' },
				{ t: '中止与开工', d: '任务开始只播报、不算未读；手动中止不算失败，但也计入红标。' },
				{ t: '用量面板', d: '完成通知下方同时弹出本次消耗 / 全对话累计 / 上下文占用，与气泡同生同灭。' },
				{ cat: '🛠 盯活与健康', t: '工具超时', d: '工具跑超过设定时长，状态面板逐秒显示「⚠️ 工具已运行 Ns」——只是提醒，不打断任务。' },
				{ t: '压力阈值', d: '上下文占用达到设定百分比提醒 /compact，一次性不重复；明显缓解后重新武装（默认回落线 50%，阈值调低时按比例跟降，永不与阈值重叠）。' },
				{ t: '运行状态', d: '鲸鱼自查后台通知 / 用量读取 / 跳转三条链路；出问题头顶亮 ⚠️，点它看是哪条失效。' },
				{ t: '调试模式', d: '排障用：控制台输出调试信息 + 写 ~/.dsh/whale-assistant.json 的 _debug 键，平时保持关闭。' },
				{ cat: '📜 历史与数据', t: '历史双存储', d: '历史保留最近 500 条，本地 + 服务器双存储；支持搜索、清空、导出。' },
				{ t: '换浏览器历史还在吗', d: '在——历史跟服务端走，同一台机器的桌面壳和各浏览器窗口看到同一份，跨机器不同步。' },
				{ t: '想彻底遗忘某个对话', d: '两步：先清历史、再「清空通讯录」，两步都做才真正遗忘。' },
				{ t: '账本损坏', d: '极少数情况会自动隔离重建，~/.dsh/ 留有 .corrupt-时间戳 备份；想救回：先关 DSH、删掉后缀恢复原名再启动。' },
				{ cat: '🖥 桌面形态', t: '桌面通知同款', d: '桌面小鲸鱼上的通知 / 红标 / 三行用量与页内完全同一套，双击气泡同样跳回对话。' },
				{ t: '怎么"关掉"小鲸鱼', d: '右键 → 🙈 隐藏小鲸鱼（躲猫猫）就是它的"关"：桌面只剩一颗小气泡，点一下随时召回；彻底退出关掉 DSH 即可，没有常驻后台进程。' },
				{ t: '摸摸头与装扮', d: '右键双击摸摸头：好感 +1、小心心飘出；完成任务攒进度解锁新装扮（右键菜单 → 🎨 我的装扮 查看）。' }
			] }
		];
		function mountWhaleManualTab(content) {
			/* —— P1-1 追修五（11-19 使用说明 Tab emoji 收口，设计专项+评审合并清单）——
			 * 行内 UI 引用图形构建期组合：ppBuildDesc/ppBuildMxCell 把说明串按 A 类字形簇
			 * 切装配（文本段+SVG/img 槽+ghost），textContent 逐字节不变（ghost 保原文）。
			 * 搜索命中/清空恢复与初始渲染共用同一装配函数=图形永不退回裸 emoji（评审
			 * P1-A：矩阵逐格命中是第四条 DOM 重建路径，同一函数自然覆盖）。
			 * 偏差声明：设计方案的「后置 walker（ppDecorateText）」在 vm 测试桩上不可行
			 * （桩无 childNodes/insertBefore/lastChild），改为构建期组合——契约等价
			 * （textContent/扁平 DOM/类名/_m* 全保），DOM 操作更少且 vm 可测。
			 * K 类保留（▶/⚠️/🔍 不进 PP_A_RE）：引用面真身即字符本身（whale.js 实测）。 */
			var PP_DSH_ICON_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAcmSURBVFhHzZd7jFTlGcZNbePfShPByN6cGeZ+2Rlm9mqBBWUXWWAXlI1b1grW1JbWNFWKguwq7ErFKgoJG8UWBWPUYIIJSWtwoVxKy7IglFrZKuCyMzuXMzNn5tzPmXnM952ZYWf2Av7RpG/y5OTMOd/3/M77ve93ztx22/9bDAwM/FCSpGZFUZ6TZXmrKIqTis+Lv7lEUd6qKMpGURQXr1q16vZSz0KkUqn7M5nMF/gfhqpp51iWrSv1Jub1mqbJ5CZN06CqapEUIqVUCuTxkosllUhWVB1C1cQYywYK5pcvX75DUZSv9IvFxjeHKAG5CYQoKxRCEMRLg4ODP6IAHMe1TPXkk2kqkFvNRj4TyWRyEQUQBGHLzZ6+VFNB3Go2SKQ4biMF4Hm+7/sCUGkqMpkMtEymCIJmM5OZFoREmud78gDbpgMgJlMFMUiyLD0Sc03L4Oq1EaTSHF3SUgiVLNWNDGyZFoBMkI+vv7mCE6dOY+DocXxx4V/424m/Y1N3L1rbO7FzV38BNJPJomvdenx08FM6jvxGlotkhAQBlCTabOCmA8ibE8OOzrVweRtgtHphsHhhc9fCZJ+LcoMLFmctvrr83xxmFuk0h4XN7fAEmrB7zzvIZrP0iihJOHvuAjZ1v0yzMy1A3vztvftQfp8N5ffZYXX6YXfXwu6powDk6PQ2wOqqxS9/8yyi0RgdQ4pwZcfjMFj9KDdWY/uOXdi4eRuaWzvgCSzEmrXrC/NPCUDir58dwexKC8w2L+zumoIcnlo4PHVwVNdTubyNqDS50bz0YbpMJHbv2Ysygxtu/3zMcdTBaKuB0zcPFlcDPvz4EL1nSgCSMp4X0LK0DeVVFpjtXlidc+HwEPMSiByIy9cIg6UaTYuX45srV+nkv3p6A2yeBlTXNMFR3QhPYAFe7H2VFiCpgykBSHw+cAwmixutKx5GZ9c6PLhkBRzuAAxmN+zuAAXIg7h9jRSEAJBMEIhL//4PYgwDX80CeGuasOXF7Th+8jR9OFKk+VblOEEHSKeLAV794074Ag0IhcboIIZhcPLUaTy3uQduXz1MVk8BwuoMYFlbB+2EhYtXoMLghL+uCY92PQmX737Uz2vG6GiQzqtltMIGVgTAptMUIN+fm17ogcvjx9hYmJ6Pj7ND57C8vQNVJiecnlqYrF6sfGQNzdrw8NeYv2gp7RSjxQuntxFLlq0GE4/TseO7jEQBIMHqAGKuP7f1/gGz7q3CiZOnigbmqzeRSGLNz36OSqMDNpcfgfoF6Ox6gl47/Y8zMDv8ere4arD+6Q1ANjvhPUMBhBwAk2ApAC9I9MK+9w7gzhmzsLV3exHA+MHxeAItre0wmF0w2320Td/auw9/+ewIfDXzaF1YnAG8/8FHU85B3kE6AKMDpHkRmSxw7vxFGOfYUFP3E4Ryy0D6u3SCoaHzsLnmwuLwweb004xUmVywe2rh8tbjgZYVCIcjtI6mBYgyCQrApgVwgkRflz/tWos7Z8zE85t7dABV38MJyPh4c9celFWaYXf5KQQ5enwNsDjmYv/7H9J7Ss0nAISjOkAyxVMIkoVjx0/BYLSgrMKAP+3bXzAkqX9mw/M48vlRek6e7rHHn0RZlZm2KBEB2dLTm2u7zATzCQChsA4QT3JIsDySKQFkq3j9jd2YdU8ZKipNeGXH64UiXfvEU5hx92z0vNRHJ+N5HsvbV6PKaIPV4YO/bj7ODA7Re0uLb1KAYJihALFEGkySoyApToSsZrH9lddQXmnE3TPvxdLWNry0tQ9tK1ejospMO2XVI53455mzuHjxEpa0tsNocdFNjID89ncbwXH8pFkoArgeYraRJ47E04jG04glOArCciIUDfj44CE0LWqm2bjrxzNRXmmCxeaGxebC7AojyirnYHHLMuw/8AGOHjuO/rfewWs7d+HgJ4cgitKkWSgC+DYY6yM/hWMpRJiUDkFB0oizPNQscD0YwZ/fPYBfPPVrtC5vx4PND+Gh1jaseWwd+l7egcGh83TS0tDUieZ5AFEU9S+ib4OxF0hthyIsxqJsMUhCz0iKlymIIGuIxBK4HgwjHGFo15Agb31SI0T5biGdU2pckoHfU4ArI8FmQQWCkSRVKMpiLDYRhCwLKdIUJ4ETFHCCjDQv0f2DIxIkupkJog6ifwHrn2rjzfM7ajKZXEgBDh8+fMdIKP6lqAKj4cREEGYiyI2O0Vs3xQlIczqIDiFBFGX6+UVAxm9kJCRJutDf36//LyAxPHy9Np4SRQJBjPMQwQibA0nlQPKFmgNhbwGEQEhy4S2oqiqfTCZ9BfN8fDl8tY5JiWd5GVCygEyU0UXOyXCSPNIx+pfe9w9ZVs/EYrEbf8smiduvjcYeCEUTz46EmO4rI+EiXRuNUo0QhaLdoyGmezTMdIdyCkcTVFEihojtTrDpbo4Tnsmt+Q/Gm30HtnYm0fWSPxUAAAAASUVORK5CYII=';
			var PP_A_RE = /🔄|🖥️|🎭|🐋|🪟|🙈|⚙️|📊|🔊|🎨/g;
			function ppGlyphSlot(g) {
				if (g === '🖥️' && PP_DSH_ICON_URI) {
					var ic = document.createElement('span');
					ic.className = 'dsh-whale-ico';
					var img = document.createElement('img');
					img.className = 'dsh-whale-ico-img';
					img.src = PP_DSH_ICON_URI;
					img.alt = '';
					ic.appendChild(img);
					var gh = document.createElement('span');
					gh.className = 'dsh-whale-ico-ghost';
					gh.textContent = g;
					ic.appendChild(gh);
					return ic;
				}
				return whInlineIcon(g);
			}
			function appendSeg(el, seg, q) {
				if (!q) { el.appendChild(document.createTextNode(seg)); return; }
				var lower = seg.toLowerCase(), ql = q.toLowerCase(), i2 = 0;
				for (;;) {
					var hitAt = lower.indexOf(ql, i2);
					if (hitAt < 0) { el.appendChild(document.createTextNode(seg.slice(i2))); break; }
					if (hitAt > i2) el.appendChild(document.createTextNode(seg.slice(i2, hitAt)));
					var mk = document.createElement('mark');
					mk.textContent = seg.substr(hitAt, q.length);
					el.appendChild(mk);
					i2 = hitAt + q.length;
				}
			}
			function ppBuildDesc(el, text, q) {
				el.textContent = '';
				var i = 0, m;
				PP_A_RE.lastIndex = 0;
				while ((m = PP_A_RE.exec(text))) {
					if (m.index > i) appendSeg(el, text.slice(i, m.index), q);
					el.appendChild(ppGlyphSlot(m[0]));
					i = m.index + m[0].length;
				}
				if (i < text.length) appendSeg(el, text.slice(i), q);
			}
			/* 通知矩阵左列语义圆片（D 类）：done/fail/ask 几何=周报 repDot 逐字节；warn=
			 * ask tint+健康条叹号 path 组合（生产无 repDot('warn')，评审走查 #14）。ghost
			 * 收编簇后空格（评审 P2-A）：textContent 逐字节、可见间隙恰 4px。 */
			var PP_MX_DOTS = [
				{ pre: '✅', kind: 'done' },
				{ pre: '❌', kind: 'fail' },
				{ pre: '❓🛡', kind: 'ask' },
				{ pre: '🌡', kind: 'warn' }
			];
			function ppMdot(kind) {
				var NS = 'http://www.w3.org/2000/svg';
				var svg = document.createElementNS(NS, 'svg');
				svg.setAttribute('viewBox', '0 0 12 12');
				svg.setAttribute('class', 'wh-mdot wh-mdot-' + kind);
				svg.setAttribute('aria-hidden', 'true');
				var add = function (n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); svg.appendChild(e); };
				/* P1-4 class 路线（0.4.3 阶段 C）：颜色挪注入 CSS（.wh-mdot-*
				 * 的 .wh-dot-tint/.wh-dot-mark/.wh-dot-pt 规则，与周报 repDot
				 * 同族同色），几何/透明度留 attribute（vm 桩 setAttribute 只存
				 * 字符串，var() 进不了 attribute，05b §2.4 第 2 条）。 */
				if (kind === 'done') {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M3.4 6.2 5.2 8l3.4-3.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
				} else if (kind === 'fail') {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M4.2 4.2l3.6 3.6M7.8 4.2 4.2 7.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
				} else if (kind === 'ask') {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M4.6 4.6a1.5 1.5 0 1 1 2 1.4c-.5.2-.6.5-.6 1v.2', 'class': 'wh-dot-mark', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
					add('circle', { cx: 6, cy: 9.1, r: 0.7, 'class': 'wh-dot-pt' });
				} else {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M6 2.9v3.6', 'class': 'wh-dot-mark', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
					add('circle', { cx: 6, cy: 9.1, r: 0.8, 'class': 'wh-dot-pt' });
				}
				return svg;
			}
			function ppBuildMxCell(el, text, q) {
				var hit = null;
				for (var i3 = 0; i3 < PP_MX_DOTS.length; i3++) {
					if (text.indexOf(PP_MX_DOTS[i3].pre) === 0) { hit = PP_MX_DOTS[i3]; break; }
				}
				if (!hit) { el.textContent = text; return; }
				el.textContent = '';
				el.appendChild(ppMdot(hit.kind));
				var gh2 = document.createElement('span');
				gh2.className = 'dsh-whale-ico-ghost';
				gh2.textContent = hit.pre + ' ';
				el.appendChild(gh2);
				appendSeg(el, text.slice(text.indexOf(' ') + 1), q);
			}
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
				var catHits = [];
				for (var s2 = 0; s2 < manualSecEls.length; s2++) secHits.push(0);
				for (var c2 = 0; c2 < manualCatEls.length; c2++) catHits.push(0);
				for (var i = 0; i < rows.length; i++) {
					var el = rows[i];
					/* section headers: visibility handled below（孤头隐藏） */
					if (el.className.indexOf('dsh-whale-manual-sec') === 0) continue;
					/* 分组小标题：不参与逐行命中/恢复，可见性由 catHits 统一裁决 */
					if (el.className.indexOf('dsh-whale-manual-cat') === 0) continue;
					if (!q) {
						el.classList.remove('dsh-whale-hide');
						el.classList.remove('dsh-whale-help-hit');
						if (el._mT) el._mT.textContent = el._mTerm;
						if (el._mD) ppBuildDesc(el._mD, el._mDesc);
						if (el._mG) el._mG.textContent = el._mTerm;
						/* 通知矩阵逐格恢复（11-13 视觉重构 _mCells 契约：格挂
						 * {el,text} 数组，与 _mT/_mD 同一恢复语义） */
						if (el._mCells) {
							for (var ci = 0; ci < el._mCells.length; ci++) ppBuildMxCell(el._mCells[ci].el, el._mCells[ci].text);
						}
						continue;
					}
					var hit = indexOfCI(el.textContent, q) >= 0;
					el.classList.toggle('dsh-whale-hide', !hit);
					el.classList.toggle('dsh-whale-help-hit', hit);
					if (hit) {
						n++;
						if (rowSection && rowSection[i] >= 0 && rowSection[i] < secHits.length) secHits[rowSection[i]]++;
						/* 行挂 _mCat（渲染循环赋组号）→ 命中计入所属组 */
						if (el._mCat !== undefined && el._mCat >= 0 && el._mCat < catHits.length) catHits[el._mCat]++;
						if (el._mG) {
							highlightAll(el._mG, el._mTerm, q);
							/* 11-13 编号行带说明行：说明同样参与命中高亮 */
							if (el._mD) ppBuildDesc(el._mD, el._mDesc, q);
						} else {
							if (el._mT) highlightAll(el._mT, el._mTerm, q);
							if (el._mD) ppBuildDesc(el._mD, el._mDesc, q);
						}
						/* 通知矩阵逐格命中高亮（mark 逻辑同一套 highlightAll） */
						if (el._mCells) {
							for (var cj = 0; cj < el._mCells.length; cj++) ppBuildMxCell(el._mCells[cj].el, el._mCells[cj].text, q);
						}
						if (!first) first = el;
					}
				}
				/* 搜索时隐藏零命中分区头（消孤头）；空查询全恢复 */
				for (var s3 = 0; s3 < manualSecEls.length; s3++) {
					manualSecEls[s3].el.classList.toggle('dsh-whale-hide', !!q && secHits[s3] === 0);
				}
				/* 分组小标题同款裁决：该组零命中隐藏（消孤组头）；空查询全恢复 */
				for (var c3 = 0; c3 < manualCatEls.length; c3++) {
					manualCatEls[c3].classList.toggle('dsh-whale-hide', !!q && catHits[c3] === 0);
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
				/* 11-14 卡片化重构：标题收进独立 span——分区头升级为 44px 卡片
				 * 头行（15px/600 主层级），右侧徽标/摘要 + ::after 圆形 chevron
				 * 由注入 CSS 排到行尾（CSS 旋转指示折叠态） */
				var ts = document.createElement('span');
				ts.className = 'dsh-whale-manual-sec-t';
				setIconLabel(ts, t);
				el.appendChild(ts);
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
					ppBuildDesc(d, desc);
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
					ppBuildDesc(d2, desc);
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
			/* 内嵌参考面板骨架（11-14，用户批「编号节奏之后突然一堆东西堆在
			 * 那里」）：末尾两块参考内容（通知矩阵/常用设置）外层保持卡片
			 * 片段（className 严格不变=测试/搜索契约，样式由注入块的 :has
			 * 定向），内层 dsh-whale-manual-panel 软底内嵌盒+图标圆片——
			 * 与编号条目刻意「另起一格」 */
			var beginRefPanel = function (term, icon) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-item';
				var panel = document.createElement('div');
				panel.className = 'dsh-whale-manual-panel';
				var h = document.createElement('div');
				h.className = 'dsh-whale-manual-panel-h';
				var ico = document.createElement('span');
				ico.className = 'dsh-whale-manual-panel-ico';
				ico.textContent = '';
							ico.appendChild(buildIconSvg(ICON_PATHS[icon]));
							var igh = document.createElement('span');
							igh.className = 'dsh-whale-ico-ghost';
							igh.textContent = icon;
							ico.appendChild(igh);
				var t = document.createElement('div');
				t.className = 'dsh-whale-manual-t';
				t.textContent = term;
				h.appendChild(ico);
				h.appendChild(t);
				panel.appendChild(h);
				el.appendChild(panel);
				el._mTerm = term;
				el._mT = t;
				return { el: el, panel: panel, t: t };
			};
			var notifyMatrix = function (term, pairs) {
				var built = beginRefPanel(term, '🔔');
				var grid = document.createElement('div');
				grid.className = 'dsh-whale-manual-matrix';
				var cells = [];
				pairs.forEach(function (p) {
					var st = document.createElement('span');
					st.className = 'dsh-whale-manual-mx-s';
					ppBuildMxCell(st, p[0]);
					var act = document.createElement('span');
					act.className = 'dsh-whale-manual-mx-a';
					act.textContent = p[1];
					grid.appendChild(st);
					grid.appendChild(act);
					cells.push({ el: st, text: p[0] });
					cells.push({ el: act, text: p[1] });
				});
				built.panel.appendChild(grid);
				built.el._mCells = cells;
				list.appendChild(built.el);
			};
			/* 常用设置在哪（同款内嵌面板，⚙️ 图标头）：两行说明 pre-line
			 * 渲染，_mDesc/_mD 契约与普通条目同构 */
			var refPanel = function (term, desc) {
				var built = beginRefPanel(term, '⚙️');
				if (desc) {
					var d = document.createElement('div');
					d.className = 'dsh-whale-manual-d';
					ppBuildDesc(d, desc);
					built.panel.appendChild(d);
					built.el._mDesc = desc;
					built.el._mD = d;
				}
				list.appendChild(built.el);
			};
			/* 分组小标题行（11-14 用户批「19 条一排一排不知道从哪看起」）：更多
			 * 细节区按 5 组重排，每组第一条带 cat 字段——渲染层在 detail 条目
			 * 前插一行组头。cat 行是 list 直接子元素但不带 dsh-whale-manual-detail
			 * 类（detail 恰 19 条的测试契约不破），并挂进 manualCatEls 供搜索
			 * 「组内零命中隐藏（消孤组头）、无查询恢复」的可见性裁决 */
			var catRow = function (label) {
				var el = document.createElement('div');
				el.className = 'dsh-whale-manual-cat';
				setIconLabel(el, label);
				list.appendChild(el);
				manualCatEls.push(el);
				el._mCat = manualCatEls.length - 1;
			};
			var manualCatEls = [];
			/* 内容渲染=遍历 PP_MANUAL_DATA（11-13 抽取）：行仍是 list 直接
			 * 子元素，rowSection 分区索引与搜索 children 遍历契约不破。
			 * 11-13 视觉重构：机制内幕区条目走 detail 紧凑行；「通知响了=
			 * 该做什么」按标题识别转译成通知矩阵卡片（数据未动）。
			 * 11-14 分组：catRow 先于组内首条插入组头；curCat 记当前组号，
			 * 渲出的行挂 _mCat 供搜索组计数（-1=不属任何组，前置三区与组内
			 * 命中计数互不干扰） */
			PP_MANUAL_DATA.forEach(function (S) {
				sec(S.sec, S.badge, S.hint);
				var detail = S.sec.indexOf('更多细节') >= 0;
				var curCat = -1;
				S.items.forEach(function (it) {
					if (it.cat) { catRow(it.cat); curCat = manualCatEls.length - 1; }
					if (it.g) gesture(it.g, it.t, it.d);
					else if (it.t === '通知响了 = 该做什么') notifyMatrix(it.t, NOTIFY_DO_MATRIX);
					else if (it.t === '常用设置在哪') refPanel(it.t, it.d);
					else item(it.t, it.d, detail);
					if (curCat >= 0 && list.children.length) list.children[list.children.length - 1]._mCat = curCat;
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
			/* P1-2（UI 审美 v5 落地）：周报语义圆片——12×12 tint 底 + 语义色符
			 * （done 绿勾 / fail 红 X / killed 灰方 / ask 琥珀问号，mockup-04
			 * 批准画法）。emoji 原文由调用方放进 0 尺寸 ghost——textContent
			 * 口径（'✅2 ❌1'、断言 includes('❓')）逐字不变 */
			var REP_NS = 'http://www.w3.org/2000/svg';
			function repDot(kind) {
				var svg = document.createElementNS(REP_NS, 'svg');
				svg.setAttribute('viewBox', '0 0 12 12');
				svg.setAttribute('class', 'wh-rdot wh-rdot-' + kind);
				svg.setAttribute('aria-hidden', 'true');
				var add = function (name, attrs) {
					var el = document.createElementNS(REP_NS, name);
					for (var k in attrs) el.setAttribute(k, attrs[k]);
					svg.appendChild(el);
				};
				/* P1-4 class 路线（0.4.3 阶段 C）：颜色挪注入 CSS（.wh-rdot-* 的
				 * .wh-dot-tint/.wh-dot-mark/.wh-dot-pt 规则，token=--wh-ok/
				 * --wh-danger/--wh-warn/--wh-neutral/三个 strong 变体），几何/
				 * 透明度留 attribute（vm 桩 setAttribute 只存字符串，var() 进
				 * 不了 attribute，05b §2.4 第 2 条）。 */
				if (kind === 'done') {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M3.4 6.2 5.2 8l3.4-3.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
				} else if (kind === 'fail') {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M4.2 4.2l3.6 3.6M7.8 4.2 4.2 7.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
				} else if (kind === 'killed') {
					add('rect', { x: 1, y: 1, width: 10, height: 10, rx: 2.5, 'class': 'wh-dot-tint', 'fill-opacity': '.4' });
				} else {
					add('circle', { cx: 6, cy: 6, r: 6, 'class': 'wh-dot-tint', 'fill-opacity': '.18' });
					add('path', { d: 'M4.6 4.6a1.5 1.5 0 1 1 2 1.4c-.5.2-.6.5-.6 1v.2', 'class': 'wh-dot-mark', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
					add('circle', { cx: 6, cy: 9.1, r: 0.7, 'class': 'wh-dot-pt' });
				}
				return svg;
			}
			function repCount(host, kind, glyph, n) {
				host.appendChild(repDot(kind));
				var gh = document.createElement('span');
				gh.className = 'dsh-whale-ico-ghost';
				gh.textContent = glyph;
				host.appendChild(gh);
				var num = document.createElement('span');
				num.className = 'wh-rnum';
				num.textContent = String(n);
				host.appendChild(num);
			}
			/* P1-2：token 量级统一——≥1M 一位小数 M 制（7536.1K→7.5M、
			 * 1368.0K→1.4M，mockup-04 批准）；K 段口径不变。
			 * 0.4.3 阶段 B：从 build() 局部上移到 Tab 装配层——昨夜摘要卡
			 * （ppBuildNightSummaryCard）也要用它，原 build 局部定义会让摘要
			 * 卡首次装配 ReferenceError（冒烟台架实锤）。 */
			var fmtK = function (n) {
				if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
				return n >= 10000 ? (n / 1000).toFixed(1) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n;
			};
			function build() {
			list.textContent = ''; /* 重渲前清空——pullCloudHistory 回调二次 build 不叠加（11-11 用户实报双份） */
			headWrap.textContent = ''; /* Tab 头行（📊 周报 + 只看失败 chip）随 build 重建，不叠加 */
			ledgerWrap.textContent = ''; /* 陪伴小账区随 build 重建（数据到位后由回调重渲点亮） */
			var weekAgo = Date.now() - 7 * 864e5;
			var days = {};
			var hasAny = false;
			var weekFails = 0; /* 0.4.3 阶段 B：窗口内失败数——筛选 chip 文案与显隐 */
			for (var i = 0; i < history.length; i++) {
				var rec = history[i];
				var at = rec.at || 0;
				if (at < weekAgo) continue;
				hasAny = true;
				if (rec.kind === 'fail') weekFails++;
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
			/* P1-2：计数 emoji → 语义圆片+等宽数字（ghost 保 textContent 口径）。
			 * 0.4.3 阶段 B（mock-b 批准面）：完成/失败升级为 mock-bignum 大数字
			 * （20px/semibold/tabular-nums，失败 #f87171）；⏹/❓ 次级桶保留
			 * repCount 紧跟失败大数字之后（ghost 保 textContent 口径——既有
			 * 断言/读屏契约逐字不变，主视觉照 mockup） */
			sumRow.textContent = '';
			sumRow.appendChild(document.createTextNode('今日 ' + todayKey + ' · '));
			var bnDone = document.createElement('span');
			bnDone.className = 'mock-bignum';
			bnDone.textContent = String(tb ? tb.done : 0);
			sumRow.appendChild(bnDone);
			sumRow.appendChild(document.createTextNode(' 完成 '));
			var bnFail = document.createElement('span');
			bnFail.className = 'mock-bignum';
			bnFail.style.color = '#f87171';
			bnFail.textContent = String(tb ? tb.fail : 0);
			sumRow.appendChild(bnFail);
			sumRow.appendChild(document.createTextNode(' 失败 '));
			repCount(sumRow, 'killed', '⏹', tb ? tb.killed : 0);
			sumRow.appendChild(document.createTextNode(' '));
			repCount(sumRow, 'ask', '❓', tb ? tb.ask : 0);
			sumRow.appendChild(document.createTextNode(' · '));
			var sumTok = document.createElement('span');
			sumTok.className = 'wh-rnum';
			sumTok.textContent = fmtK(tb ? tb.tokens : 0) + ' tok · ' + (tb ? Object.keys(tb.sessions).length : 0) + ' 个对话';
			sumRow.appendChild(sumTok);
			list.appendChild(sumRow);
			/* 0.4.3 阶段 B：Tab 头行（📊 周报 sec + 只看失败 chip，mock-b 批准面）
			 * 与陪伴小账区——都挂在卡片外、随 build 重建；空周也要出（chip 由
			 * weekFails 0 隐藏，小账由数据防御式渲染）。 */
			ppBuildHeadRow(headWrap, weekFails);
			ppRenderLedgerBlock(ledgerWrap);
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
				/* 只看失败（0.4.3 阶段 B 筛选 chip）：筛选态下无失败记录的日子整行跳过 */
				if (ppRepFailOnly && (!db || !(db.fail > 0))) continue;
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
				/* P1-2：非零桶逐个渲染语义圆片+等宽数字（ghost 保口径，空格分隔
				 * 与原 parts.join(' ') 一致）。0.4.3 阶段 B（mock-b 批准面）：
				 * 展开日不渲染右侧计数——明细行就在下面，收起日才靠头行计数 */
				right.textContent = '';
				if (!open) {
				var firstCount = true;
				var pushCount = function (kind, glyph, n) {
					if (!firstCount) right.appendChild(document.createTextNode(' '));
					firstCount = false;
					repCount(right, kind, glyph, n);
				};
				if (db.done) pushCount('done', '✅', db.done);
				if (db.fail) pushCount('fail', '❌', db.fail);
				if (db.killed) pushCount('killed', '⏹', db.killed);
				if (db.ask) pushCount('ask', '❓', db.ask);
				if (db.tokens) {
					right.appendChild(document.createTextNode(' · '));
					var tokEl = document.createElement('span');
					tokEl.className = 'wh-rnum';
					tokEl.textContent = fmtK(db.tokens) + ' tok';
					right.appendChild(tokEl);
				}
				} /* !open：展开日右侧留白（明细就在下方） */
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
					/* 只看失败（0.4.3 阶段 B 筛选 chip）：筛选态只保留失败/截断会话行 */
					if (ppRepFailOnly && !g2.hasBad) return;
					/* 失败任务行（mock-b 批准 mock-taskrow）：左红条+tint 底+fail
					 * 圆片+标题+右侧灰字「失败 · HH:MM」。数据契约无重试字段，
					 * 「已重试 N 次」段缺数据省略（诚实降级）；跳转链与下方 srow
					 * 完全同链（跳回对话是既有能力，不因改版丢失）。 */
					if (g2.hasBad) {
						var trow = document.createElement('div');
						trow.className = 'mock-taskrow mock-taskrow-fail';
						trow.appendChild(repDot('fail'));
						var tgh = document.createElement('span');
						tgh.className = 'dsh-whale-ico-ghost';
						tgh.textContent = '❌ ';
						trow.appendChild(tgh);
						var ttitle = g2.title || g2.rawTitle || '（未命名）';
						trow.appendChild(document.createTextNode(ttitle));
						var tad2 = new Date(g2.anchor || 0);
						var tmeta = document.createElement('span');
						tmeta.className = 'mut';
						tmeta.textContent = '失败 · ' + (tad2.getHours() < 10 ? '0' : '') + tad2.getHours() + ':' + (tad2.getMinutes() < 10 ? '0' : '') + tad2.getMinutes();
						trow.appendChild(tmeta);
						trow.addEventListener('click', (function (sid3, anchor3, t3) {
							return function (event) {
								event.stopPropagation();
								if (openSessionAt(sid3, anchor3) || openViaSidebarById(sid3) || openViaSidebarByTitle(t3)) {
									uiSay('正在跳转到该对话… 🐳', 1500, sid3);
									return;
								}
								uiSay('跳转失败：右键菜单 🔄 刷新页面后重试（浏览器可按 Ctrl+F5）🥲', 3000, sid3);
							};
						})(sid, g2.anchor, ttitle));
						list.appendChild(trow);
						return;
					}
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
					stok.textContent = fmtK(g2.tokens) + ' tok';
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
			/* 报告卡片化（用户反馈「这是搞的啥」：旧列表裸奔在页面背景上）。
			 * 0.4.3 阶段 B（mock-b 批准面）Tab 结构：
			 *   [昨夜摘要卡?] → [📊 周报 头行+只看失败 chip] → [报告卡] → [陪伴小账?]
			 * 摘要卡闸内一次性装配（重进 Tab 由 lastSummary.card 位兜住，不重出）；
			 * 头行/小账挂独立 wrap 随 build() 重建。 */
			var card = document.createElement('div');
			card.className = 'dsh-whale-pp-report';
			card.appendChild(list);
			var headWrap = document.createElement('div');
			var ledgerWrap = document.createElement('div');
			var summaryCard = ppBuildNightSummaryCard(card);
			if (summaryCard) content.appendChild(summaryCard);
			content.appendChild(headWrap);
			content.appendChild(card);
			content.appendChild(ledgerWrap);
			build();
			/* warm: merge records saved by other windows（vm/离线静默降级）——
			 * 合并完成后重渲一次，首开即见其他窗口保存的记录 */
			try { pullCloudHistory(function () { build(); }); } catch (e) { /* offline */ }
			/* 陪伴小账数据：/state 顶层 petLedger（宿主侧实现的只读载者）。缺键/
			 * days 空 → ppRenderLedgerBlock 整块不渲染（防御式：不报错不占位）；
			 * 数据到位后 build 重渲点亮（build 开头清空，不叠加）。 */
			try {
				fetch('/api/whale-assistant/state').then(function (r) {
					return r.ok ? r.json() : null;
				}).then(function (j) {
					if (j && j.petLedger && Array.isArray(j.petLedger.days) && j.petLedger.days.length) {
						ppPetLedger = j.petLedger;
					}
					build();
				}).catch(function () { /* 离线：静默 */ });
			} catch (eLedger) { /* 桩环境无 fetch：静默 */ }
			/* Tab 头行（mock-b 批准面）：📊 周报 sec（margin 归零进 flex 行）+
			 * 右侧「只看失败 N」ghost chip（同音色行 chip 族）。失败数 0 → chip
			 * 不渲染；点击切换全部/只看失败（激活态=panel-active 底），重建整列表 */
			function ppBuildHeadRow(host, fails) {
				host.textContent = '';
				var head = document.createElement('div');
				head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:14px 0 8px';
				var h1 = document.createElement('div');
				h1.className = 'dsh-whale-pp-sec';
				h1.style.margin = '0';
				setIconLabel(h1, '📊 周报');
				head.appendChild(h1);
				if (fails > 0) {
					var chip = document.createElement('span');
					chip.className = 'dsh-whale-pp-val dsh-whale-pp-chip';
					chip.textContent = '只看失败 ' + fails;
					if (ppRepFailOnly) chip.style.background = 'var(--wh-panel-active)';
					chip.addEventListener('click', function (event) {
						event.stopPropagation();
						ppRepFailOnly = !ppRepFailOnly;
						build();
					});
					head.appendChild(chip);
				}
				host.appendChild(head);
			}
			/* 昨夜摘要卡（mock-b 批准面）：闸（离席 ≥1h + 窗口事件 ≥3 条）满足且
			 * 当日 card 位空闲才渲染并记账（ppWriteSummaryRec card:true）；
			 * 「查看今日小结 ›」锚到下方报告卡（scrollIntoView，vm 桩无此方法兜空）。 */
			function ppBuildNightSummaryCard(reportCardEl) {
				var rec0 = ppReadSummaryRec();
				if (!ppSummarySlotFree(rec0, 'card', todayKey())) return null;
				var win = ppNightSummaryWindow(Date.now());
				if (!win) return null;
				ppWriteSummaryRec({ card: true, from: win.from, to: win.to, events: win.events.length });
				var agg = ppAggregateWindow(win.events);
				var cardEl = document.createElement('div');
				cardEl.className = 'dsh-whale-pp-report';
				var t = document.createElement('div');
				t.className = 'mock-sum-title';
				var tl = document.createElement('span');
				setIconLabel(tl, '🐋 昨夜摘要');
				var tr = document.createElement('span');
				tr.className = 'mock-sum-sub';
				tr.textContent = ppFmtClock(win.from) + ' – ' + ppFmtClock(win.to) + ' · 离席 ' + ppFmtAway(win.away);
				t.appendChild(tl);
				t.appendChild(tr);
				cardEl.appendChild(t);
				var line = document.createElement('div');
				line.className = 'mock-sum-line';
				repCount(line, 'done', '✅', agg.done);
				line.appendChild(document.createTextNode(' 完成 · '));
				repCount(line, 'fail', '❌', agg.fail);
				line.appendChild(document.createTextNode(' 失败 · '));
				repCount(line, 'ask', '❓', agg.ask);
				line.appendChild(document.createTextNode(' 待审核 · '));
				var tk = document.createElement('span');
				tk.className = 'wh-rnum';
				tk.textContent = fmtK(agg.tok) + ' tok';
				line.appendChild(tk);
				cardEl.appendChild(line);
				var note = document.createElement('div');
				note.className = 'mock-sum-note';
				note.textContent = agg.sessions + ' 个对话有新产出' + (agg.longestMs > 0 ? ' · 最长任务 ' + ppFmtAway(agg.longestMs) + '（' + agg.longestTitle + '）' : '');
				cardEl.appendChild(note);
				var link = document.createElement('div');
				link.className = 'mock-sum-link';
				link.textContent = '查看今日小结 ›';
				link.addEventListener('click', function (event) {
					event.stopPropagation();
					try { reportCardEl.scrollIntoView({ block: 'start' }); } catch (eScroll) { /* vm 桩无此方法 */ }
				});
				cardEl.appendChild(link);
				return cardEl;
			}
		}
		/* ———— 0.4.3 阶段 B UI 半区（mock-a/mock-b 批准面）————
		 * 挂载面 + 纯逻辑核心区 + 开机胶水。渲染契约：DOM 装配全部构建期
		 * 组合（ppBuildDesc/ppBuildMxCell 同款），emoji→图标走 setIconLabel/
		 * whInlineIcon ghost 口径（textContent 逐字节），不做后置 walker。 */
		window.__dshWhalePanel = { mount: mountWhalePanelPage };
		/* —— PP-SUMMARY-CORE-START（纯逻辑测试缝：本区只依赖区内常量/函数与
		 * 既有关闭缝 history/petDormant/dndActive/uiSay/safeGet/safeSet/
		 * todayKey/PET_MODE——test-whale 追加块整段摘出注入桩做行为断言；
		 * DOM 装配一律在 mountWhaleReportTab/renderSettings 局部完成）—— */
		var PP_ACT_KEY = 'dsh-whale:lastActivityAt';
		var PP_SUMMARY_KEY = 'dsh-whale:lastSummary';
		var PP_SUMMARY_AWAY_MS = 60 * 60 * 1000; /* 闸①：离席 ≥1h */
		var PP_SUMMARY_MIN_EVENTS = 3; /* 闸②：离席期间任务事件 ≥3 条 */
		var PP_HB_AWAY_MS = 15 * 60 * 1000; /* 心跳行：挂机 ≥15 分钟才出现 */
		var PP_HB_TICK_MS = 30 * 1000; /* 心跳行：面板打开期间 30s 自刷新 */
		/* 事件活动刷新：收到会话/任务事件打点。panel-page 自己不消费事件——
		 * 全部事件都汇经 sleep.js touchActivity（turn/start、turn/end、attention、
		 * projection…），开机胶水处对它做运行时包装落盘（见文件尾）。 */
		function ppTouchActivityAt(now) {
			if (PET_MODE) return false; /* 桌宠页不落页鲸键 */
			try { safeSet(PP_ACT_KEY, typeof now === 'number' ? now : Date.now()); } catch (e) { return false; }
			return true;
		}
		function ppReadLastActivity() {
			var v = null;
			try { v = safeGet(PP_ACT_KEY); } catch (e) { v = null; }
			return typeof v === 'number' && v > 0 ? v : 0;
		}
		function ppReadSummaryRec() {
			var v = null;
			try { v = safeGet(PP_SUMMARY_KEY); } catch (e) { v = null; }
			return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
		}
		/* 闸③④（每日 ≤1 / 当日已出不再出、重进 Tab 不重出）：双表面各占一位
		 * （card=Tab 卡 / bubble=开机气泡，帽互不挤占——气泡点了「点开看周报」
		 * 落地就要看到卡）。记录=一行 JSON：{date,card,bubble,from,to,events} */
		function ppSummarySlotFree(rec, which, today) {
			return !(rec && rec.date === today && rec[which] === true);
		}
		function ppWriteSummaryRec(patch) {
			var rec = ppReadSummaryRec() || {};
			if (patch) for (var k in patch) rec[k] = patch[k];
			rec.date = todayKey();
			try { safeSet(PP_SUMMARY_KEY, rec); } catch (e) {}
			return rec;
		}
		/* 离席窗口判定（闸①②）：lastActivityAt 距今 ≥1h 且窗口 [last, now] 内
		 * 任务事件 ≥3 条。数据源=history——cap 已对齐服务端 500 口径，离席期间
		 * 的记录由 pullCloudHistory 合并补齐（开机胶水在 pull 回调里判闸）。 */
		function ppNightSummaryWindow(now) {
			var last = ppReadLastActivity();
			if (!last) return null;
			var away = now - last;
			if (away < PP_SUMMARY_AWAY_MS) return null;
			var evs = [];
			for (var i = 0; i < history.length; i++) {
				var at = (history[i] && history[i].at) || 0;
				if (at >= last && at <= now) evs.push(history[i]);
			}
			if (evs.length < PP_SUMMARY_MIN_EVENTS) return null;
			return { from: last, to: now, away: away, events: evs };
		}
		/* 窗口聚合：N 完成 · M 失败 · K 待审核 · tok · 对话数 · 最长任务
		 * （最长任务=窗口内单会话首末记录跨度，取最长者；标题取最新非「未命名」） */
		function ppAggregateWindow(events) {
			var agg = { done: 0, fail: 0, ask: 0, tok: 0, sessions: 0, longestMs: 0, longestTitle: '' };
			var seen = {};
			var minAt = {};
			var maxAt = {};
			var title = {};
			for (var i = 0; i < events.length; i++) {
				var rec = events[i] || {};
				var sid = rec.sessionId || '';
				var at = rec.at || 0;
				if (rec.kind === 'done') agg.done++;
				else if (rec.kind === 'fail') agg.fail++;
				else if (rec.kind === 'question' || rec.kind === 'approval') agg.ask++;
				if (rec.turnTokens) agg.tok += rec.turnTokens;
				if (!seen[sid]) { seen[sid] = 1; agg.sessions++; }
				if (minAt[sid] === undefined || at < minAt[sid]) minAt[sid] = at;
				var end = rec.endTime || at;
				if (maxAt[sid] === undefined || end > maxAt[sid]) maxAt[sid] = end;
				if (!title[sid] && rec.title && rec.title !== '未命名任务') title[sid] = rec.title;
			}
			for (var sid2 in seen) {
				var span = (maxAt[sid2] || 0) - (minAt[sid2] || 0);
				if (span > agg.longestMs) {
					agg.longestMs = span;
					agg.longestTitle = title[sid2] || '未命名任务';
				}
			}
			return agg;
		}
		function ppFmtClock(ms) {
			var d = new Date(ms);
			return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
		}
		function ppFmtAway(ms) {
			if (ms >= 3600000) return (ms / 3600000).toFixed(1).replace(/\.0$/, '') + ' 小时';
			return Math.floor(ms / 60000) + ' 分钟';
		}
		/* 开机摘要气泡（闸③：bubble 位每日 ≤1）：文案照 mockup 逐字。petDormant
		 * （桌面鲸在岗）/免打扰时静默让路且不消费当日帽——卡位独立留给周报 Tab。 */
		function ppBootNightSummary(now) {
			if (PET_MODE) return false;
			if (petDormant) return false;
			try { if (dndActive()) return false; } catch (eDnd) { /* 桩环境无此缝 */ }
			var n = typeof now === 'number' ? now : Date.now();
			if (!ppSummarySlotFree(ppReadSummaryRec(), 'bubble', todayKey())) return false;
			var win = ppNightSummaryWindow(n);
			if (!win) return false;
			var agg = ppAggregateWindow(win.events);
			uiSay('🐋 昨晚 ' + agg.done + ' 完成 · ' + agg.fail + ' 失败 · ' + agg.ask + ' 条待你审核 — 点开看周报', 8000);
			ppWriteSummaryRec({ bubble: true, from: win.from, to: win.to, events: win.events.length });
			return true;
		}
		/* 陪伴小账纯计算（mock-b 批准面）：/state.petLedger={days:[{date,pets,wakes}]}
		 * 90 天滚动。本周=最近 7 个本地日历日，上周=其前 7 天；上周合计 0 →
		 * 百分比不出（pct=null）。bars 值缩放 6-16px、最高日 .on（渲染局部做）。 */
		function ppLedgerCalc(days, now) {
			if (!Array.isArray(days) || !days.length) return null;
			var map = {};
			for (var i = 0; i < days.length; i++) {
				var d = days[i];
				if (d && typeof d.date === 'string') map[d.date] = { pets: d.pets || 0, wakes: d.wakes || 0 };
			}
			var base = new Date(now);
			var day0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
			var vals = [];
			var labels = [];
			var week = 0;
			var prev = 0;
			var pets = 0;
			var wakes = 0;
			function dayKey(dt) {
				var m = dt.getMonth() + 1;
				var dd = dt.getDate();
				return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
			}
			for (var k = 6; k >= 0; k--) {
				var dt = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() - k);
				var v = map[dayKey(dt)] || { pets: 0, wakes: 0 };
				vals.push((v.pets || 0) + (v.wakes || 0));
				labels.push('日一二三四五六'.charAt(dt.getDay()));
				week += vals[vals.length - 1];
				pets += v.pets || 0;
				wakes += v.wakes || 0;
			}
			for (var k2 = 13; k2 >= 7; k2--) {
				var dt2 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() - k2);
				var v2 = map[dayKey(dt2)] || { pets: 0, wakes: 0 };
				prev += (v2.pets || 0) + (v2.wakes || 0);
			}
			var max = 0;
			var maxIdx = -1;
			for (var m = 0; m < vals.length; m++) {
				if (vals[m] > max) { max = vals[m]; maxIdx = m; }
			}
			return {
				vals: vals,
				labels: labels,
				maxIdx: max > 0 ? maxIdx : -1,
				week: week,
				prev: prev,
				pets: pets,
				wakes: wakes,
				pct: prev > 0 ? Math.round((week - prev) / prev * 100) : null
			};
		}
		/* —— PP-SUMMARY-CORE-END —— */
		/* 挂机心跳行渲染（mock-a 批准面，renderSettings 局部调用 + 30s 自刷新）：
		 * 显示条件=距 lastActivityAt ≥15 分钟 且 runSlots.size>0（status-panel
		 * 运行态投影，同 IIFE 直读）；异常才换简述——stuckActive（工具卡住）//
		 * recentFailAt ≥ 挂机起点（挂机期间有失败），圆片 ok→warn；文案含批准
		 * 的固定后缀。 */
		function ppHeartDot(kind) {
			var NS = 'http://www.w3.org/2000/svg';
			var wrap = document.createElement('span');
			wrap.className = 'wh-hdot wh-hdot-' + kind;
			var svg = document.createElementNS(NS, 'svg');
			svg.setAttribute('viewBox', '0 0 12 12');
			svg.setAttribute('aria-hidden', 'true');
			var add = function (name, attrs) {
				var el = document.createElementNS(NS, name);
				for (var k in attrs) el.setAttribute(k, attrs[k]);
				svg.appendChild(el);
			};
			/* P1-4 class 路线（0.4.3 阶段 C）：同 whHealthDot——颜色挪注入 CSS，
			 * 几何留 attribute（vm 桩 setAttribute 只存字符串）。 */
			if (kind === 'ok') {
				add('path', { d: 'M2.8 6.4 5 8.6l4.2-5', 'class': 'wh-dot-mark', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
			} else if (kind === 'fail') {
				add('path', { d: 'M4.2 4.2l3.6 3.6M7.8 4.2 4.2 7.8', 'class': 'wh-dot-mark', 'stroke-width': 1.6, 'stroke-linecap': 'round' });
			} else {
				add('path', { d: 'M6 2.9v3.6', 'class': 'wh-dot-mark', 'stroke-width': 1.5, 'stroke-linecap': 'round' });
				add('circle', { cx: 6, cy: 9.1, r: 0.8, 'class': 'wh-dot-pt' });
			}
			wrap.appendChild(svg);
			return wrap;
		}
		function ppRenderHeartbeat(row) {
			var last = ppReadLastActivity();
			var running = 0;
			try { running = (typeof runSlots !== 'undefined' && runSlots && runSlots.size) || 0; } catch (eRun) { running = 0; }
			var away = last ? Date.now() - last : 0;
			if (!last || away < PP_HB_AWAY_MS || !(running > 0)) {
				row.textContent = '';
				try { row.style.display = 'none'; } catch (eH0) {}
				return;
			}
			try { row.style.display = ''; } catch (eH1) {}
			var stuck = false;
			try { stuck = (typeof stuckActive !== 'undefined') && stuckActive === true; } catch (eH2) {}
			var failAt = recentFailAt();
			var abnormal = stuck || (typeof failAt === 'number' && failAt >= last);
			var awayTxt = ppFmtAway(away);
			var stateTxt = abnormal ? (stuck ? '有工具卡住' : '有任务失败') : '无异常';
			row.textContent = '';
			row.appendChild(ppHeartDot(abnormal ? 'warn' : 'ok'));
			row.appendChild(document.createTextNode(' 已挂机 ' + awayTxt + ' · ' + running + ' 个任务仍在运行 · ' + stateTxt + '（每 15 分钟自动更新；异常才升级为气泡）'));
		}
		/* 陪伴小账区块渲染（mock-b 批准面，mountWhaleReportTab 的 build 局部调用）：
		 * 数据缺失（键缺/days 空）→ 整块不渲染，不报错不占位。sec 图标 🤝 无
		 * 字形 → setIconLabel emoji 回落（与全站一致）。 */
		function ppRenderLedgerBlock(host) {
			host.textContent = '';
			var calc = ppLedgerCalc(ppPetLedger ? ppPetLedger.days : null, Date.now());
			if (!calc) return;
			var sec = document.createElement('div');
			sec.className = 'dsh-whale-pp-sec';
			setIconLabel(sec, '🤝 陪伴小账');
			host.appendChild(sec);
			var acc = document.createElement('div');
			acc.style.cssText = 'font-size:12.5px';
			acc.appendChild(document.createTextNode('本周互动 '));
			var an = document.createElement('span');
			an.className = 'mock-bignum';
			an.style.fontSize = '16px';
			an.textContent = String(calc.week);
			acc.appendChild(an);
			acc.appendChild(document.createTextNode(' 次（摸头 ' + calc.pets + ' · 唤起 ' + calc.wakes + '）'));
			if (calc.pct !== null) {
				acc.appendChild(document.createTextNode(' · 较上周 '));
				var up = document.createElement('span');
				up.style.color = calc.pct >= 0 ? '#4ade80' : '#f87171';
				up.textContent = (calc.pct >= 0 ? '+' : '') + calc.pct + '%';
				acc.appendChild(up);
			}
			host.appendChild(acc);
			var bars = document.createElement('div');
			bars.className = 'mock-bars';
			var maxVal = calc.maxIdx >= 0 ? calc.vals[calc.maxIdx] : 1;
			for (var bi = 0; bi < calc.vals.length; bi++) {
				var b = document.createElement('i');
				var h = 6 + Math.round((calc.vals[bi] / maxVal) * 10);
				if (h < 6) h = 6;
				if (h > 16) h = 16;
				b.style.height = h + 'px';
				if (bi === calc.maxIdx) b.className = 'on';
				bars.appendChild(b);
			}
			host.appendChild(bars);
			var daysRow = document.createElement('div');
			daysRow.className = 'mock-days';
			calc.labels.forEach(function (c) {
				var s = document.createElement('span');
				s.textContent = c;
				daysRow.appendChild(s);
			});
			host.appendChild(daysRow);
			var note3 = document.createElement('div');
			note3.className = 'mock-sum-note';
			note3.textContent = '数据只在报里看，不弹气泡不打扰（触发记录静默落账）';
			host.appendChild(note3);
		}
		/* —— 开机胶水（uiInit 内执行：bubble/touchActivity 同闭包）—— */
		/* 事件活动落盘：frames/server-events 的所有会话/任务事件都汇经
		 * sleep.js touchActivity——运行时包一层把时间戳写进 localStorage
		 * （页鲸 origin 稳定，跨开关机可靠）。不改任何其他文件；幂等
		 * （重复 uiInit 不双层包）；回放批 60s 外的帧本来就丢弃，离席
		 * 窗口不会被开机回放清零。 */
		try {
			if (!PET_MODE && typeof touchActivity === 'function' && !(window.__dshWhale && window.__dshWhale._ppTouchWrapped)) {
				var __ppOrigTouch = touchActivity;
				if (window.__dshWhale) window.__dshWhale._ppTouchWrapped = true;
				touchActivity = function (silentWake) {
					ppTouchActivityAt(Date.now());
					return __ppOrigTouch(silentWake);
				};
			}
		} catch (eWrap) { /* 桩环境兜底 */ }
		/* 摘要气泡点击 → 打开侧栏页 + 直切周报 Tab（menu.js 设置行同款
		 * __dshWhaleSelectPanel 桥；桥缺席回落 uiSay 指路）。只接管当前显示中
		 * 的摘要气泡（文本前缀守卫），普通通知气泡零波及。 */
		try {
			bubble.addEventListener('click', function (event) {
				if (!uiSay.visible) return;
				var txt = String((event && event.currentTarget && event.currentTarget.textContent) || bubble.textContent || '');
				if (txt.indexOf('🐋 昨晚 ') !== 0) return;
				try { event.stopPropagation(); } catch (eS0) {}
				if (typeof window.__dshWhaleSelectPanel === 'function') {
					try { window.__dshWhaleSelectPanel('whale-assistant'); } catch (eSel) {}
				} else {
					uiSay('周报在 DSH 左侧栏「小鲸鱼助手」页 🐳', 3000);
					return;
				}
				ppPendingReportTab = true;
				try {
					if (window.__dshWhalePanel && typeof window.__dshWhalePanel.openTab === 'function') {
						window.__dshWhalePanel.openTab('report');
					}
				} catch (eTab) {}
			});
		} catch (eBub) { /* 桩环境兜底 */ }
		/* P1-5 三件套·Esc 关浮层（0.4.3 阶段 C）：Escape 单点接 closeCtxFloats
		 * （menu.js 已是收口单点）——06 裁决的 S 级三件套之三（搜索框焦点恢复
		 * 与 :focus-visible 环在 style.css）。keydown 包 try/catch 适配 vm 桩
		 * （bootstrap.js:94 先例）。 */
		try {
			window.addEventListener('keydown', function (ev) {
				if (!ev || ev.key !== 'Escape') return;
				closeCtxFloats();
			});
		} catch (eEsc) { /* 桩环境无 window 注册表 */ }
		/* 桌宠菜单「📊 周报」帧消费端（0.4.3 阶段 C，与 client.js 的
		 * pet-open-settings 监听同款分工——core 派发事件，页侧执行）：
		 * selectPanel + openTab('report')，ppPendingReportTab 意向位补齐
		 * 异步 mount 时序缝（摘要气泡点击同款）。监听包 try/catch 适配 vm 桩。 */
		try {
			window.addEventListener('dsh-whale:pet-open-report', function () {
				try {
					if (typeof window.__dshWhaleSelectPanel === 'function') {
						window.__dshWhaleSelectPanel('whale-assistant');
					}
				} catch (eSel2) { }
				ppPendingReportTab = true;
				try {
					if (window.__dshWhalePanel && typeof window.__dshWhalePanel.openTab === 'function') {
						window.__dshWhalePanel.openTab('report');
					}
				} catch (eTab2) { }
			});
		} catch (eRepL) { /* 桩环境兜底 */ }
		/* 开机检测（闸判定放在 pullCloudHistory 回调里——离席期间的事件在服务端
		 * 账本，本地缓存没有；pull 失败也回调，拿本地缓存如实判闸）。 */
		try {
			pullCloudHistory(function () { ppBootNightSummary(Date.now()); });
		} catch (eBoot) { /* 桩环境兜底 */ }
		/* 阶段 B 状态位（uiInit 闭包级）：摘要气泡的 Tab 切换意向 / 心跳行定时器 /
		 * 小账缓存 / 筛选 chip 态 */
		var ppPendingReportTab = false;
		var ppHbTimer = null;
		var ppPetLedger = null;
		var ppRepFailOnly = false;
