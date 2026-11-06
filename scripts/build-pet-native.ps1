# Build pet/dlls/PetNative.dll from pet/native/PetNative.cs.
#
# Why (2026-11-06): pet.ps1's inline Add-Type compiles the same P/Invoke
# class with csc.exe on every COLD start — measured 14.5s (11-06 01:00 boot).
# Precompiling removes csc from the boot path; pet.ps1 loads the DLL via
# [Reflection.Assembly]::LoadFrom and keeps Add-Type as the fallback.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-pet-native.ps1
# After a rebuild: refresh pet/dlls-manifest.json (SHA-256 pin,
# scripts/check-pet.js enforces it).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # repo root
$src  = Join-Path $root 'whale-assistant\pet\native\PetNative.cs'
$out  = Join-Path $root 'whale-assistant\pet\dlls\PetNative.dll'

# PS 5.1 runs on .NET Framework 4.x — use the framework csc (always present
# on Windows), NOT the Roslyn dotnet one (targeting pack mismatch risk).
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

# UTF-8 source with Chinese-free content; codepage does not matter, but be
# explicit anyway. /platform:anycpu matches Add-Type's default compilation.
& $csc /nologo /target:library /platform:anycpu /optimize+ /utf8output /out:$out $src
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

$hash = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
Write-Output ("built " + $out)
Write-Output ("sha256 " + $hash)
