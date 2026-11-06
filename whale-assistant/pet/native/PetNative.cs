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
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	public const int GWL_EXSTYLE = -20;
	public const int WS_EX_TOOLWINDOW = 0x80;
	public const int WINDING = 2;
	public const int RGN_OR = 2;
}
