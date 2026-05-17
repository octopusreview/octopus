# Octopus onboarding installer (Windows / PowerShell).
#
# Usage:
#   irm https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli-onboard/install/install.ps1 | iex
#
# What it does:
#   1. Detects your CPU architecture
#   2. Fetches the latest octp-onboard release from GitHub
#   3. Downloads the matching native .exe
#   4. Installs it to $env:USERPROFILE\.octopus\bin (or $env:OCTOPUS_INSTALL_DIR)
#   5. Adds the install directory to your user PATH (idempotent)
#
# Environment variables:
#   $env:OCTOPUS_INSTALL_DIR   Override install directory
#   $env:OCTOPUS_INSTALL_REPO  Override the GitHub repo (default: octopusreview/octopus)
#   $env:OCTOPUS_INSTALL_TAG   Install a specific tag instead of latest

$ErrorActionPreference = "Stop"

$Repo        = if ($env:OCTOPUS_INSTALL_REPO) { $env:OCTOPUS_INSTALL_REPO } else { "octopusreview/octopus" }
$InstallDir  = if ($env:OCTOPUS_INSTALL_DIR)  { $env:OCTOPUS_INSTALL_DIR }  else { Join-Path $env:USERPROFILE ".octopus\bin" }
$BinaryName  = "octp-onboard.exe"

# ── Step 1: arch ─────────────────────────────────────────────────────────────

# We only ship x64 today. ARM64 Windows can fall back to x64 emulation; if a
# native ARM64 build is added later, expand this map.
$arch = "x64"
$asset = "octp-onboard-windows-${arch}.exe"

# ── Step 2: resolve release tag ──────────────────────────────────────────────

if ($env:OCTOPUS_INSTALL_TAG) {
  $tag = $env:OCTOPUS_INSTALL_TAG
  Write-Host "Installing pinned version: $tag"
} else {
  Write-Host "Looking up latest octp-onboard release on $Repo ..."
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=20" -Headers @{ "User-Agent" = "octp-onboard-installer" }
  $tag = ($releases | Where-Object { $_.tag_name -like "cli-onboard-v*" } | Select-Object -First 1).tag_name
  if (-not $tag) {
    Write-Error "Could not find any cli-onboard-v* release on $Repo. Pin a tag with `$env:OCTOPUS_INSTALL_TAG = 'cli-onboard-v0.X.Y'`."
    exit 1
  }
  Write-Host "Latest release: $tag"
}

# ── Step 3: download ─────────────────────────────────────────────────────────

$downloadUrl = "https://github.com/$Repo/releases/download/$tag/$asset"
Write-Host "Downloading $downloadUrl ..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$target = Join-Path $InstallDir $BinaryName

try {
  Invoke-WebRequest -Uri $downloadUrl -OutFile $target -UseBasicParsing
} catch {
  Write-Error "Failed to download $asset from $tag. The release might not have a Windows binary."
  exit 1
}

Write-Host ""
Write-Host "Installed octp-onboard → $target"

# ── Step 4: PATH ─────────────────────────────────────────────────────────────

$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$pathEntries = $userPath -split ";" | Where-Object { $_ -ne "" }
if ($pathEntries -notcontains $InstallDir) {
  $newPath = ($pathEntries + $InstallDir) -join ";"
  [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
  Write-Host "Added $InstallDir to your user PATH."
  Write-Host ""
  Write-Host "Open a new PowerShell window, then run: octp-onboard"
} else {
  Write-Host "$InstallDir is already on your PATH."
  Write-Host ""
  Write-Host "Get started: octp-onboard"
}
