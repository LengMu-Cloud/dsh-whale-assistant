<#
.SYNOPSIS
  whale-patch 桌面壳补丁安装器（Windows，幂等）。
.DESCRIPTION
  把仓库维护的瘦壳入口（shell/main.js，文件头带 "whale-patch: shell" 标记）
  安装进已存在的 DeepSeek Harness 桌面封装：
    - 自动定位壳（-ShellRoot 可显式指定；默认探测运行中的进程与已知安装路径）
    - 幂等：已打过同版本补丁时输出 "already patched, skipped" 直接退出
    - 首次执行把原始 app.asar 备份为 app.asar.bak（已有备份永不覆盖）
    - 完成后需重启壳生效
  依赖：node/npx（npx @electron/asar 用于解包与重打包）。
  认证说明：壳补丁不绕过认证——它从服务日志读取一次性 token URL、
  验证真实可用后带认证加载页面（详见 docs/shell-setup.md）。
.PARAMETER ShellRoot
  壳应用根目录（其下应有 resources\app.asar）。留空则自动探测。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\fix-shell.ps1
#>
param(
  [string]$ShellRoot = ''
)

$ErrorActionPreference = 'Stop'
$marker = 'whale-patch: shell'

Write-Host '== whale-patch shell installer =='

# ---------- 1. 定位壳 ----------
$candidates = @()
if ($ShellRoot -ne '') { $candidates += $ShellRoot }
$proc = Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($proc) {
  # 本机布局 exe 在 <root>\DeepSeek Harness.exe、asar 在 <root>\resources\app.asar
  # （只差一级）；从 exe 目录逐级向上找，兼容 exe 更深一层的其他布局。
  $dir = Split-Path $proc.Path
  for ($i = 0; $i -lt 4 -and $dir; $i++) {
    $candidates += $dir
    $dir = Split-Path $dir
  }
}

$asarPath = $null
foreach ($c in $candidates) {
  if ($c -eq '') { continue }
  $try = Join-Path $c 'resources\app.asar'
  if (Test-Path $try) { $asarPath = $try; break }
}
if (-not $asarPath) {
  Write-Host 'ERROR: app.asar not found. Pass -ShellRoot "<app root>" and retry.'
  exit 1
}
Write-Host ("target: " + $asarPath)

# ---------- 2. 解包到临时目录 ----------
$tmp = Join-Path $env:TEMP ('whale-shell-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$npx = (Get-Command npx -ErrorAction SilentlyContinue).Source
if (-not $npx) { Write-Host 'ERROR: npx not found (install Node.js first).'; exit 1 }
& $npx --yes @electron/asar extract $asarPath $tmp
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: asar extract failed.'; exit 1 }

# ---------- 3. 幂等检查（按内容，不按标记） ----------
# 只查标记会让已打补丁的壳永远收不到后续更新（金丝雀改名/参数硬化都装不进去）；
# 与仓库 shell/main.js 逐字节一致才算"已装"。
$mainInAsar = Join-Path $tmp 'main.js'
if (-not (Test-Path $mainInAsar)) { Write-Host 'ERROR: app.asar has no main.js — not the expected shell layout.'; exit 1 }
$repoShellNow = Join-Path $PSScriptRoot '..\shell\main.js'
if ((Test-Path $repoShellNow) -and
	((Get-FileHash $mainInAsar).Hash -eq (Get-FileHash $repoShellNow).Hash)) {
	Write-Host 'already patched (shell matches repo source), skipped'
	Remove-Item -Recurse -Force $tmp
	exit 0
}

# ---------- 4. 备份原始包（永不覆盖已有备份） ----------
$backup = $asarPath + '.bak'
if (-not (Test-Path $backup)) {
  Copy-Item $asarPath $backup
  Write-Host ("backup written: " + $backup)
} else {
  Write-Host 'backup already exists, kept untouched'
}

# ---------- 5. 覆盖壳入口并重打包 ----------
# 壳入口源：仓库 shell/main.js（唯一权威副本，缺失即报错退出）。
$repoShell = Join-Path $PSScriptRoot '..\shell\main.js'
if (-not (Test-Path $repoShell)) {
  Write-Host 'ERROR: no shell source found (expected shell/main.js in the repo).'
  exit 1
}
Copy-Item $repoShell $mainInAsar -Force

# ---------- 6. 重打包 + 复验 ----------
$packed = Join-Path $tmp ('packed-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.asar')
& $npx --yes @electron/asar pack $tmp $packed
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: asar pack failed (original untouched).'; exit 1 }
$verify = Join-Path $tmp 'verify'
& $npx --yes @electron/asar extract $packed $verify
$verifyMain = Get-Content (Join-Path $verify 'main.js') -Raw
if (-not $verifyMain.Contains($marker)) { Write-Host 'ERROR: verification failed (original untouched).'; exit 1 }

Copy-Item $packed $asarPath -Force
Remove-Item -Recurse -Force $tmp
Write-Host 'OK: Shell patch applied successfully. Restart the desktop shell to take effect.'
exit 0
