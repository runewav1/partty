<#
.SYNOPSIS
  Production release build for a Windows architecture.

.DESCRIPTION
  Build non-host architecture releases by providing the intended architecture type;
  Run dry runs via the -DryRun parameter to review the run before executing. 
  You can provide a raw override using Target.

.PARAMETER Arch
  x64 | arm64 | x86 — maps to the MSVC target triple. Empty = host behavior.

.PARAMETER Target
  Raw Rust triple override (e.g. x86_64-pc-windows-msvc). Takes precedence
  over -Arch.

.PARAMETER DryRun
  Print the plan without building.
#>
param(
  [ValidateSet("x64", "arm64", "x86")]
  [string]$Arch = "",
  [string]$Target = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content (Join-Path $repoRoot "package.json") | ConvertFrom-Json).version
$outDir = Join-Path $repoRoot "src-tauri\target\release\"

$triples = @{
  x64   = "x86_64-pc-windows-msvc"
  arm64 = "aarch64-pc-windows-msvc"
  x86   = "i686-pc-windows-msvc"
}

if ($Target) {
  $triple = $Target
} elseif ($Arch) {
  $triple = $triples[$Arch]
} else {
  $triple = ""
}

$archLabel = if ($Arch) { $Arch } elseif ($triple -match "^aarch64") { "arm64" } elseif ($triple -match "^i686") { "x86" } else { "x64" }
$outDir = Join-Path $outDir $archLabel

if ($DryRun) {
  Write-Host "version : $version"
  Write-Host "target  : $(if ($triple) { $triple } else { '(host — no --target)' })"
  Write-Host "command : node scripts/tauri.js build $(if ($triple) { "--target $triple" })"
  Write-Host "outdir  : $outDir"
  exit 0
}

# Preflight: the Rust target must exist for cross-arch builds (ARM64 also
# needs the "MSVC v143 - VS 2022 C++ ARM64 build tools" VS component).
if ($triple) {
  $installed = rustup target list --installed
  if ($installed -notcontains $triple) {
    Write-Host "Adding Rust target $triple..."
    rustup target add $triple
  }
  if ($triple -eq "aarch64-pc-windows-msvc") {
    Write-Host "ARM64: ensure 'MSVC v143 - VS 2022 C++ ARM64 build tools' is installed in Visual Studio Installer."
  }
}

Push-Location $repoRoot
try {
  # node scripts/tauri.js build — not `npm run`, whose arg parsing strips
  # --target (npm treats it as its own config).
  if ($triple) {
    node scripts/tauri.js build --target $triple
  } else {
    node scripts/tauri.js build
  }
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

$bundleRoot = Join-Path $repoRoot "src-tauri\target"
if ($triple) { $bundleRoot = Join-Path $bundleRoot $triple }
$bundleRoot = Join-Path $bundleRoot "release"
$portable = Join-Path $bundleRoot "partty.exe"
$nsis = Get-ChildItem (Join-Path $bundleRoot "bundle\nsis") -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$msi = Get-ChildItem (Join-Path $bundleRoot "bundle\msi") -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1

$out = New-Item -ItemType Directory -Force -Path $outDir
$name = "Partty-$version-$archLabel"
$copies = @()
if (Test-Path $portable) { $copies += @{ src = $portable; dst = Join-Path $out "$name-portable.exe" } }
if ($nsis) { $copies += @{ src = $nsis.FullName; dst = Join-Path $out "$name-setup.exe" } }
if ($msi) { $copies += @{ src = $msi.FullName; dst = Join-Path $out "$name.msi" } }

foreach ($c in $copies) {
  Copy-Item -LiteralPath $c.src -Destination $c.dst -Force
}
