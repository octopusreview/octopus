# AUTO-SYNCED COPY — DO NOT EDIT DIRECTLY.
# Canonical source: apps/cli/install/install.ps1. To update this file, edit
# the canonical source and run `scripts/sync-installers.sh` (or copy by
# hand). A diff against the canonical version fails the CI check in
# .github/workflows/sync-installers-check.yml.
#
# Octopus CLI installer (Windows / PowerShell).
#
# Usage:
#   irm https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli/install/install.ps1 | iex
#
# What it does:
#   1. Detects your CPU architecture
#   2. Fetches the latest `octp-v*` release from GitHub
#   3. Downloads the matching native .exe
#   4. Installs it to $env:USERPROFILE\.octopus\bin\octp.exe (or $env:OCTOPUS_INSTALL_DIR)
#   5. Adds the install directory to your user PATH (idempotent)
#
# After install, run `octp` to launch the first-run onboarding wizard.
#
# Environment variables:
#   $env:OCTOPUS_INSTALL_DIR   Override install directory
#   $env:OCTOPUS_INSTALL_REPO  Override the GitHub repo (default: octopusreview/octopus)
#   $env:OCTOPUS_INSTALL_TAG   Install a specific tag instead of latest

$ErrorActionPreference = "Stop"

$Repo        = if ($env:OCTOPUS_INSTALL_REPO) { $env:OCTOPUS_INSTALL_REPO } else { "octopusreview/octopus" }
$InstallDir  = if ($env:OCTOPUS_INSTALL_DIR)  { $env:OCTOPUS_INSTALL_DIR }  else { Join-Path $env:USERPROFILE ".octopus\bin" }
$BinaryName  = "octp.exe"

# ── Step 1: arch ─────────────────────────────────────────────────────────────

# We only ship x64 today. ARM64 Windows can fall back to x64 emulation; if a
# native ARM64 build is added later, expand this map.
$arch = "x64"
$asset = "octp-windows-${arch}.exe"

# ── Step 2: resolve release tag ──────────────────────────────────────────────

if ($env:OCTOPUS_INSTALL_TAG) {
  $tag = $env:OCTOPUS_INSTALL_TAG
  Write-Host "Installing pinned version: $tag"
} else {
  Write-Host "Looking up latest octp release on $Repo ..."
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=20" -Headers @{ "User-Agent" = "octp-installer" }
  $tag = ($releases | Where-Object { $_.tag_name -like "octp-v*" } | Select-Object -First 1).tag_name
  if (-not $tag) {
    Write-Error "Could not find any octp-v* release on $Repo. Pin a tag with `$env:OCTOPUS_INSTALL_TAG = 'octp-v0.X.Y'`."
    exit 1
  }
  Write-Host "Latest release: $tag"
}

# ── Step 3: download ─────────────────────────────────────────────────────────

$downloadUrl = "https://github.com/$Repo/releases/download/$tag/$asset"
$sumsUrl = "https://github.com/$Repo/releases/download/$tag/SHA256SUMS.txt"
Write-Host "Downloading $downloadUrl ..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$target = Join-Path $InstallDir $BinaryName

try {
  Invoke-WebRequest -Uri $downloadUrl -OutFile $target -UseBasicParsing
} catch {
  Write-Error "Failed to download $asset from $tag. The release might not have a Windows binary."
  exit 1
}

# ── Step 3b: verify SHA256 checksum ──────────────────────────────────────────
# octp-release.yml generates SHA256SUMS.txt and attaches it to every release.
# Verifying the binary against the published sum protects against in-flight
# tampering and truncated downloads. Set $env:OCTOPUS_INSTALL_SKIP_VERIFY="1"
# to bypass (only do this when pinning a tag pre-dating the sums workflow).

if ($env:OCTOPUS_INSTALL_SKIP_VERIFY -eq "1") {
  Write-Host "SKIPPING SHA256 verification (OCTOPUS_INSTALL_SKIP_VERIFY=1)."
} else {
  $sumsTmp = New-TemporaryFile
  try {
    try {
      Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsTmp -UseBasicParsing
    } catch {
      Remove-Item $target -Force -ErrorAction SilentlyContinue
      Write-Error "Could not download SHA256SUMS.txt from $tag. Older releases pre-date the sums workflow — set `$env:OCTOPUS_INSTALL_SKIP_VERIFY='1' if you accept that risk."
      exit 1
    }
    $expectedLine = Get-Content $sumsTmp | Where-Object { $_ -match "  $([Regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $expectedLine) {
      Remove-Item $target -Force -ErrorAction SilentlyContinue
      Write-Error "No SHA256SUMS.txt entry for $asset on $tag. Set `$env:OCTOPUS_INSTALL_SKIP_VERIFY='1' to bypass (NOT recommended)."
      exit 1
    }
    $expected = ($expectedLine -split "\s+")[0]
    $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLower()
    if ($expected -ne $actual) {
      Remove-Item $target -Force -ErrorAction SilentlyContinue
      Write-Error "SHA256 mismatch for $asset. expected=$expected actual=$actual. The download may be corrupt or tampered. Aborting."
      exit 1
    }
    Write-Host "Verified SHA256 ($expected)"
  } finally {
    Remove-Item $sumsTmp -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Installed octp → $target"

# ── Step 4: PATH ─────────────────────────────────────────────────────────────

$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$pathEntries = $userPath -split ";" | Where-Object { $_ -ne "" }
if ($pathEntries -notcontains $InstallDir) {
  $newPath = ($pathEntries + $InstallDir) -join ";"
  [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
  Write-Host "Added $InstallDir to your user PATH."
  Write-Host ""
  Write-Host "Open a new PowerShell window, then run: octp"
} else {
  Write-Host "$InstallDir is already on your PATH."
  Write-Host ""
  Write-Host "Get started: octp"
}
