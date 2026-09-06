// whale-patch: shell v1 (maintained by whale-patch/scripts/fix-shell.ps1)
// DeepSeek Harness 瘦壳（引擎外置：dsh web 走 npm 全局包，更新 = npm install -g）
const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

// 渲染进程在 Windows 上崩溃的头号原因是 GPU 驱动/硬件加速；
// DSH 是普通 Web 界面，不需要 GPU，禁用后稳定性大幅提升。
app.disableHardwareAcceleration();
// Chromium 沙箱在部分系统环境（安全软件/组策略）会导致 renderer 启动即崩，
// 本应用只加载本地可信的 127.0.0.1 页面，关闭沙箱换取稳定性。
app.commandLine.appendSwitch('no-sandbox');
// 本机调试口（小鲸鱼插件排障用：CDP 可直读页面 DOM/console/localStorage）
app.commandLine.appendSwitch('remote-debugging-port', '9222');

const DSH_PORT = parseInt(process.env.DSH_PORT || '3080', 10) || 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const SERVER_START_TIMEOUT_MS = 60000; // dsh web 首次启动最长等待（后台进行，不阻塞窗口）
const GUARD_INTERVAL_MS = 10000;       // 服务守护探测间隔
const GUARD_FAIL_LIMIT = 6;            // 连续失败次数（约 60s）→ 重启服务
const CRASH_WINDOW_MS = 15000;         // 崩溃计数窗口
const CRASH_LIMIT = 5;                 // 窗口内崩溃上限 → 重启整个应用（防无限 reload 循环）

// ---------- 日志（userData 目录，不受绿色版解压路径影响） ----------
const userDataDir = app.getPath('userData');
const logFile = path.join(userDataDir, 'DeepSeek Harness.log');
function log(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) {}
}

// ---------- 探测（TCP 直连端口，比 HTTP 请求更底层可靠，不受代理/HTTP 层干扰） ----------
function probe(cb) {
  const sock = net.connect({ host: '127.0.0.1', port: DSH_PORT, timeout: 3000 });
  sock.once('connect', () => { sock.destroy(); cb(true); });
  sock.once('error', () => { sock.destroy(); cb(false); });
  sock.once('timeout', () => { sock.destroy(); cb(false); });
}

function waitForServer(timeoutMs, cb, elapsed) {
  probe((ok) => {
    if (ok) return cb(true);
    if (elapsed >= timeoutMs) return cb(false);
    setTimeout(() => waitForServer(timeoutMs, cb, elapsed + 1000), 1000);
  });
}

// ---------- 定位并启动 dsh web（隐藏窗口、独立进程组，关窗不停服） ----------
function findDsh() {
  const cand = path.join(process.env.APPDATA || '', 'npm', 'dsh.cmd');
  try { if (fs.statSync(cand).isFile()) return cand; } catch (_) {}
  const dirs = (process.env.PATH || '').split(';');
  for (const dir of dirs) {
    for (const name of ['dsh.cmd', 'dsh.exe', 'dsh.bat', 'dsh']) {
      try {
        const p = path.join(dir, name);
        if (fs.statSync(p).isFile()) return p;
      } catch (_) {}
    }
  }
  return null;
}

// ---------- 定位 node 与 dsh 入口 ----------
function findNode() {
  const cands = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
  ];
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  const dirs = (process.env.PATH || '').split(';');
  for (const dir of dirs) {
    try {
      const p = path.join(dir, 'node.exe');
      if (fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

function findDshBinJs() {
  const cand = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  try { if (fs.statSync(cand).isFile()) return cand; } catch (_) {}
  return null;
}

/* 只允许精确匹配官方 dsh 包入口的绝对路径进入 spawn 参数：
 * 必须以 node_modules/@deepseek-ai/dsh/lib/bin.js 结尾，且不以选项符号
 * 开头（路径来自上面的固定候选，这里显式复核一遍再交给 spawn）；
 * spawn 时再把 `--` 放在该路径之前，node 在 `--` 后不再解析选项，
 * 双保险杜绝参数被当作 node 选项解释。 */
const DSH_BIN_OK = /[\\\/]node_modules[\\\/]@deepseek-ai[\\\/]dsh[\\\/]lib[\\\/]bin\.js$/;
function isSafeDshBinJs(p) {
  return typeof p === 'string' && p.length > 0 && p.charAt(0) !== '-' && DSH_BIN_OK.test(p);
}

// ---------- 确保 dsh web 运行：node 直跑 bin.js（绕开 cmd 引号坑），
//   输出落盘 dsh-server.log 便于排障 ----------
function ensureServer(cb) {
  probe((ok) => {
    if (ok) return cb(true);
    const serverLog = path.join(userDataDir, 'dsh-server.log');
    const binJs = findDshBinJs();
    const nodeExe = findNode();
    let child = null;
    try {
      if (isSafeDshBinJs(binJs) && nodeExe) {
        const fd = fs.openSync(serverLog, 'a');
        log(`starting dsh web: ${nodeExe} -- ${binJs} --port ${DSH_PORT} --no-open`);
        // --no-open: 本封装用自带窗口承载界面，禁用 dsh web 自动弹默认浏览器；
        // `--` 终止 node 选项解析，bin.js 之后的参数全部传给脚本
        child = spawn(nodeExe, ['--', binJs, 'web', '--port', String(DSH_PORT), '--no-open'], {
          windowsHide: true,
          detached: true,
          stdio: ['ignore', fd, fd],
          cwd: path.dirname(binJs),
        });
        child.on('exit', (code, sig) => log(`dsh web exited: code=${code} sig=${sig}`));
        child.unref();
      } else {
        log('WARN: node/bin.js not found, falling back to cmd /c');
        const dshCmd = findDsh();
        if (!dshCmd) {
          log('ERROR: dsh command not found (run: npm install -g @deepseek-ai/dsh)');
          return cb(false);
        }
        const fd = fs.openSync(serverLog, 'a');
        log(`starting dsh web (cmd): ${dshCmd} web --port ${DSH_PORT} --no-open`);
        child = spawn('cmd.exe', ['/c', `${dshCmd} web --port ${DSH_PORT} --no-open`], {
          windowsHide: true,
          detached: true,
          stdio: ['ignore', fd, fd],
        });
        child.on('exit', (code, sig) => log(`dsh web (cmd) exited: code=${code} sig=${sig}`));
        child.unref();
      }
    } catch (e) {
      log('ERROR: spawn failed: ' + e.message);
      return cb(false);
    }
    waitForServer(SERVER_START_TIMEOUT_MS, cb, 0);
  });
}

// ---------- 读取 dsh web 打印的带 token 认证 URL ----------
// (dsh 0.1.2-alpha 起 web 界面需要认证：服务启动时向 stdout 打印
//  带一次性 token 的 URL，浏览器换取 30 天 cookie。壳从日志里取
//  最新一条，让窗口直接以认证状态打开。)
function readTokenUrlFromLog() {
  try {
    const serverLog = path.join(userDataDir, 'dsh-server.log');
    const text = fs.readFileSync(serverLog, 'utf8');
    const m = text.match(new RegExp('http://127\\.0\\.0\\.1:' + DSH_PORT + '/\\?token=[A-Za-z0-9_-]*', 'g'));
    return m ? m[m.length - 1] : null;
  } catch (_) { return null; }
}

// ---------- HTTP GET 探测：TCP 通了 ≠ 应用就绪 ----------
// dsh web 先开端口、cordis 插件后挂载；窗口若在插件挂载完成前加载
// 页面，渲染出来就是黑屏（用户此前需要手动 F5 的根因）。所有 UI
// 加载前都先真实请求一次并要求 200。
// SSRF 护栏：本壳只允许与本地 DSH 服务通信。token URL 来自日志正则
// 提取——即便日志被污染或未来改动引入外源串，此处也不予放行。
function isLocalDshUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port === String(DSH_PORT);
  } catch (_) { return false; }
}

function httpOk(url, cb) {
  if (!isLocalDshUrl(url)) { cb(false); return; }
  try {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      res.resume(); /* drain the body so the socket frees up */
      /* 303 = auth layer up + token VALID (invalid token 401s instead),
       * and the browser will follow the redirect to set the cookie */
      const ok = [200, 204, 301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0;
      cb(ok);
    });
    req.on('timeout', () => { req.destroy(); cb(false); });
    req.on('error', () => cb(false));
  } catch (_) { cb(false); }
}

/** 服务就绪后等待"真正可用"的认证 URL（最多 60s，每 1s 复查）：
 *  1. 日志最新 token URL 必须真实返回 200（token 随重启轮换，旧
 *     token / 插件未挂载完都会被这里挡住）；
 *  2. 前 15s 还要求 /api/whale-assistant/state 返回 200（cordis 插件层
 *     就绪的金丝雀；15s 后放行，避免插件缺失时永远等待）。 */
function loadUiWithAuth() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let tries = 0;
  let done = false;
  const timer = setInterval(() => {
    if (done || !mainWindow || mainWindow.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    tries++;
    if (tries > 60) {
      done = true;
      clearInterval(timer);
      log('no verified URL in 60s, loading plain URL as fallback');
      mainWindow.loadURL(DSH_URL);
      return;
    }
    const tokenUrl = readTokenUrlFromLog();
    const candidate = tokenUrl || DSH_URL;
    httpOk(candidate, (pageOk) => {
      if (done || !pageOk) return;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        log('loading UI with verified URL' + (tokenUrl ? ' (authenticated)' : ' (plain)'));
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(candidate);
      };
      if (tries > 15) return finish();
      httpOk(DSH_URL + '/api/whale-assistant/state', (pluginsOk) => {
        if (pluginsOk) finish();
      });
    });
  }, 1000);
}

// ---------- 主窗口 ----------
let mainWindow = null;
let loadFailures = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DeepSeek Harness',
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    show: false,
    // 小鲸鱼的轮询/计时器依赖页面定时器：Chromium 默认对隐藏窗口把
    // setInterval 压到 1 次/分钟，后台任务通知会成分钟级延迟 —— 关掉限流
    webPreferences: {
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show(); });
  // 先显示本地加载页（服务就绪前避免白屏/错误页），服务就绪后切换 URL
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  // F5 / Ctrl+R 手动刷新（窗口无菜单栏，Electron 不默认绑定）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isReload = input.key === 'F5' || (input.key === 'r' && input.control);
    if (isReload) {
      event.preventDefault();
      mainWindow.webContents.reload();
    }
  });

  // 渲染进程崩溃 / 无响应 → 自动重新加载（无需手动刷新）
  // 崩溃计数保护：窗口内连续崩溃超过上限 → 重启整个应用，避免无限 reload 循环
  let crashTimes = [];
  function recordCrash(reason) {
    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < CRASH_WINDOW_MS);
    crashTimes.push(now);
    log(`crash (${reason}) #${crashTimes.length} in ${CRASH_WINDOW_MS / 1000}s window`);
    if (crashTimes.length >= CRASH_LIMIT) {
      log('too many crashes, restarting app…');
      crashTimes = [];
      app.relaunch();
      app.exit(0);
      return;
    }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    }, 1000);
  }
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('render-process-gone: ' + JSON.stringify(details));
    recordCrash('render-process-gone');
  });
  mainWindow.webContents.on('unresponsive', () => {
    log('renderer unresponsive');
    recordCrash('unresponsive');
  });

  // 加载失败（如服务尚未就绪）→ 自动重试
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    loadFailures++;
    log(`did-fail-load ${code} ${desc} (attempt ${loadFailures})`);
    if (loadFailures < 120) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }, 3000);
    }
  });
  mainWindow.webContents.on('did-finish-load', () => { loadFailures = 0; });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- 服务守护：服务挂了自动重启 + 页面自动刷新 ----------
let guardFail = 0;
function startGuard() {
  setInterval(() => {
    probe((ok) => {
      if (ok) { guardFail = 0; return; }
      guardFail++;
      log(`server probe fail #${guardFail}`);
      if (guardFail >= GUARD_FAIL_LIMIT) {
        guardFail = 0;
        log('server down, restarting dsh web…');
        ensureServer((ok2) => {
          if (ok2 && mainWindow && !mainWindow.isDestroyed()) {
            log('server recovered, reloading window');
            loadUiWithAuth(); /* token 随重启轮换，重新读日志取新地址 */
          }
        });
      }
    });
  }, GUARD_INTERVAL_MS);
}

// ---------- 单实例：重复双击只聚焦已有窗口 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      // 已有实例但窗口不在了（异常状态）→ 重建窗口
      createWindow();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // 窗口立即创建（先显示本地加载页），服务在后台确保，就绪后加载 UI
    createWindow();
    startGuard();
    ensureServer((ok) => {
      if (!ok) {
        log('WARN: dsh web not ready, window stays on loading page');
        return;
      }
      log(`dsh web ready at ${DSH_URL}, loading UI`);
      loadUiWithAuth();
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // 关闭窗口 = 退出壳；dsh web 保持后台常驻（下次双击秒开）
  app.on('window-all-closed', () => {
    app.quit();
  });
}
