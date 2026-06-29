#!/usr/bin/env bash
# AUTO-SYNCED COPY — DO NOT EDIT DIRECTLY.
# Canonical source: apps/cli/install/install.sh. To update this file, edit
# the canonical source and run `scripts/sync-installers.sh` (or copy by
# hand). A diff against the canonical version fails the CI check in
# .github/workflows/sync-installers-check.yml.
#
#
# Octopus CLI installer (Linux / macOS).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli/install/install.sh | bash
#
# The script's shebang is /usr/bin/env bash and it uses bash-isms
# (set -o pipefail, `[[...]]` would-be patterns) — piping into `sh`
# can break on dash/ash. Documented `| bash` accordingly.
#
# What it does:
#   1. Detects your OS + CPU architecture
#   2. Fetches the latest `octp-v*` release from GitHub
#   3. Downloads the matching native binary
#   4. Installs it to ~/.octopus/bin/octp (or $OCTOPUS_INSTALL_DIR)
#   5. Prints a one-line instruction to add ~/.octopus/bin to your PATH (if not already there)
#
# After install, run `octp` to launch the first-run onboarding wizard.
#
# Environment variables:
#   OCTOPUS_INSTALL_DIR  Override install directory (default: $HOME/.octopus/bin)
#   OCTOPUS_INSTALL_REPO Override the GitHub repo (default: octopusreview/octopus)
#   OCTOPUS_INSTALL_TAG  Install a specific tag instead of latest (e.g. octp-v0.2.0)
#
# Exit codes:
#   0 success
#   1 unsupported OS/arch, network failure, or write failure

set -euo pipefail

REPO="${OCTOPUS_INSTALL_REPO:-octopusreview/octopus}"
INSTALL_DIR="${OCTOPUS_INSTALL_DIR:-$HOME/.octopus/bin}"
BINARY_NAME="octp"

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
  echo "Looking up latest octp release on $REPO ..."
  # Find the most recent NON-DRAFT, NON-PRERELEASE octp-v* tag.
  # `jq` is not assumed (some minimal install targets — alpine, distroless,
  # CI runners — don't have it), so parse with sed/grep. GitHub returns
  # `/releases` as a JSON ARRAY where each release is one object on the
  # same line. We split objects by inserting a real newline at every
  # `},{` boundary so line-oriented grep can filter by draft/prerelease
  # siblings without false-matching across objects.
  #
  # macOS portability: BSD sed treats `\n` in the REPLACEMENT as a
  # literal `n` (only the recognise-`\n`-in-pattern semantics is shared
  # with GNU sed). Use the portable form — a backslash immediately
  # followed by a real newline character inside the s/// replacement,
  # which both GNU and BSD sed interpret as a newline. The `[[:space:]]`
  # POSIX class is used everywhere else for the same portability reason
  # (GNU `\s` would silently match "s" on busybox grep / BSD sed).
  # Users testing prerelease tags can still override via OCTOPUS_INSTALL_TAG.
  api_url="https://api.github.com/repos/${REPO}/releases?per_page=30"
  tag=$(
    curl -fsSL "$api_url" \
      | sed 's/},{/}\
{/g' \
      | grep -v '"draft"[[:space:]]*:[[:space:]]*true' \
      | grep -v '"prerelease"[[:space:]]*:[[:space:]]*true' \
      | grep -E '"tag_name"[[:space:]]*:[[:space:]]*"octp-v' \
      | head -1 \
      | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
  )
  if [ -z "$tag" ]; then
    echo "Error: could not find any non-prerelease octp-v* on $REPO." >&2
    echo "If you are testing a prerelease, pin a tag with OCTOPUS_INSTALL_TAG=octp-v0.X.Y" >&2
    exit 1
  fi
  echo "Latest release: $tag"
fi

# ── Step 3: download ─────────────────────────────────────────────────────────

download_url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
sums_url="https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS.txt"
echo "Downloading $download_url ..."

mkdir -p "$INSTALL_DIR"
tmp_file="$(mktemp)"
sums_file="$(mktemp)"
trap 'rm -f "$tmp_file" "$sums_file"' EXIT

if ! curl -fL --progress-bar -o "$tmp_file" "$download_url"; then
  echo "Error: failed to download $asset from $tag." >&2
  echo "The release might not have a binary for ${os}-${arch}." >&2
  exit 1
fi

# ── Step 3b: verify SHA256 checksum ──────────────────────────────────────────
# octp-release.yml generates SHA256SUMS.txt and attaches it to every release.
# Verifying the binary against the published sum protects against:
#   - In-flight tampering on a compromised mirror (GitHub itself signs the
#     download but the asset chain is still worth re-checking).
#   - Truncated downloads (curl exit code is the only signal otherwise).
# If sums file is missing on a release (older builds), we abort with a clear
# message — passing OCTOPUS_INSTALL_SKIP_VERIFY=1 documents the trade-off
# explicitly when the user knowingly accepts the risk (e.g. CI pinning a tag
# pre-dating the sums-generation workflow).

if [ "${OCTOPUS_INSTALL_SKIP_VERIFY:-0}" = "1" ]; then
  echo "SKIPPING SHA256 verification (OCTOPUS_INSTALL_SKIP_VERIFY=1)."
else
  if curl -fsSL -o "$sums_file" "$sums_url"; then
    expected=$(grep -F "  $asset" "$sums_file" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')
    if [ -z "$expected" ]; then
      echo "Error: no SHA256SUMS.txt entry for $asset on $tag." >&2
      echo "Run with OCTOPUS_INSTALL_SKIP_VERIFY=1 to bypass (NOT recommended)." >&2
      exit 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
      actual=$(sha256sum "$tmp_file" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')
    elif command -v shasum >/dev/null 2>&1; then
      actual=$(shasum -a 256 "$tmp_file" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')
    else
      echo "Error: neither sha256sum nor shasum found; cannot verify the download." >&2
      echo "Run with OCTOPUS_INSTALL_SKIP_VERIFY=1 to bypass (NOT recommended)." >&2
      exit 1
    fi
    if [ "$expected" != "$actual" ]; then
      echo "Error: SHA256 mismatch for $asset." >&2
      echo "  expected: $expected" >&2
      echo "  actual:   $actual" >&2
      echo "The download may be corrupt or tampered. Aborting." >&2
      exit 1
    fi
    echo "✓ Verified SHA256 ($expected)"
  else
    echo "Error: could not download SHA256SUMS.txt from $tag." >&2
    echo "Older releases pre-date the sums workflow — re-run with" >&2
    echo "OCTOPUS_INSTALL_SKIP_VERIFY=1 if you accept that risk." >&2
    exit 1
  fi
fi

# ── Step 4: install ──────────────────────────────────────────────────────────

target="${INSTALL_DIR}/${BINARY_NAME}"
# Keep the EXIT trap active across the move so a failed mv (bad perms / missing
# INSTALL_DIR) still cleans up $tmp_file instead of leaking it.
if ! mv "$tmp_file" "$target"; then
  echo "Error: failed to install to $target (check permissions / INSTALL_DIR)." >&2
  exit 1
fi
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
