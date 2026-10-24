# Idempotent whale-assistant plugin registration for a dsh profile:
# 1. profile package.json gains the link dependency (into an existing
#    "dependencies" block when present, or as a new block)
# 2. profile package.json dsh.profile.bundles gains the whale (FIRST-CLASS
#    bundle: the launcher applies the package's own cordis.patch.yml row, and
#    the official plugin manager page lists it with an enable/disable toggle).
#    Verified on engine 0.1.7-rc.2 AND 0.2.0-rc.2 (both read dsh.bundle).
# 3. a LEGACY manual insert row in cordis.patch.yml is REMOVED -- the package
#    now declares dsh.bundle.patch itself, so keeping the row would register
#    the plugin twice (double whale, double notifications). Only the exact
#    block shape this script used to write is dropped; anything hand-edited
#    into a MIXED insert block is left untouched with a loud warning.
# (the node_modules copy itself is done by robocopy/junction in the caller)
# NOTE: keep this file ASCII-only -- Windows PowerShell 5.1 reads BOM-less
# files as ANSI/GBK and Chinese comments break the parser.
param(
	[string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
	[string]$PluginSource = (Join-Path $PSScriptRoot 'whale-assistant'),
	[switch]$Check,
	[switch]$Remove
)

$ErrorActionPreference = 'Stop'

$DepName = '@lengmu-cloud/dsh-whale-assistant'

if ($Check) {
	# Read-only audit of the three registration pieces; exits 1 when any is
	# missing so installers/scripts can branch on it.
	$fail = 0
	if (-not (Test-Path $ProfileDir)) {
		Write-Host '    [MISSING] profile dir: ' $ProfileDir
		exit 1
	}
	$pkg = [System.IO.File]::ReadAllText((Join-Path $ProfileDir 'package.json'))
	if ($pkg -match [regex]::Escape('"' + $DepName + '": ')) {
		Write-Host '    [OK] package.json dependency'
	} else { Write-Host '    [MISSING] package.json dependency'; $fail = 1 }
	$bm = [regex]::Match($pkg, '"bundles"\s*:\s*\[')
	$inBundles = $bm.Success -and ($pkg.Substring($bm.Index, $pkg.IndexOf(']', $bm.Index + $bm.Length) - $bm.Index) -match [regex]::Escape($DepName))
	if ($inBundles) {
		Write-Host '    [OK] dsh.profile.bundles row'
	} else { Write-Host '    [MISSING] dsh.profile.bundles row'; $fail = 1 }
	$entPath = Join-Path $ProfileDir 'node_modules\@lengmu-cloud\dsh-whale-assistant'
	if (Test-Path (Join-Path $entPath 'package.json')) {
		Write-Host '    [OK] node_modules entity'
	} else { Write-Host '    [MISSING] node_modules entity (junction)'; $fail = 1 }
	if (Test-Path (Join-Path $PluginSource 'package.json')) {
		$srcPkg = Get-Content (Join-Path $PluginSource 'package.json') | ConvertFrom-Json
		Write-Host '    [OK] plugin source version:' $srcPkg.version
	} else { Write-Host '    [MISSING] plugin source dir:' $PluginSource; $fail = 1 }
	if ($fail -eq 0) { Write-Host '    whale-assistant registration: complete' }
	exit $fail
}

if ($Remove) {
	# Symmetric uninstall: dependency row + bundles row + junction. Backs the
	# package.json up first; aborts without writing if the edit breaks JSON.
	$pkgPath = Join-Path $ProfileDir 'package.json'
	if (-not (Test-Path $pkgPath)) { Write-Host '    [WARN] no package.json at' $ProfileDir; return }
	$pkg = [System.IO.File]::ReadAllText($pkgPath)
	$name = [regex]::Escape($DepName)
	$candidate = $pkg
	# dependency row: "name": "link:..." with optional trailing comma
	$candidate = $candidate -replace ('\s*"' + $name + '"\s*:\s*"link:[^"]*"\s*,?'), ''
	# <name> as LAST list element: drop the leading comma with it (dsh plugin
	# add writes the whale on the same line as the closing bracket, so this is
	# text-structural, not line-based)
	$candidate = $candidate -replace (',\s*"' + $name + '"(?=[\]\}])'), ''
	# <name> as a NON-last list element: drop it with its trailing comma
	$candidate = $candidate -replace ('\s*"' + $name + '"\s*,(?=\s*")'), ''
	# defensive: no orphan commas right before a closing bracket/brace
	$candidate = $candidate -replace ',(\s*[\]\}])', '$1'
	if ($candidate -eq $pkg) { Write-Host '    nothing to remove (no whale rows found in package.json)' }
	else {
		try { $null = $candidate | ConvertFrom-Json } catch {
			Write-Host '    [ABORT] edit would break package.json JSON, nothing written:' $_.Exception.Message
			return
		}
		[System.IO.File]::WriteAllText($pkgPath + '.bak-remove-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds(), $pkg)
		[System.IO.File]::WriteAllText($pkgPath, $candidate)
		Write-Host '    package.json: dependency + bundles row removed (backup written alongside)'
	}
	$entPath = Join-Path $ProfileDir 'node_modules\@lengmu-cloud\dsh-whale-assistant'
	if (Test-Path $entPath) {
		cmd /c rmdir ($entPath -replace '/', '\') | Out-Null
		if (-not (Test-Path $entPath)) { Write-Host '    node_modules junction removed' }
		else { Write-Host '    [WARN] junction still present, remove manually:' $entPath }
		$parent = Split-Path $entPath
		if ((Test-Path $parent) -and -not (Get-ChildItem $parent -Force)) { Remove-Item $parent -Force }
	}
	$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
	if (Test-Path $patchPath) {
		$patch = [System.IO.File]::ReadAllText($patchPath)
		if ($patch -match 'ui-whale-assistant') {
			Write-Host '    [NOTE] cordis.patch.yml still mentions ui-whale-assistant (enable/disable override?) -- review manually'
		}
	}
	Write-Host '    whale-assistant removed; restart DSH to take effect'
	return
}

# The dependency MUST be scoped: alpha client manifests only aggregate scoped
# packages into the page's module loader (any scope works -- verified with the
# third-party task-board plugin -- so the whale ships under the project's own).

# --- 1. package.json dependency ---
$pkgPath = Join-Path $ProfileDir 'package.json'
$pkg = [System.IO.File]::ReadAllText($pkgPath)
if ($pkg -notmatch [regex]::Escape('"' + $DepName + '": ')) {
	if ($pkg -match '"dependencies"\s*:\s*\{') {
		# insert into the EXISTING dependencies block (right after its opening
		# brace; an EMPTY block gets no trailing comma)
		$m = [regex]::Match($pkg, '"dependencies"\s*:\s*\{')
		$at = $m.Index + $m.Length
		$rest = $pkg.Substring($at)
		if ($rest -match '^\s*\}') {
			$pkg = $pkg.Substring(0, $at) + "`r`n" + '    "' + $DepName + '": "link:' + $PluginSource + '"' + "`r`n  " + $rest
		} else {
			$pkg = $pkg.Substring(0, $at) + "`r`n" + '    "' + $DepName + '": "link:' + $PluginSource + '",' + $rest
		}
		[System.IO.File]::WriteAllText($pkgPath, $pkg)
		Write-Host '    profile package.json: whale-assistant dependency added (existing block)'
	} elseif ($pkg.Contains('"private": true,')) {
		$dep = '"private": true,' + "`r`n" + '  "dependencies": {' + "`r`n" + '    "' + $DepName + '": "link:' + $PluginSource + '"' + "`r`n" + '  },'
		$pkg = $pkg.Replace('"private": true,', $dep)
		[System.IO.File]::WriteAllText($pkgPath, $pkg)
		Write-Host '    profile package.json: whale-assistant dependency added (new block)'
	} else {
		Write-Host '    [WARN] package.json shape unexpected, dependency NOT added'
	}
} else {
	Write-Host '    profile package.json: whale-assistant dependency already present'
}

# --- 2. dsh.profile.bundles list (first-class bundle registration) ---
$pkg = [System.IO.File]::ReadAllText($pkgPath)
$bm = [regex]::Match($pkg, '"bundles"\s*:\s*\[')
if ($bm.Success) {
	# scope the membership check to THIS array only (the dependency above also
	# mentions the package name, so a whole-file check would false-positive)
	$arrEnd = $pkg.IndexOf(']', $bm.Index + $bm.Length)
	$arrText = $pkg.Substring($bm.Index, $arrEnd - $bm.Index)
	if ($arrText -notmatch [regex]::Escape($DepName)) {
		$pkg = $pkg.Substring(0, $arrEnd) + ",`r`n" + '        "' + $DepName + '"' + $pkg.Substring($arrEnd)
		[System.IO.File]::WriteAllText($pkgPath, $pkg)
		Write-Host '    profile dsh.profile.bundles: whale-assistant appended'
	} else {
		Write-Host '    profile dsh.profile.bundles: whale-assistant already present'
	}
} elseif ($pkg.Contains('"profile": {')) {
	$pkg = $pkg.Replace('"profile": {', '"profile": {' + "`r`n" + '      "bundles": [' + "`r`n" + '        "' + $DepName + '"' + "`r`n" + '      ],')
	[System.IO.File]::WriteAllText($pkgPath, $pkg)
	Write-Host '    profile dsh.profile.bundles: created with whale-assistant'
} else {
	Write-Host '    [WARN] no dsh.profile block, bundle NOT added (add "dsh":{"profile":{"bundles":["' + $DepName + '"]}} manually)'
}

# --- 3. retire the legacy manual insert row (double-registration guard) ---
# Handles the exact shape this script (pre-bundle era) wrote:
#   [whale comment lines] / - insert: / - id: ui-whale-assistant / name: '...'
# -> the block AND its comment go. A MIXED block (whale + other ids) is left
# untouched with a loud warning (manual review beats a corrupted patch).
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
if (Test-Path $patchPath) {
	$patch = [System.IO.File]::ReadAllText($patchPath)
	if ($patch -match 'ui-whale-assistant') {
		$lines = [System.IO.File]::ReadAllLines($patchPath)
		$out = New-Object System.Collections.Generic.List[string]
		$i = 0
		$dropped = 0
		$warned = $false
		while ($i -lt $lines.Count) {
			$line = $lines[$i]
			if ($line -match '^\s*-\s*insert\s*:\s*$') {
				# collect item lines: deeper-indented, or blank, or deeper-indented comments
				$j = $i + 1
				$block = New-Object System.Collections.Generic.List[string]
				while ($j -lt $lines.Count) {
					$n = $lines[$j]
					if ($n -match '^\s' -or $n.Trim() -eq '') { $block.Add($n); $j++ }
					else { break }
				}
				$blockText = ($block -join "`n")
				$idCount = ([regex]::Matches($blockText, '^\s*-\s*id:')).Count
				if ($blockText -match 'ui-whale-assistant' -and $idCount -eq 1) {
					# whale-only block: drop it plus the whale comment lines right above
					while ($out.Count -gt 0 -and $out[$out.Count - 1] -match '^\s*#' -and $out[$out.Count - 1] -match 'whale') { $out.RemoveAt($out.Count - 1) }
					$dropped++
					$i = $j
					continue
				}
				if ($blockText -match 'ui-whale-assistant') {
					Write-Host '    [WARN] cordis.patch.yml has the whale inside a MIXED insert block -- left untouched, review manually (bundle is registered; the manual row double-registers)'
					$warned = $true
				}
				$out.Add($line)
				foreach ($bl in $block) { $out.Add($bl) }
				$i = $j
				continue
			}
			$out.Add($line)
			$i++
		}
		if ($dropped -gt 0) {
			[System.IO.File]::WriteAllLines($patchPath, $out)
			Write-Host '    cordis.patch.yml: legacy whale insert block removed (bundle patch now supplies the row)'
		} elseif (-not $warned) {
			Write-Host '    cordis.patch.yml: no legacy whale insert block'
		}
	} else {
		Write-Host '    cordis.patch.yml: no legacy whale insert row'
	}
}

Write-Host '    whale-assistant plugin registration done (bundle mode)'
