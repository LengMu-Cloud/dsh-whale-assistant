# dsh-whale-assistant pet host (桌宠) — architecture v6, ported from the POC
# (%TEMP%\whale-pet-poc\poc4\pet-poc4.ps1, user-accepted 2026-10-31).
# All configuration arrives via ENVIRONMENT VARIABLES from lib/pet.js —
# never argv (WMI-readable) and never the page URL (WebView2 History store).
#
#   DSH_PET_TOKEN        access token for /pet/* (injected as a request
#                        header via WebResourceRequested; NEVER logged)
#   DSH_PET_PORT         plugin webServer port (dynamic on desktop 0.2.1+)
#   DSH_PET_FORM         initial form: full | bubble | hidden
#   DSH_PET_PARENT_PID   engine PID — the pet exits when the parent dies
#   DSH_PET_DLLDIR       WebView2 fixed-version managed DLLs
#   DSH_PET_USERDATA     WebView2 userData directory (independent profile)
#   DSH_PET_LOG          append-only log file
#
# Region state machine (POC v6, keep verbatim semantics):
#   d=1 (drag/swim) -> region frozen to the whole workarea (DWM re-clip can
#     flash the WebView2 sub-surface one frame per SetWindowRgn; churn-free
#     motion is the only stable state) -> d=0 -> 250ms debounce -> snug
#     polygon union floating-layer rects. Title channel is fallback-only
#     and carries RECTANGLES ONLY.
$ErrorActionPreference = 'Stop'
$log = $env:DSH_PET_LOG
if (-not $log) { $log = Join-Path $env:TEMP 'dsh-whale-pet.log' }
function Log($m) { try { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss.fff'), $m) -ErrorAction SilentlyContinue } catch { } }

# One pet per Windows session: a second DSH profile enabling the pet spawns
# a second shell that must exit cleanly (mutex held -> exit 0, no zombie).
# AbandonedMutexException（自愈链 2026-11-04）：前任 pet 被强杀（taskkill /T/
# 崩溃）时 mutex 未 Release=abandoned——.NET 的 WaitOne 检测到 abandoned 会
# 抛异常（所有权其实已转移）。$ErrorActionPreference='Stop' 下首测秒死且
# 走不到第一条日志（pet.log 零痕迹之谜）——自愈心跳每 60s 重 spawn 每
# 60s 秒死。捕获即视为拿到锁。
$mutex = New-Object System.Threading.Mutex($false, 'dsh-whale-pet')
$mutexAcquired = $false
try { $mutexAcquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexAcquired = $true }
if (-not $mutexAcquired) { Log '== duplicate start blocked (mutex held) - exit =='; exit 0 }
Log ('== pet host start ' + (Get-Date -Format 'HH:mm:ss') + ' ==')

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$dllDir = $env:DSH_PET_DLLDIR
if (-not $dllDir) { $dllDir = $PSScriptRoot }
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $dllDir 'Microsoft.Web.WebView2.Core.dll'))
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $dllDir 'Microsoft.Web.WebView2.Wpf.dll'))
Log 'assemblies loaded'

# Native4 冷启动加速（11-06，用户实报「打开 DSH 桌宠等很久才弹出」）：
# 下面那段内联 Add-Type 每次冷启动都要 csc.exe 现场编译——实测 14.5s
# （01:00:36.829 assemblies loaded → 01:00:51.306 首 DPI 调用；暖启动
# 0.13s）。预编译的 PetNative.dll（源=pet/native/PetNative.cs，
# scripts/build-pet-native.ps1 产出，SHA-256 入 dlls-manifest.json）走
# LoadFrom 零编译加载；DLL 缺失/加载失败回落内联编译（老路照通，只是慢）。
$nativeDll = Join-Path $dllDir 'PetNative.dll'
if ([IO.File]::Exists($nativeDll)) {
	try {
		[void][System.Reflection.Assembly]::LoadFrom($nativeDll)
		[void][Native4]::GetDpiForWindow([IntPtr]::Zero)   # smoke: type binds, P/Invoke resolves
		Log 'native4 from precompiled dll'
	} catch {
		Log ('native dll load failed (' + $_.Exception.Message + ') — falling back to Add-Type')
	}
}
if (-not ('Native4' -as [type])) {

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Native4 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("gdi32.dll")] public static extern IntPtr CreatePolygonRgn(POINT[] pts, int n, int fill);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a, int b, int c, int d);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateEllipticRgn(int a, int b, int c, int d);
  [DllImport("gdi32.dll")] public static extern IntPtr CombineRgn(IntPtr dst, IntPtr a, IntPtr b, int mode);
  [DllImport("user32.dll")] public static extern bool SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte scan, uint flags, UIntPtr extra);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  private static IntPtr _reviveHwnd;
  public static IntPtr FindWindowOfPids(int[] pids) {
    _reviveHwnd = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) { uint wpid = 0; GetWindowThreadProcessId(h, out wpid); foreach (int p in pids) { if (wpid == (uint)p) { _reviveHwnd = h; return false; } } return true; }, IntPtr.Zero);
    return _reviveHwnd;
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TOOLWINDOW = 0x80;
  public const int WINDING = 2;
  public const int RGN_OR = 2;
}
'@
}
# DPI aware MUST precede any window creation (system-aware; sharp at primary scale)
[void][Native4]::SetProcessDPIAware()
Log 'process DPI-aware (system) set'
# transparent WebView2 page background (documented env switch; whale floats, no page bg)
$env:WEBVIEW2_DEFAULT_BACKGROUND_COLOR = '00FFFFFF'

# ---- shared rebuild pipeline (POC v6 verbatim semantics) -------------------
function script:Invoke-RegionRebuild {
	param($data)
	try {
		if ($data.err) {
			if ($script:errLogged -lt 5) { $script:errLogged++; Log ("page err: " + $data.err) }
			return
		}
		if ($data.poly -and ([int]$data.v -ne $script:polyV -or $null -eq $script:poly)) {
			$script:poly = $data.poly
			$script:polyV = [int]$data.v
			Log ("poly cached: v=" + $script:polyV + " pts=" + $script:poly.Count)
		}
		# empirical scale: physical client width / page CSS viewport width
		# (GetDpiForWindow lies when system DPI is stale vs the monitor's real scale)
		if ($data.iw -and [double]$data.iw -gt 100) {
			$ns = [Math]::Round($script:cw / [double]$data.iw, 4)
			if ($ns -gt 0.5 -and $ns -lt 4 -and [Math]::Abs($ns - $script:scale) -gt 0.001) {
				$script:scale = $ns
				Log ("scale updated to " + $ns + " (client " + $script:cw + " / iw " + $data.iw + ")")
			}
		}
		if ($script:diagOnce -lt 3) {
			$script:diagOnce++
			Log ("page diag: api=" + $data.a + " iw=" + $data.iw + " maxAlpha=" + $data.mx + " polyPts=" + $data.pn)
		}
		if (-not $data.whale -or $data.whale.Count -lt 4) { return }
		if ($script:lastD -ne $data.d) { $script:lastD = $data.d; Log ("d-> " + $data.d + " whale=" + $data.whale[0] + "," + $data.whale[1]) }
		if ($data.d -eq 1) {
			if ($script:snugTimer) { $script:snugTimer.Stop() }   # motion not over: cancel snug
			if ($script:fullRgn) { return }   # already frozen: zero region ops during motion
			$script:fullRgn = $true
			$wr0 = New-Object Native4+RECT
			[Native4]::GetWindowRect($script:hwnd, [ref]$wr0) | Out-Null
			$rgn0 = [Native4]::CreateRectRgn(0, 0, $wr0.Right - $wr0.Left, $wr0.Bottom - $wr0.Top)
			$ok0 = [Native4]::SetWindowRgn($script:hwnd, $rgn0, $false)
			if (-not $ok0) { [void][Native4]::DeleteObject($rgn0) }
			Log 'region -> full workarea (motion start; zero churn until stop)'
			return
		}
		$script:lastPayload = $data
		if ($script:fullRgn) {
			# motion just ended (or d jitter): 250ms snug countdown, full region held
			if (-not $script:snugTimer.IsEnabled) { $script:snugTimer.Start() }
			return
		}
		$key = ("{0},{1},{2},{3}" -f $data.whale[0], $data.whale[1], $data.whale[2], $data.whale[3]) + '|v' + $script:polyV + '|d' + $data.d + '|r' + $data.rects.Count
		foreach ($r in $data.rects) { $key += ('|' + $r[0] + ',' + $r[1] + ',' + $r[2] + ',' + $r[3]) }
		if ($key -eq $script:lastKey) { return }
		$script:lastKey = $key

		$s = $script:scale
		$cp = New-Object Native4+POINT
		[Native4]::ClientToScreen($script:hwnd, [ref]$cp) | Out-Null
		$wr = New-Object Native4+RECT
		[Native4]::GetWindowRect($script:hwnd, [ref]$wr) | Out-Null
		$dx = $cp.X - $wr.Left; $dy = $cp.Y - $wr.Top   # expect 0 with NoResize
		$wl = [double]$data.whale[0]; $wt = [double]$data.whale[1]
		$rgn = [IntPtr]::Zero
		if ($data.PSObject.Properties['p'] -and $data.p -eq 1) {
			# 躲猫猫（11-01 用户定稿）：右下角小眼睛=椭圆小区域（扩 4px 呼吸余量）
			$ep = 4.0
			$rgn = [Native4]::CreateEllipticRgn([int](($wl - $ep) * $s) + $dx, [int](($wt - $ep) * $s) + $dy, [int](([double]$data.whale[2] + $ep) * $s) + $dx, [int](([double]$data.whale[3] + $ep) * $s) + $dy)
		} elseif ($data.b -eq 1) {
			# 气泡形态（真机反馈 10-31#4）：玻璃圆角卡——贴身区域用圆角矩形
			# 而不是鲸鱼轮廓多边形（线稿 svg 的逐行提取在气泡语境没有意义）
			$bp = 10.0
			$rgn = [Native4]::CreateRoundRectRgn([int](($wl - $bp) * $s) + $dx, [int](($wt - $bp) * $s) + $dy, [int](([double]$data.whale[2] + $bp) * $s) + $dx, [int](([double]$data.whale[3] + $bp) * $s) + $dy, 30, 30)
		} elseif ($script:poly -and $script:poly.Count -ge 3) {
			$n = $script:poly.Count
			$pts = New-Object 'Native4+POINT[]' $n
			for ($i = 0; $i -lt $n; $i++) {
				$p = New-Object Native4+POINT
				$p.X = [int][Math]::Round(($wl + [double]$script:poly[$i][0]) * $s) + $dx
				$p.Y = [int][Math]::Round(($wt + [double]$script:poly[$i][1]) * $s) + $dy
				$pts[$i] = $p
			}
			$rgn = [Native4]::CreatePolygonRgn($pts, $n, [Native4]::WINDING)
		} else {
			# fallback until first poly arrives: padded whale rect
			$grow = 88 * 0.12 * $s
			$rgn = [Native4]::CreateRoundRectRgn([int]($wl * $s - $grow) + $dx, [int]($wt * $s - $grow) + $dy, [int](([double]$data.whale[2]) * $s + $grow) + $dx, [int](([double]$data.whale[3]) * $s + $grow) + $dy, 18, 18)
		}
		if ($rgn -eq [IntPtr]::Zero) { Log 'rgn create FAILED'; return }
		# wander envelope (bob rise / wiggle / entry bounce exceed the snug polygon):
		# the anchor is the layout box (static), these transforms land inside this rect
		$exr = [Native4]::CreateRoundRectRgn([int](($wl - 4) * $s) + $dx, [int](($wt - 18) * $s) + $dy, [int](([double]$data.whale[2] + 4) * $s) + $dx, [int](([double]$data.whale[3] + 4) * $s) + $dy, 8, 8)
		if ($exr -ne [IntPtr]::Zero) {
			[Native4]::CombineRgn($rgn, $rgn, $exr, [Native4]::RGN_OR) | Out-Null
			[Native4]::DeleteObject($exr) | Out-Null
		}
		if ($data.rects -and $data.rects.Count -gt 0) {
			foreach ($r in $data.rects) {
				$rr = [Native4]::CreateRoundRectRgn([int]([double]$r[0] * $s) + $dx, [int]([double]$r[1] * $s) + $dy, [int]([double]$r[2] * $s) + $dx, [int]([double]$r[3] * $s) + $dy, 8, 8)
				if ($rr -ne [IntPtr]::Zero) {
					[Native4]::CombineRgn($rgn, $rgn, $rr, [Native4]::RGN_OR) | Out-Null
					[Native4]::DeleteObject($rr) | Out-Null
				}
			}
		}
		# redraw=false (POC finding): redraw=true forces legacy invalidation ->
		# fullscreen window flickers at 60Hz region churn; DWM applies the new
		# clip next frame, the content is already on the surface.
		$ok = [Native4]::SetWindowRgn($script:hwnd, $rgn, $false)
		if (-not $ok) { [void][Native4]::DeleteObject($rgn) }       # failed path: system did not take ownership
		$script:rebuilds++
		if ($script:rebuilds -le 6 -or $script:rebuilds % 50 -eq 0) {
			Log ("region#" + $script:rebuilds + " pts=" + $(if ($script:poly) { $script:poly.Count } else { 0 }) + " d=" + $data.d + " popups=" + $data.rects.Count + " whale=" + $data.whale[0] + "," + $data.whale[1] + " set=" + $ok)
		}
	} catch {
		Log ("rebuild-err: " + $_.Exception.Message)
	}
}

# NOTE: unlike the POC (which kept an inflated roundrect branch for d=1), the
# frozen-workarea branch above makes that path unreachable — motion NEVER
# rebuilds a region. The dead branch is intentionally not carried over.

function script:Apply-PetForm($v) {
	if ($v -eq 'hidden') {
		# 躲猫猫（11-01 用户定稿）：「隐藏」=鲸鱼游到右下角收成一只小眼睛——
		# **窗口永不 Hide**。真机实证两连坑：win.Hide() 曾直接杀死 ShowDialog
		# 模态循环（进程自杀=假退出）；Hide→Show 循环让 WebView2 丢透明表面
		# （整面黑块）+ 隐藏窗口节流 JS 定时器（远程 form 变化到不了页面）。
		# peek 态页面持续上报 eye 椭圆区域（payload p:1），machinery 照跑。
		# 托盘已整体移除（用户定稿 11-02）：小鲸鱼自己的右键菜单+右下角小气泡
		# 就是全部入口，不需要系统托盘。
		$script:formHidden = $true
		Log 'form -> hidden (peek at bottom-right, window stays visible)'
		return
	}
	if ($v -eq 'bubble' -or $v -eq 'full') {
		$script:formHidden = $false
		Log ('form -> ' + $v)
	}
}

function script:Show-DshWindow {
	# 桌宠通知双击跳转的前台化（11-03）：宿主广播 pet/jump 让页鲸切换会话，
	# 窗口可见性由桌宠进程负责——按**进程名**（DSH_PET_HOSTPROC，宿主 spawn
	# 时写入）定位主窗口。实测坑：桌宠父进程=引擎进程，不是持窗的 Electron
	# 主进程，按 pid 找窗必落空；且 SetForegroundWindow 只允许前台进程调用，
	# 经典绕法=短按 ALT 再设（系统解除前台锁）。
	try {
		$procName = [IO.Path]::GetFileNameWithoutExtension([string]$env:DSH_PET_HOSTPROC)
		if (-not $procName) { Log 'jump: no host proc name'; return }
		$wins = Get-Process -Name $procName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
		if (-not $wins) { Log ('jump: no window for ' + $procName); return }
		foreach ($w in $wins) {
			$h = $w.MainWindowHandle
			if ([Native4]::IsIconic($h)) { [void][Native4]::ShowWindow($h, 9) }  # SW_RESTORE
			[void][Native4]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)             # ALT down
			[void][Native4]::SetForegroundWindow($h)
			[void][Native4]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)             # ALT up (KEYEVENTF_KEYUP)
		}
		Log ('jump: foregrounded ' + $procName + ' x' + @($wins).Count)
	} catch { Log ('jump err: ' + $_.Exception.Message) }
}

# Resolve the DSH shell executable ONCE at spawn time: engine pid
# (DSH_PET_PARENT_PID) -> its parent = the shell (Electron, holds the
# window). The shell may be GONE by the time a revive is needed (user
# closed the window; window-all-closed -> app.quit), so the full path is
# stashed here while it is still alive (11-11 jump-revive round).
function script:Resolve-ShellExe {
	try {
		$eng = Get-CimInstance Win32_Process -Filter "ProcessId=$env:DSH_PET_PARENT_PID" -ErrorAction Stop
		$shell = Get-CimInstance Win32_Process -Filter "ProcessId=$($eng.ParentProcessId)" -ErrorAction Stop
		if ($shell.ExecutablePath) {
			$script:shellExePath = [string]$shell.ExecutablePath
			Log ('shell exe resolved: ' + $script:shellExePath)
		} else {
			Log 'shell exe resolve: parent has no path'
		}
	} catch {
		Log ('shell exe resolve skipped: ' + $_.Exception.Message)
	}
}

# Revive the DSH window after the user closed it (jump/settings requested).
# 11-12 v2 - the page calls this after EVERY jump/settings request, and two
# realities must both work:
# - a DSH window with a handle exists -> just foreground it (the jump
#   already executed in that window's whale);
# - no window handle anywhere -> the shell quit/hung while its renderer may
#   even still linger in close-limbo (observed 11-12: delivered=true with
#   zero visible windows = the jump executed in an INVISIBLE whale). Plain
#   Start-Process cannot help then: the single-instance lock is held by the
#   zombie shell, so the second instance just self-quits. Instead a
#   DETACHED helper force-kills the zombie shell first, then starts the
#   stashed shell exe. The helper must outlive this pet (killing the shell
#   kills this pet through the parent chain). The jump itself replays from
#   the ledger pendingJump (host hello-flush) once the fresh page connects.
function script:Revive-DshWindow {
	if (-not $script:shellExePath) { Log 'revive: shell path unknown'; return }
	$procName2 = [IO.Path]::GetFileNameWithoutExtension($script:shellExePath)
	$shellPids = @(Get-Process -Name $procName2 -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
	# v7 (11-12): X 之后壳常停在「退出挂起」态——窗口被隐藏但渲染层还活着
	# （任务栏残留 + delivered=true 实证）。Process.MainWindowHandle 对隐藏
	# 窗返回 0，必须 EnumWindows 枚举壳名下全部顶层窗口：找到=ShowWindow+
	# 前台化（跳转已经在隐藏窗里执行成功，只差显示出来）；一个都没有=壳真
	# 死→走 CIM 杀僵尸+重拉兜底。
	if ($shellPids.Count -gt 0) {
		try {
			$h = [Native4]::FindWindowOfPids($shellPids)
			if ($h -ne [IntPtr]::Zero) {
				if ([Native4]::IsIconic($h)) { [void][Native4]::ShowWindow($h, 9) }
				[void][Native4]::ShowWindow($h, 5)
				[void][Native4]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
				[void][Native4]::SetForegroundWindow($h)
				[void][Native4]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
				Log 'revive: hidden shell window shown + foregrounded (jump already executed in it)'
				return
			}
			Log 'revive: shell alive but windowless (close-limbo) -> CIM kill+relaunch'
		} catch {
			Log ('revive enum err: ' + $_.Exception.Message)
		}
	}
	# 11-12 v5 FILE-based cooldown (20s): the detached relaunch respawns THIS
	# pet (new process = in-memory cooldown lost), so consecutive clicks used
	# to re-kill the freshly booting shell forever - death spiral, observed
	# 03:38-03:39: three kill+relaunch cycles in 50s ending with NO DSH at
	# all. The file survives pet respawns and blocks overlapping helpers.
	$cdFile = Join-Path $env:USERPROFILE '.dsh\pet\last-revive'
	$nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
	try {
		if (Test-Path $cdFile) {
			$last = [int64](Get-Content $cdFile -TotalCount 1 -ErrorAction Stop)
			if ($nowMs - $last -lt 20000) {
				Log 'revive: file cooldown (relaunch in flight) - skipped'
				return
			}
		}
	} catch { }
	if (-not (Test-Path $script:shellExePath)) { Log ('revive: shell exe missing: ' + $script:shellExePath); return }
	try {
		# v6 (11-12): write the revive script to a FILE and launch it via
		# WMI/CIM. Two hard lessons from v4/v5:
		# 1) embedded quotes in a -Command string get eaten by Start-Process
		#    argument re-parsing (the helper silently no-oped);
		# 2) the killed shell owns a JOB OBJECT that holds this whole process
		#    tree (pet + detached helpers) with kill-on-close - when the shell
		#    dies, every helper dies with it and the relaunch never runs
		#    (observed: kill works, relaunch never does). A CIM-created
		#    process is parented to WmiPrvSE and escapes the job entirely.
		# The helper logs its own steps to revive-helper.log.
		$helperFile = Join-Path $env:USERPROFILE '.dsh\pet\revive-helper.ps1'
		$helperLog = Join-Path $env:USERPROFILE '.dsh\pet\revive-helper.log'
		$helperScript = @'
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:USERPROFILE '.dsh\pet\revive-helper.log'
function L($m) { Add-Content -Path $log -Value ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $m) }
L 'helper start'
try {
	Stop-Process -Name "DeepSeek Harness" -Force -ErrorAction SilentlyContinue
	L 'zombie shell killed'
	Start-Sleep -Seconds 2
	Start-Process -FilePath "SHELLEXE_PLACEHOLDER"
	L 'shell relaunched'
} catch {
	L ('helper err: ' + $_.Exception.Message)
}
'@
		$helperScript = $helperScript.Replace('SHELLEXE_PLACEHOLDER', $script:shellExePath)
		Set-Content -Path $helperFile -Value $helperScript -Encoding UTF8 -ErrorAction Stop
		try { Set-Content -Path $cdFile -Value $nowMs -ErrorAction Stop } catch { }
		Log ('revive: helper file written, launching via CIM (zombie ' + $procName2 + ' kill + relaunch)')
		Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ('powershell -NoProfile -ExecutionPolicy Bypass -File "' + $helperFile + '"') } | Out-Null
	} catch {
		Log ('revive helper err: ' + $_.Exception.Message)
	}
}

function script:Shutdown-Pet($reason) {
	Log ('shutdown: ' + $reason)
	try { $script:parentWatch.Stop() } catch { }
	try { $script:poll.Stop(); $script:fast.Stop(); $script:snugTimer.Stop() } catch { }
	try { $script:win.Close() } catch { }
}

# ---- window -----------------------------------------------------------------
# （出生闸门已随「关窗 ≠ 退出」语义反转退役 11-06：桌宠跟进程走，父活着
# 即现身——boot spawn/心跳重生时父必然活着，等窗口的机制不再有意义。）

$win = New-Object System.Windows.Window
$script:win = $win
$win.WindowStyle = 'None'
$win.ResizeMode = 'NoResize'
$win.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(0x00, 0x00, 0x01)))
$win.Title = 'dsh-whale-pet'
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.WindowStartupLocation = 'Manual'
$wa = [System.Windows.SystemParameters]::WorkArea
$win.Left = $wa.Left; $win.Top = $wa.Top   # correct when the taskbar is not bottom-docked
$win.Width = $wa.Width; $win.Height = $wa.Height
Log ("workarea(DIU)=" + $wa.Width + "x" + $wa.Height)

$wv = [System.Reflection.Assembly]::LoadFrom((Join-Path $dllDir 'Microsoft.Web.WebView2.Wpf.dll')).GetType('Microsoft.Web.WebView2.Wpf.WebView2').GetConstructor([Type[]]@()).Invoke($null)
$script:wv = $wv
$win.Content = $wv

$win.Add_SourceInitialized({
	$script:hwnd = (New-Object System.Windows.Interop.WindowInteropHelper $win).Handle
	$ex = [Native4]::GetWindowLong($script:hwnd, [Native4]::GWL_EXSTYLE)
	# NOACTIVATE must stay OFF: it kills every keyboard input in whale panels
	# (history search / reminder editor). Cost: clicking the whale activates
	# this window, same as any normal app.
	[Native4]::SetWindowLong($script:hwnd, [Native4]::GWL_EXSTYLE, $ex -bor [Native4]::WS_EX_TOOLWINDOW)
	$dpi = [Native4]::GetDpiForWindow($script:hwnd)
	if ($dpi -le 0) { $dpi = 96 }
	$script:scale = $dpi / 96.0
	$cr = New-Object Native4+RECT
	[Native4]::GetClientRect($script:hwnd, [ref]$cr) | Out-Null
	$script:cw = $cr.Right - $cr.Left
	$wr = New-Object Native4+RECT
	[Native4]::GetWindowRect($script:hwnd, [ref]$wr) | Out-Null
	Log ("hwnd=" + $script:hwnd + " dpi=" + $dpi + " scale=" + $script:scale + " client=" + ($cr.Right - $cr.Left) + "x" + ($cr.Bottom - $cr.Top) + " win=" + ($wr.Right - $wr.Left) + "x" + ($wr.Bottom - $wr.Top))
	# pre-show 1px region at bottom-right: no fullscreen flash before first real region
	$pw = [int]($win.Width * $script:scale); $ph = [int]($win.Height * $script:scale)
	$tiny = [Native4]::CreateRoundRectRgn($pw - 2, $ph - 2, $pw, $ph, 1, 1)
	[Native4]::SetWindowRgn($script:hwnd, $tiny, $false) | Out-Null
})

$win.Add_ContentRendered({
	# initial form (rare: only 'hidden' needs an action; full/bubble are no-ops)
	if ($env:DSH_PET_FORM -eq 'hidden') { Apply-PetForm 'hidden' }
})

$script:formHidden = $false
$script:navigated = $false
$script:lastTitle = ''
$script:lastKey = ''
$script:poly = $null
$script:polyV = -1
$script:rebuilds = 0
$script:errLogged = 0
$script:seenTitles = 0
$script:diagOnce = 0
$script:cw = 0
$script:msgHooked = $false
$script:msgSeen = 0
$script:procHooked = $false
$script:fullRgn = $false
$script:lastD = -1
$script:lastPayload = $null

# ---- timers ------------------------------------------------------------------
$script:poll = New-Object System.Windows.Threading.DispatcherTimer
$script:poll.Interval = [TimeSpan]::FromMilliseconds(250)
# latest-wins merge (swim-tail backlog fix): messages store only the newest,
# a 16ms timer rebuilds from it — when processing cannot keep up with 60Hz
# the region converges to the LATEST position instead of lagging behind
$script:pendingJson = $null
$script:fast = New-Object System.Windows.Threading.DispatcherTimer
$script:fast.Interval = [TimeSpan]::FromMilliseconds(16)
# snug debounce: d 1->0 waits 250ms before collapsing; any d=1 cancels.
# whale.js double-click path jitters d (swim cancelled ~46ms in and restarted).
$script:snugTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:snugTimer.Interval = [TimeSpan]::FromMilliseconds(250)
$script:snugTimer.Add_Tick({
	try {
		$script:snugTimer.Stop()
		if (-not $script:fullRgn) { return }
		$script:fullRgn = $false
		$p = $script:lastPayload
		if ($p) { Invoke-RegionRebuild $p }
	} catch { Log ("snug-err: " + $_.Exception.Message) }
})
$script:fast.Add_Tick({
	try {
		if ($script:pendingJson) {
			$p = $script:pendingJson
			$script:pendingJson = $null
			Invoke-RegionRebuild (($p | ConvertFrom-Json))
		} else {
			$script:fast.Stop()
		}
	} catch { $script:fast.Stop(); Log ("fast-err: " + $_.Exception.Message) }
})

# parent-death watch: the engine died without running its disposers (crash /
# hard kill) — an orphan pet must not outlive its parent. Also the safety net
# behind the ~10s SIGTERM graceful window the desktop updater grants.
$script:parentWatch = New-Object System.Windows.Threading.DispatcherTimer
# 1s（11-06 三修，语义反转：**关窗 ≠ 退出**，用户实报「任务栏里 DSH 没退
# 出，只是右下角关了页面，小鲸鱼也跟着消失了」）：此前看护跟**窗口**走
# （11-03 语义：窗口全关=退出）——但 DSH 0.2.1 的 × 只是关窗，引擎进程
# 继续驻留（真机实锤：窗口全关后进程残留数小时），关窗期桌宠照死=语义
# 过时。现桌宠跟**进程**走：只查父进程（DSH_PET_PARENT_PID）——进程活着
# 桌宠常驻（关窗期任务完成照常通知——桌宠的核心价值场景），父进程死
# （真退出/升级 SIGTERM/崩溃）1s 内跟随退出。升级路径另有宿主 dispose
# killTree 双保险。11-03 的「跟窗口走」语义随之退役。
$script:parentWatch.Interval = [TimeSpan]::FromSeconds(1)
$script:parentWatch.Add_Tick({
	try {
		$ppid = 0
		try { $ppid = [int]$env:DSH_PET_PARENT_PID } catch { }
		if ($ppid -gt 0) { [void](Get-Process -Id $ppid -ErrorAction Stop) }
	} catch {
		Shutdown-Pet 'parent process gone'
	}
})
$script:parentWatch.Start()
Resolve-ShellExe

# ---- 托盘整体移除（用户定稿 11-02）------------------------------------------
# 系统托盘图标（NotifyIcon+自绘小蓝鲸+菜单+气球提示）全部撤下：小鲸鱼自己的
# 右键菜单（形态组/退出）+ 躲猫猫态右下角的小气泡已经覆盖全部入口，
# 任务栏不再出现任何常驻图标。退出入口=桌宠右键菜单「❌ 退出桌宠」；
# 兜底=重启 DSH（dispose 收树）/ensure -Remove。

$script:poll.Add_Tick({
	try {
		if (-not $script:ensured) {
			$script:ensured = $true
			try {
				$ud = $env:DSH_PET_USERDATA
				if (-not $ud) { $ud = Join-Path $env:LOCALAPPDATA 'dsh-whale-pet' }
				$env2 = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $ud, $null).GetAwaiter().GetResult()
				$script:wv.EnsureCoreWebView2Async($env2) | Out-Null
				Log 'ensure called (explicit env, dedicated userData)'
			} catch { Log ("ensure err: " + $_.Exception.Message) }
			return
		}
		if ($script:wv.CoreWebView2 -eq $null) { return }
		if (-not $script:navigated) {
			$port = $env:DSH_PET_PORT
			if (-not $port) { Log 'DSH_PET_PORT missing'; return }
			# token rides on EVERY request to the host origin via the
			# WebResourceRequested filter below — the URL stays clean
			# (History store never sees it) and the page JS never knows it.
			try {
				$cv2 = $script:wv.CoreWebView2
				$cv2.AddWebResourceRequestedFilter('http://127.0.0.1:' + $port + '/*', [Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext]::All)
				$cv2.add_WebResourceRequested({
					param($s, $e)
					try {
						if ($env:DSH_PET_TOKEN) { $e.Request.Headers.SetHeader('X-DSH-Pet-Token', $env:DSH_PET_TOKEN) }
					} catch { }
				})
				Log 'webresource token filter armed'
			} catch { Log ("filter err: " + $_.Exception.Message) }
			$script:wv.CoreWebView2.Navigate('http://127.0.0.1:' + $port + '/api/whale-assistant/pet/page')
			$script:navigated = $true
			Log 'navigated to /pet/page'
			return
		}
		if (-not $script:msgHooked) {
			$script:msgHooked = $true
			try {
				$script:wv.CoreWebView2.add_WebMessageReceived({
					param($s, $e)
					try {
						$raw = $e.WebMessageAsJson
						if (-not $raw) { return }
						$obj = $null
						try { $obj = $raw | ConvertFrom-Json } catch { }
						if ($obj -and $obj.PSObject.Properties['c'] -and $obj.c) {
							# control frame from the pet page (form changes / fatal / jump)
							if ($obj.c -eq 'form') { Apply-PetForm ([string]$obj.v) }
							elseif ($obj.c -eq 'fatal') { Log ('fatal from page: ' + $obj.r); Shutdown-Pet ('fatal-' + $obj.r) }
							elseif ($obj.c -eq 'jump') { Show-DshWindow }
							elseif ($obj.c -eq 'revive') { Revive-DshWindow }
							return
						}
						# poly 即到即缓存（真机实证 11-01）：16ms latest-wins 合流会用
						# 2ms 后的相邻无 poly 消息覆盖首拍（页侧连发两拍也同窗）——
						# 缓存必须发生在合流之前，这里就地收下
						if ($obj -and $obj.PSObject.Properties['poly'] -and $obj.poly) {
							try {
								$v = [int]$obj.v
								if ($v -ne $script:polyV -or $null -eq $script:poly) {
									$script:poly = $obj.poly
									$script:polyV = $v
									Log ("poly cached (direct): v=" + $v + " pts=" + $script:poly.Count)
								}
							} catch { }
						}
						if ($script:msgSeen -lt 2) { $script:msgSeen++; Log ("msg#" + $script:msgSeen + ": " + $raw.Substring(0, [Math]::Min(110, $raw.Length))) }
						$script:pendingJson = $raw   # latest-wins
						if (-not $script:fast.IsEnabled) { $script:fast.Start() }
					} catch { }
				})
				Log 'webmessage handler attached'
			} catch { Log ("msg-handler err: " + $_.Exception.Message) }
		}
		# renderer death self-heal: re-navigate next tick; navigation completed
		# resets the poly version + key (page v restarts at 1); default browser
		# context menu stays off (right-click in the 6px gasket would pop an
		# unclipped browser menu over the desktop)
		if (-not $script:procHooked) {
			$script:procHooked = $true
			try {
				$script:wv.CoreWebView2.add_ProcessFailed({
					param($s, $e)
					try {
						$kind = ''
						try { $kind = [string]$e.ProcessFailedKind } catch { }
						Log ("process failed: " + $kind + " -> re-navigate")
						$script:navigated = $false
						$script:lastKey = ''
					} catch { }
				})
				$script:wv.CoreWebView2.add_NavigationCompleted({
					param($s, $e)
					try {
						$script:polyV = -1; $script:lastKey = ''
						# 静默看门狗（冒烟实测补上的洞）：导航完成后 20s 内一条区域
						# 消息都没有 = 页面没起来（渲染进程死/JS 崩/被替换成错误页
						# 且自杀脚本也没跑）——绝不带着空壳窗口赖着
						if ($script:silentWatch) { try { $script:silentWatch.Stop() } catch { } }
						$script:silentWatch = New-Object System.Windows.Threading.DispatcherTimer
						$script:silentWatch.Interval = [TimeSpan]::FromSeconds(20)
						$script:silentWatch.Add_Tick({
							try {
								$script:silentWatch.Stop()
								# formHidden 豁免（11-01）：隐藏形态下页面按设计不发区域
								# 消息（push 对 hidden 早退）——20s 静默是正常态不是死亡
								if ($script:msgSeen -ge 1 -or $script:formHidden) { return }
								Log 'page silent 20s after navigation -> fatal'
								Shutdown-Pet 'page-silent'
							} catch { }
						})
						$script:silentWatch.Start()
					} catch { }
				})
				try { $script:wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false } catch { }
				Log 'proc/nav handlers attached; default ctx menu off'
			} catch { Log ("proc-handler err: " + $_.Exception.Message) }
		}
		# title channel fully yields once the message channel is alive: a stale
		# d=0 title during a swim would yank the region back to snug (flicker)
		if ($script:msgSeen -ge 1) { return }
		$title = ''
		try { $title = $script:wv.CoreWebView2.DocumentTitle } catch { }
		if (-not $title -or -not $title.StartsWith('WR:')) { return }
		if ($title -eq $script:lastTitle) { return }
		$script:lastTitle = $title
		$data = ($title.Substring(3) | ConvertFrom-Json)
		if ($script:seenTitles -lt 10) {
			$script:seenTitles++
			Log ("title#" + $script:seenTitles + ": " + $title.Substring(0, [Math]::Min(150, $title.Length)))
		}
		if ($data.fatal) { Log ('fatal via title'); Shutdown-Pet 'fatal-title'; return }
		Invoke-RegionRebuild $data
	} catch {
		Log ("tick-err: " + $_.Exception.Message)
	}
})
$script:poll.Start()

$win.Add_Closed({
	Log 'window closed'
	# Show+Dispatcher.Run 的普通循环不会因窗口关闭自动退出（ShowDialog 才会）
	# ——必须显式停机，否则自杀路径关窗后进程挂死
	try { [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() } catch { }
})
# Show + 独立 Dispatcher 循环（真机取证 11-01）：ShowDialog 的模态循环在窗口
# 隐藏时立即返回=桌宠进程自杀——「隐藏桌宠」变成事实上的「退出桌宠」+死亡
# 广播唤醒页鲸+账本 enabled 残留成开机秒死循环。Show()+Dispatcher::Run() 的
# 普通循环不受影响（躲猫猫态窗口保持可见只裁小气泡区域）。
Log 'entering dispatcher (Show + Run)'
$win.Show()
[void][System.Windows.Threading.Dispatcher]::Run()
Log 'script exit'
exit 0
