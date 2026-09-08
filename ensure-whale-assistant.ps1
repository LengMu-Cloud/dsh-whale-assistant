# Idempotent whale-assistant plugin registration for the dsh web profile:
# 1. profile package.json gains the link dependency
# 2. profile cordis.patch.yml gains the insert row
# (the node_modules copy itself is done by robocopy in the caller)
# NOTE: keep this file ASCII-only -- Windows PowerShell 5.1 reads BOM-less
# files as ANSI/GBK and Chinese comments break the parser.
param(
	[string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
	[string]$PluginSource = (Join-Path $PSScriptRoot 'whale-assistant')
)

$ErrorActionPreference = 'Stop'

# The dependency MUST be scoped: alpha client manifests only aggregate scoped
# packages into the page's module loader (any scope works -- verified with the
# third-party task-board plugin -- so the whale ships under the project's own).
$DepName = '@lengmu-cloud/dsh-whale-assistant'

# --- 1. package.json dependency ---
$pkgPath = Join-Path $ProfileDir 'package.json'
$pkg = [System.IO.File]::ReadAllText($pkgPath)
if ($pkg -notmatch 'dsh-whale-assistant') {
	$needle = '"private": true,'
	if ($pkg.Contains($needle)) {
		$dep = '"private": true,' + "`r`n" + '  "dependencies": {' + "`r`n" + '    "' + $DepName + '": "link:' + $PluginSource + '"' + "`r`n" + '  },'
		$pkg = $pkg.Replace($needle, $dep)
		[System.IO.File]::WriteAllText($pkgPath, $pkg)
		Write-Host '    profile package.json: whale-assistant dependency added'
	} else {
		Write-Host '    [WARN] package.json shape unexpected, dependency NOT added'
	}
} else {
	Write-Host '    profile package.json: whale-assistant dependency already present'
}

# --- 2. cordis.patch.yml insert row ---
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$patch = [System.IO.File]::ReadAllText($patchPath)
if ($patch -notmatch 'ui-whale-assistant') {
	$row = @"

# dsh-whale-assistant: whale server-side storage (task history) -- data lands in
# ~/.dsh/whale-assistant.json so the desktop shell and every browser share ONE
# history. Plugin package: node_modules/$DepName.
- insert:
    - id: ui-whale-assistant
      name: '$($DepName)'
"@
	[System.IO.File]::WriteAllText($patchPath, $patch + $row)
	Write-Host '    cordis.patch.yml: whale-assistant insert row added'
} else {
	Write-Host '    cordis.patch.yml: whale-assistant insert row already present'
}

Write-Host '    whale-assistant plugin registration done'
