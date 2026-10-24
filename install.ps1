# One-command installer for the dsh-whale-assistant plugin.
# Locates or clones the repo, registers the plugin into one or both dsh
# profiles (dependency + bundles row via the ensure script), links the
# node_modules junction, and verifies all three registration pieces.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -TargetProfile web
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Repo "D:\path\to\dsh-whale-assistant"
#
# NOTE: keep this file ASCII-only -- Windows PowerShell 5.1 reads BOM-less
# files as ANSI/GBK and Chinese comments break the parser.
param(
	[string]$Repo = 'https://github.com/LengMu-Cloud/dsh-whale-assistant',
	[string]$InstallDir = (Join-Path $env:USERPROFILE 'dsh-whale-assistant'),
	[string]$TargetProfile = 'desktop'   # profile name under ~/.dsh/profiles/; 'both' = desktop + web
)
$ErrorActionPreference = 'Stop'

# --- 1/4 locate or fetch the repo ---
$source = $null
if (Test-Path (Join-Path $Repo 'whale-assistant\package.json')) {
	# local checkout given directly: link: needs it to stay put, so use as-is
	$source = (Resolve-Path $Repo).Path
	Write-Host "[1/4] using local repo at $source"
} elseif (Test-Path (Join-Path $InstallDir 'whale-assistant\package.json')) {
	$source = (Resolve-Path $InstallDir).Path
	Write-Host "[1/4] repo already present at $source"
	if (Test-Path (Join-Path $source '.git')) {
		git -C $source pull --ff-only 2>$null   # best effort; offline stays fine
	}
} else {
	Write-Host "[1/4] cloning $Repo ..."
	git clone --depth 1 $Repo $InstallDir
	if (-not (Test-Path (Join-Path $InstallDir 'whale-assistant\package.json'))) {
		throw 'clone did not produce the expected repo layout (whale-assistant/package.json missing)'
	}
	$source = (Resolve-Path $InstallDir).Path
}

# --- 2/4 resolve target profiles (they must already exist: DSH generates a
# profile on first run, and a hand-made fresh one would miss dsh-web-app --
# see README "installation") ---
$names = @($TargetProfile)
if ($TargetProfile -eq 'both') { $names = @('desktop', 'web') }
$dirs = @()
foreach ($n in $names) {
	$d = Join-Path $env:USERPROFILE ".dsh\profiles\$n"
	if (-not (Test-Path (Join-Path $d 'package.json'))) {
		throw "profile '$n' is not initialized at $d -- run DSH once first (open the desktop app once, or run: dsh --profile $n), then re-run this installer"
	}
	$dirs += , @($n, $d)
}
Write-Host "[2/4] target profiles: $(($dirs | ForEach-Object { $_[0] }) -join ', ')"

# --- 3/4 register (ensure script: dependency + bundles + legacy-row guard),
# then the node_modules junction (the third registration piece) ---
Write-Host '[3/4] registering plugin ...'
$ensure = Join-Path $PSScriptRoot 'ensure-whale-assistant.ps1'
$real = Join-Path $source 'whale-assistant'
foreach ($pair in $dirs) {
	& $ensure -ProfileDir $pair[1] -PluginSource $real
	$ent = Join-Path $pair[1] 'node_modules\@lengmu-cloud\dsh-whale-assistant'
	$entParent = Split-Path $ent
	if (-not (Test-Path $entParent)) { New-Item -ItemType Directory -Force -Path $entParent | Out-Null }
	if (Test-Path $ent) {
		$t = $null
		try { $t = (Get-Item $ent -Force).Target } catch { }
		if ($t -and -not (@($t) -contains $real)) {
			Write-Host "    [WARN] junction exists but points elsewhere ($(@($t) -join ', ')); leaving it untouched"
		} else {
			Write-Host "    junction OK -> $real"
		}
	} else {
		New-Item -ItemType Junction -Force -Path $ent -Target $real | Out-Null
		Write-Host "    junction created -> $real"
	}
}

# --- 4/4 verify all three pieces per profile ---
Write-Host '[4/4] verifying registration ...'
$code = 0
foreach ($pair in $dirs) {
	Write-Host '    profile:' $pair[0]
	& $ensure -ProfileDir $pair[1] -PluginSource $real -Check
	if ($LASTEXITCODE -ne 0) { $code = 1 }
}
if ($code -eq 0) {
	Write-Host 'Done. Restart DSH to load the whale (desktop: reopen the app; web: restart the dsh service, then F5).'
} else {
	Write-Host 'Some registration pieces are missing -- see the [MISSING] lines above.'
}
exit $code
