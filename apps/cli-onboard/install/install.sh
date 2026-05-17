#!/usr/bin/env bash
#
# Octopus onboarding installer (Linux / macOS).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli-onboard/install/install.sh | sh
#
# What it does:
#   1. Detects your OS + CPU architecture
#   2. Fetches the latest octp-onboard release from GitHub
#   3. Downloads the matching native binary
#   4. Installs it to ~/.octopus/bin (or $OCTOPUS_INSTALL_DIR)
#   5. Prints a one-line instruction to add ~/.octopus/bin to your PATH (if not already there)
#
# Environment variables:
#   OCTOPUS_INSTALL_DIR  Override install directory (default: $HOME/.octopus/bin)
#   OCTOPUS_INSTALL_REPO Override the GitHub repo (default: octopusreview/octopus)
#   OCTOPUS_INSTALL_TAG  Install a specific tag instead of latest (e.g. cli-onboard-v0.2.0)
#
# Exit codes:
#   0 success
#   1 unsupported OS/arch, network failure, or write failure

set -euo pipefail

REPO="${OCTOPUS_INSTALL_REPO:-octopusreview/octopus}"
INSTALL_DIR="${OCTOPUS_INSTALL_DIR:-$HOME/.octopus/bin}"
BINARY_NAME="octp-onboard"

# ── Step 1: detect platform ──────────────────────────────────────────────────

uname_s=$(uname -s 2>/dev/null || echo "")
uname_m=$(uname -m 2>/dev/null || echo "")

case "$uname_s" in
  Linux)  os="linux"  ;;
  Darwin) os="darwin" ;;
  *)
    echo "Error: unsupported OS: $uname_s" >&2
    echo "Supported: Linux, macOS. On Windows, use install.ps1 (PowerShell)." >&2
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64) arch="x64"   ;;
  arm64|aarch64) arch="arm64" ;;
  *)
    echo "Error: unsupported CPU architecture: $uname_m" >&2
    echo "Supported: x86_64, arm64." >&2
    exit 1
    ;;
esac

asset="${BINARY_NAME}-${os}-${arch}"

# ── Step 2: resolve the release tag ──────────────────────────────────────────

if [ -n "${OCTOPUS_INSTALL_TAG:-}" ]; then
  tag="$OCTOPUS_INSTALL_TAG"
  echo "Installing pinned version: $tag"
else
  echo "Looking up latest octp-onboard release on $REPO ..."
  # Use the GitHub API to find the most recent release whose tag starts with "cli-onboard-v".
  # `jq` is not assumed; parse with grep + sed to keep the installer dependency-free.
  api_url="https://api.github.com/repos/${REPO}/releases?per_page=20"
  tag=$(
    curl -fsSL "$api_url" \
      | grep -E '"tag_name":\s*"cli-onboard-v[^"]+' \
      | head -1 \
      | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/'
  )
  if [ -z "$tag" ]; then
    echo "Error: could not find any cli-onboard-v* release on $REPO." >&2
    echo "If you are testing pre-release, pin a tag with OCTOPUS_INSTALL_TAG=cli-onboard-v0.X.Y" >&2
    exit 1
  fi
  echo "Latest release: $tag"
fi

# ── Step 3: download ─────────────────────────────────────────────────────────

download_url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
echo "Downloading $download_url ..."

mkdir -p "$INSTALL_DIR"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

if ! curl -fL --progress-bar -o "$tmp_file" "$download_url"; then
  echo "Error: failed to download $asset from $tag." >&2
  echo "The release might not have a binary for ${os}-${arch}." >&2
  exit 1
fi

# ── Step 4: install ──────────────────────────────────────────────────────────

target="${INSTALL_DIR}/${BINARY_NAME}"
mv "$tmp_file" "$target"
chmod +x "$target"
trap - EXIT

echo ""
echo "Installed $BINARY_NAME → $target"

# ── Step 5: PATH hint ────────────────────────────────────────────────────────

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "$INSTALL_DIR is already on your PATH."
    echo ""
    echo "Get started: $BINARY_NAME"
    ;;
  *)
    echo ""
    echo "Add this line to your shell rc (~/.zshrc, ~/.bashrc, etc.):"
    echo ""
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""
    echo "Then restart your shell and run: $BINARY_NAME"
    ;;
esac
