// PetNative — precompiled twin of pet.ps1's inline Add-Type block.
//
// Why this exists (2026-11-06, 用户实报「打开 DSH 桌宠等很久才弹出来」):
// PowerShell's Add-Type compiles this P/Invoke class with csc.exe at EVERY
// cold start — measured 14.5s on 11-06 01:00 (01:00:36.829 assemblies
// loaded → 01:00:51.306 first DPI call; warm start is 0.13s). Precompiling
// to pet/dlls/PetNative.dll and loading via [Reflection.Assembly]::LoadFrom
// removes the compiler from the boot path entirely. pet.ps1 keeps the
// Add-Type fallback: a deployment without the DLL (or a platform where
// LoadFrom fails) must still boot, just slower.
//
// Source of truth: this file. If you edit it, rebuild PetNative.dll
// (scripts/build-pet-native.ps1) and refresh pet/dlls-manifest.json —
// scripts/check-pet.js pins the DLL by SHA-256.
using System;
using System.Runtime.InteropServices;

public static class Native4
{
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
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int n);
	// v19 (2026-11-13): 遮挡重算强推——ShowWindow 唤醒后 Chromium 的遮挡追踪
	// 可能仍把窗口判为被透明桌宠层遮挡（document.hidden=true=合成器停止出
	// 帧=窗口是一张静态截图，滚轮点击全部无效）。1px 微移强制遮挡重算。
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
	public const uint SWP_NOSIZE = 0x0001;
	public const uint SWP_NOMOVE = 0x0002;
	// v18 (2026-11-13): EcoQoS 反制——隐藏数分钟的 DSH 渲染层被 Windows 11
	// 效率模式打上 Idle 优先级（线程验尸实锤：renderer priority=Idle/40 线程
	// 全 Wait），唤醒后页面以 Idle 跑=肉眼级卡死。桌宠按 pid 解除
	// PowerThrottling（StateMask=0 即显式关闭 EXECUTION_SPEED 节流）。
	[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
	[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
	[DllImport("kernel32.dll")] public static extern bool SetProcessInformation(IntPtr hProcess, int cls, ref PROCESS_POWER_THROTTLING_STATE info, int size);
	[StructLayout(LayoutKind.Sequential)] public struct PROCESS_POWER_THROTTLING_STATE { public uint VersionMask; public uint ControlMask; public uint StateMask; }
	public const uint PROCESS_SET_INFORMATION = 0x0200;
	public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
	public const int ProcessInfoClassPowerThrottling = 4;
	public const uint POWER_THROTTLING_EXECUTION_SPEED = 0x1;
	public static bool DisablePowerThrottlingPid(uint pid) {
		IntPtr h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
		if (h == IntPtr.Zero) return false;
		try {
			PROCESS_POWER_THROTTLING_STATE s;
			s.VersionMask = 0; s.ControlMask = POWER_THROTTLING_EXECUTION_SPEED; s.StateMask = 0;
			return SetProcessInformation(h, ProcessInfoClassPowerThrottling, ref s, Marshal.SizeOf(typeof(PROCESS_POWER_THROTTLING_STATE)));
		} finally { CloseHandle(h); }
	}
	private static IntPtr _reviveVis;
	private static IntPtr _reviveHidden;
	// v8 (2026-11-13): class-filtered window find. The shell owns many
	// invisible helper top-level windows (Chrome_WidgetWin_0 / IME /
	// Electron_NotifyIconHostWindow); once the user closes the main window
	// it sinks in Z-order, so a first-hit enum used to return a helper and
	// "show" nothing while logging success (observed 11-12 04:22-04:23:
	// three 'hidden shell window shown' logs against a user report of no
	// window). Only the Electron main BrowserWindow class counts; a
	// visible match wins immediately, otherwise remember the first hidden
	// one (close limbo) and keep scanning for a visible one.
	public static IntPtr FindWindowOfPids(int[] pids) {
		_reviveVis = IntPtr.Zero;
		_reviveHidden = IntPtr.Zero;
		EnumWindows(delegate(IntPtr h, IntPtr l) {
			uint wpid = 0; GetWindowThreadProcessId(h, out wpid);
			bool ours = false;
			foreach (int p in pids) { if (wpid == (uint)p) { ours = true; break; } }
			if (ours) {
				var sb = new System.Text.StringBuilder(64);
				GetClassName(h, sb, 64);
				if (sb.ToString() == "Chrome_WidgetWin_1") {
					if (IsWindowVisible(h)) { _reviveVis = h; return false; }
					if (_reviveHidden == IntPtr.Zero) { _reviveHidden = h; }
				}
			}
			return true;
		}, IntPtr.Zero);
		return _reviveVis != IntPtr.Zero ? _reviveVis : _reviveHidden;
	}
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	public const int GWL_EXSTYLE = -20;
	public const int WS_EX_TOOLWINDOW = 0x80;
	public const int WINDING = 2;
	public const int RGN_OR = 2;
}
