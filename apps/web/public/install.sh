#!/usr/bin/env bash
# Octopus CLI installer
# Usage: curl -fsSL https://octopus-review.ai/install.sh | bash
set -euo pipefail

GITHUB_REPO="octopusreview/octopus-cli"
BINARY_NAME="octopus"
INSTALL_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.local/bin"

# ─── Helpers ────────────────────────────────────────────────────────────────

info()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
success() { printf '\033[1;32m%s\033[0m\n' "$*"; }
warn()    { printf '\033[1;33m%s\033[0m\n' "$*"; }
error()   { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" > /dev/null 2>&1 || error "Required command '$1' not found. Please install it and retry."
}

# ─── Detect OS & Arch ──────────────────────────────────────────────────────

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) error "Unsupported operating system: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac

  PLATFORM="${os}"
  ARCH="${arch}"
}

# ─── Fetch latest release tag from GitHub ───────────────────────────────────

get_latest_version() {
  need_cmd curl

  local url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
  local response
  response=$(curl -fsSL "$url") || error "Failed to fetch release info from GitHub. You may be rate-limited."

  if command -v jq > /dev/null 2>&1; then
    VERSION=$(echo "$response" | jq -r '.tag_name // empty')
  else
    VERSION=$(echo "$response" | grep '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')
  fi

  if [ -z "$VERSION" ]; then
    error "Could not determine the latest release version. You may be rate-limited by GitHub API."
  fi

  info "Latest version: ${VERSION}"
}

# ─── Download & Install ────────────────────────────────────────────────────

download_and_install() {
  local bin_ext=""
  if [ "$PLATFORM" = "windows" ]; then
    bin_ext=".exe"
  fi

  local artifact="${BINARY_NAME}-${PLATFORM}-${ARCH}"
  local archive="${artifact}.tar.gz"
  local download_url="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/${archive}"

  info "Downloading ${archive}..."
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  local tmparchive="${tmpdir}/${archive}"
  curl -fsSL -o "$tmparchive" "$download_url" || error "Download failed. Check if a release exists for your platform: ${PLATFORM}-${ARCH}"

  # Verify SHA256 checksum if checksums.txt is available
  local checksums_url="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/checksums.txt"
  local expected_sha
  expected_sha=$(curl -fsSL "$checksums_url" 2>/dev/null | grep "${archive}" | awk '{print $1}') || true
  if [ -n "$expected_sha" ]; then
    local actual_sha
    if command -v sha256sum > /dev/null 2>&1; then
      actual_sha=$(sha256sum "$tmparchive" | awk '{print $1}')
    elif command -v shasum > /dev/null 2>&1; then
      actual_sha=$(shasum -a 256 "$tmparchive" | awk '{print $1}')
    fi
    if [ -n "$actual_sha" ] && [ "$expected_sha" != "$actual_sha" ]; then
      error "Checksum mismatch! Expected ${expected_sha}, got ${actual_sha}. Aborting."
    fi
    info "Checksum verified."
  else
    warn "No checksums.txt found for this release -- skipping integrity check."
  fi

  # Extract binary from archive
  tar -xzf "$tmparchive" -C "$tmpdir"
  local tmpfile="${tmpdir}/${BINARY_NAME}${bin_ext}"
  [ -f "$tmpfile" ] || error "Expected binary '${BINARY_NAME}${bin_ext}' not found in archive."
  chmod +x "$tmpfile"

  # Try preferred install dir, fall back to user-local dir
  local target_dir="$INSTALL_DIR"
  if ! install_binary "$tmpfile" "$target_dir" 2>/dev/null; then
    target_dir="$FALLBACK_DIR"
    mkdir -p "$target_dir"
    install_binary "$tmpfile" "$target_dir"
    ensure_in_path "$target_dir"
  fi

  INSTALLED_DIR="$target_dir"
  success "Installed ${BINARY_NAME} to ${target_dir}/${BINARY_NAME}${bin_ext}"
}

install_binary() {
  local src="$1" dir="$2"
  local ext=""
  if [ "$PLATFORM" = "windows" ]; then ext=".exe"; fi

  if [ -w "$dir" ]; then
    cp "$src" "${dir}/${BINARY_NAME}${ext}"
  else
    info "Writing to ${dir} requires elevated permissions..."
    sudo cp "$src" "${dir}/${BINARY_NAME}${ext}"
  fi
}

ensure_in_path() {
  local dir="$1"
  case ":$PATH:" in
    *":${dir}:"*) ;;
    *)
      warn "${dir} is not in your PATH."
      warn "Add this to your shell profile:"
      warn "  export PATH=\"${dir}:\$PATH\""
      ;;
  esac
}

# ─── Skills prompt ──────────────────────────────────────────────────────────

prompt_install_skills() {
  # If running non-interactively (piped), skip prompt
  if [ ! -t 0 ]; then
    info ""
    info "To install skills later, run: octopus skills install --all"
    return
  fi

  echo ""
  printf 'Would you like to install Octopus skills for Claude Code? (y/N) '
  read -r answer
  case "$answer" in
    [yY]|[yY][eE][sS])
      info "Installing skills..."
      "${INSTALLED_DIR}/${BINARY_NAME}" skills install --all \
        || warn "Could not install skills automatically. Run 'octopus skills install --all' after logging in."
      ;;
    *)
      info "Skipped. You can install skills later with: octopus skills install --all"
      ;;
  esac
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  echo ""
  info "  Octopus CLI Installer"
  info "  ====================="
  echo ""

  detect_platform
  info "Detected platform: ${PLATFORM}-${ARCH}"

  get_latest_version
  download_and_install
  prompt_install_skills

  echo ""
  success "Done! Get started with:"
  success "  octopus login"
  echo ""
}

main