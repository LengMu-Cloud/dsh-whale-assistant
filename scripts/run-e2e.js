/**
 * CDP E2E runner (P2⑧): drives the whale inside the RUNNING desktop shell
 * over the shell's remote-debugging port (9222) — no browser download, no
 * extra dependency (Node's built-in WebSocket). Covers the four scenarios
 * unit tests cannot see (the 周报-empty lesson: logic tests miss DOM
 * assembly):
 *
 *   1. whale present      — #dsh-whale exists, version is semver
 *   2. badge read / clear — synthetic attention → badge up → read → clear
 *   3. right-click menu   — menu renders with the six items
 *   4. completion pairing — synthetic turn/end pairs bubble + token panel
 *
 * Exit codes: 0 = all pass OR skipped (CDP port unreachable / web-version
 * users have no shell to connect to — never block CI over it); 1 = any
 * scenario failed.
 *
 * Usage: node scripts/run-e2e.js   (DSH desktop shell must be running)
 */
'use strict';

const SCENARIOS = [
  {
    name: '1. whale present + version',
    expr: `(function(){
      var w = document.querySelector('#dsh-whale');
      var v = window.__dshWhale && window.__dshWhale.version || '';
      return JSON.stringify({ present: !!w, version: v,
        semver: /^\\d+\\.\\d+\\.\\d+$/.test(v) });
    })()`,
    check(r) { return r.present && r.semver; },
    ok(r) { return 'present, v' + r.version; }
  },
  {
    name: '2. badge read / clear',
    expr: `(function(){
      var W = window.__dshWhale;
      W.handleMuxPayload({ type: 'session/projection', sessionId: 'session-e2e', key: 'subagentTiming', value: {} });
      W.handleMuxPayload({ type: 'session/projection', sessionId: 'session-e2e', key: 'title', value: 'E2E 会话' });
      W.handleMuxPayload({ type: 'question/requested', sessionId: 'session-e2e', time: Date.now() });
      var badge = document.querySelector('.dsh-whale-badge');
      var up1 = W.unreadCount();
      badge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return JSON.stringify({ unreadAfterAsk: up1, badgeVisible: badge.style.display });
    })()`,
    after: `(function(){
      var W = window.__dshWhale;
      var badge = document.querySelector('.dsh-whale-badge');
      badge.dispatchEvent(new Event('dblclick', { bubbles: true }));
      var h = W.historyList();
      var keep = h.filter(function(r){ return r.sessionId !== 'session-e2e'; });
      h.length = 0;
      for (var i = 0; i < keep.length; i++) h.push(keep[i]);
      try { localStorage.setItem('dsh-whale:history', JSON.stringify({ v: 1, data: keep })); } catch (e) {}
      /* save is merge-only (deletions cannot propagate through it): the
       * surgical removal goes through the debug route */
      return fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'history-remove', sessionId: 'session-e2e' }) })
        .then(function(r){ return r.json(); })
        .then(function(j){ return JSON.stringify({ unreadAtEnd: W.unreadCount(), removed: j.removed }); });
    })()`,
    check(r) { return Number(r.unreadAfterAsk) >= 1 && r.badgeVisible === 'block'; },
    afterCheck(r) { return Number(r.unreadAtEnd) === 0 && Number(r.removed) >= 1; },
    ok(r) { return 'ask → unread ' + r.unreadAfterAsk + ' + badge visible; cleared after'; }
  },
  {
    name: '3. right-click menu renders',
    expr: `(function(){
      var W = window.__dshWhale;
      W.openCtxMenu(300, 300);
      var menu = W.ctxMenuEl();
      var items = menu ? Array.from(menu.children).filter(function(c){
        return c.className.indexOf('dsh-whale-menu-item') >= 0;
      }).map(function(c){ return c.textContent; }) : [];
      var open = W.ctxMenuOpen();
      if (menu) menu.classList.remove('show');
      return JSON.stringify({ open: open, count: items.length,
        hasManual: items.some(function(t){ return t.indexOf('使用说明') >= 0; }) });
    })()`,
    check(r) { return r.open && r.count === 6 && r.hasManual; },
    ok(r) { return 'menu open, ' + r.count + ' items, 使用说明 present'; }
  },
  {
    name: '4. completion pairs bubble + token panel',
    expr: `(function(){
      var W = window.__dshWhale;
      W.handleMuxPayload({ type: 'session/projection', sessionId: 'session-e2e', key: 'subagentTiming', value: {} });
      W.handleMuxPayload({ type: 'session/projection', sessionId: 'session-e2e', key: 'title', value: 'E2E 会话' });
      W.handleMuxPayload({ type: 'session/event', sessionId: 'session-e2e',
        event: { type: 'assistant/message', time: Date.now(), data: { usage: { inputTokens: 1234, outputTokens: 100 } } } });
      W.handleMuxPayload({ type: 'session/event', sessionId: 'session-e2e',
        event: { type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } } });
      var b = document.querySelector('.dsh-whale-bubble');
      var p = document.querySelector('.dsh-whale-status');
      return JSON.stringify({
        bubble: b && b.classList.contains('show') ? b.textContent.slice(0, 40) : null,
        panelShown: !!(p && p.classList.contains('show')),
        panelHasTokens: !!(p && p.classList.contains('show') && p.textContent.indexOf('tokens') >= 0)
      });
    })()`,
    after: `(function(){
      var W = window.__dshWhale;
      var badge = document.querySelector('.dsh-whale-badge');
      badge.dispatchEvent(new Event('dblclick', { bubbles: true }));
      var h = W.historyList();
      var keep = h.filter(function(r){ return r.sessionId !== 'session-e2e'; });
      h.length = 0;
      for (var i = 0; i < keep.length; i++) h.push(keep[i]);
      try { localStorage.setItem('dsh-whale:history', JSON.stringify({ v: 1, data: keep })); } catch (e) {}
      return fetch('/api/whale-assistant/debug', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'history-remove', sessionId: 'session-e2e' }) })
        .then(function(r){ return r.json(); })
        .then(function(j){ return JSON.stringify({ cleaned: true, removed: j.removed }); });
    })()`,
    check(r) { return !!r.bubble && r.bubble.indexOf('完成了') >= 0 && r.panelShown && r.panelHasTokens; },
    ok(r) { return 'bubble [' + r.bubble + '] + token panel paired'; }
  },
];

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

function fetchTargets() {
  return new Promise((resolve, reject) => {
    require('http').get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function evaluate(wsUrl, expr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, timeoutMs || 20000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        if (msg.result && msg.result.exceptionDetails) {
          reject(new Error('page exception: ' + (msg.result.exceptionDetails.text || '?')));
        } else {
          resolve(msg.result && msg.result.result && msg.result.result.value);
        }
        ws.close();
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

(async () => {
  let targets;
  try {
    targets = await fetchTargets();
  } catch (e) {
    console.warn('⚠️  CDP 端口 9222 不可用（桌面壳未运行或为网页版）——跳过 E2E，不阻断。');
    console.warn('   （如需运行：启动桌面壳后重试 node scripts/run-e2e.js）');
    process.exit(0);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.warn('⚠️  无页面目标，跳过 E2E。'); process.exit(0); }

  let failures = 0;
  for (const sc of SCENARIOS) {
    try {
      const raw = await evaluate(page.webSocketDebuggerUrl, sc.expr, 30000);
      const r = JSON.parse(raw);
      if (!sc.check(r)) throw new Error('assertion failed: ' + raw);
      if (sc.after) {
        const raw2 = await evaluate(page.webSocketDebuggerUrl, sc.after, 30000);
        const r2 = JSON.parse(raw2);
        if (sc.afterCheck && !sc.afterCheck(r2)) throw new Error('cleanup assert failed: ' + raw2);
      }
      console.log('PASS  ' + sc.name + '  — ' + sc.ok(r));
    } catch (e) {
      failures++;
      console.log('FAIL  ' + sc.name + '  — ' + e.message);
    }
  }
  console.log(failures === 0 ? 'E2E: ALL SCENARIOS PASSED' : 'E2E: ' + failures + ' scenario(s) FAILED');
  /* Node 24/Windows: process.exit during mid-close WS handles trips a libuv
   * assertion and garbles the code — set exitCode, let handles drain, then
   * hard-stop on a timer */
  process.exitCode = failures === 0 ? 0 : 1;
  setTimeout(() => { process.exit(process.exitCode); }, 250).unref();
})();
