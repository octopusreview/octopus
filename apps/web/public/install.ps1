#Requires -Version 6.0
# Octopus CLI installer for Windows (requires PowerShell 6+ / PowerShell Core)
# Usage: irm https://octopus-review.ai/install.ps1 | iex
$ErrorActionPreference = "Stop"

$GITHUB_REPO = "octopusreview/octopus-cli"
$BINARY_NAME = "octopus"
$INSTALL_DIR = "$env:USERPROFILE\.octopus\bin"

# ─── Helpers ────────────────────────────────────────────────────────────────

function Write-Info    { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Err     { param($msg) Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

# ─── Detect Architecture ───────────────────────────────────────────────────

function Get-Arch {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64"   { return "x64" }
        "Arm64" { return "arm64" }
        default { Write-Err "Unsupported architecture: $arch" }
    }
}

# ─── Get Latest Release ────────────────────────────────────────────────────

function Get-LatestVersion {
    $url = "https://api.github.com/repos/$GITHUB_REPO/releases/latest"
    try {
        $release = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "octopus-installer" }
        $version = $release.tag_name
        if (-not $version) { Write-Err "Could not determine latest version." }
        Write-Info "Latest version: $version"
        return $version
    } catch {
        Write-Err "Failed to fetch latest release: $_"
    }
}

# ─── Download & Install ────────────────────────────────────────────────────

function Install-Octopus {
    param($arch)
    $version = Get-LatestVersion

    $artifact = "$BINARY_NAME-windows-$arch.exe"
    $downloadUrl = "https://github.com/$GITHUB_REPO/releases/download/$version/$artifact"

    Write-Info "Downloading $artifact..."

    # Ensure install directory exists
    if (-not (Test-Path $INSTALL_DIR)) {
        New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    }

    $destination = Join-Path $INSTALL_DIR "$BINARY_NAME.exe"

    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destination -UseBasicParsing
    } catch {
        Write-Err "Download failed. Check if a release exists for windows-$arch. Error: $_"
    }

    # Verify SHA256 checksum if checksums.txt is available
    $checksumsUrl = "https://github.com/$GITHUB_REPO/releases/download/$version/checksums.txt"
    try {
        $checksums = Invoke-RestMethod -Uri $checksumsUrl -Headers @{ "User-Agent" = "octopus-installer" }
        $expectedLine = $checksums -split "`n" | Where-Object { $_ -match $artifact }
        if ($expectedLine) {
            $expectedSha = ($expectedLine -split "\s+")[0]
            $actualSha = (Get-FileHash -Path $destination -Algorithm SHA256).Hash.ToLower()
            if ($expectedSha -ne $actualSha) {
                Remove-Item $destination -Force
                Write-Err "Checksum mismatch! Expected $expectedSha, got $actualSha. Aborting."
            }
            Write-Info "Checksum verified."
        }
    } catch {
        Write-Warn "No checksums.txt found for this release — skipping integrity check."
    }

    Write-Success "Installed $BINARY_NAME to $destination"

    # Add to PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$INSTALL_DIR*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$INSTALL_DIR", "User")
        $env:Path = "$env:Path;$INSTALL_DIR"
        Write-Info "Added $INSTALL_DIR to your PATH."
    }
}

# ─── Skills Prompt ──────────────────────────────────────────────────────────

function Prompt-InstallSkills {
    Write-Host ""
    $answer = Read-Host "Would you like to install Octopus skills for Claude Code? (y/N)"
    if ($answer -match "^[yY]") {
        Write-Info "Installing skills..."
        try {
            & (Join-Path $INSTALL_DIR "$BINARY_NAME.exe") skills install --all
        } catch {
            Write-Warn "Could not install skills automatically. Run 'octopus skills install --all' after logging in."
        }
    } else {
        Write-Info "Skipped. You can install skills later with: octopus skills install --all"
    }
}

# ─── Main ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Info "  Octopus CLI Installer"
Write-Info "  ====================="
Write-Host ""

$arch = Get-Arch
Write-Info "Detected platform: windows-$arch"

Install-Octopus -arch $arch
Prompt-InstallSkills

Write-Host ""
Write-Success "Done! Get started with:"
Write-Success "  octopus login"
Write-Host ""