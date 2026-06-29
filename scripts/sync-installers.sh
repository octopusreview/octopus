#!/usr/bin/env bash
#
# Sync canonical installer scripts at apps/cli/install/ into
# apps/web/public/ (which Next.js serves at https://<host>/install.sh
# and /install.ps1). The public/ copies carry an AUTO-SYNCED header
# warning humans off direct edits — this script restores the sync.
#
# Usage:
#   scripts/sync-installers.sh
#
# CI runs `scripts/sync-installers.sh --check` and fails on drift.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/apps/cli/install"
PUBLIC_DIR="$REPO_ROOT/apps/web/public"

# Header for the public copy. Lives in a here-doc so multi-line is sane.
read -r -d '' SH_HEADER <<'EOF' || true
# AUTO-SYNCED COPY — DO NOT EDIT DIRECTLY.
# Canonical source: apps/cli/install/install.sh. To update this file, edit
# the canonical source and run `scripts/sync-installers.sh` (or copy by
# hand). A diff against the canonical version fails the CI check in
# .github/workflows/sync-installers-check.yml.
#
EOF

read -r -d '' PS1_HEADER <<'EOF' || true
# AUTO-SYNCED COPY — DO NOT EDIT DIRECTLY.
# Canonical source: apps/cli/install/install.ps1. To update this file, edit
# the canonical source and run `scripts/sync-installers.sh` (or copy by
# hand). A diff against the canonical version fails the CI check in
# .github/workflows/sync-installers-check.yml.
#
EOF

generate_sh() {
  local src="$CLI_DIR/install.sh"
  # Shebang must stay first. Read shebang, emit header, emit rest.
  head -1 "$src"
  printf '%s\n' "$SH_HEADER"
  tail -n +2 "$src"
}

generate_ps1() {
  # No shebang in PowerShell. Header goes at top.
  printf '%s\n' "$PS1_HEADER"
  cat "$CLI_DIR/install.ps1"
}

if [ "${1:-}" = "--check" ]; then
  fail=0
  if ! diff -u <(generate_sh) "$PUBLIC_DIR/install.sh" >/dev/null; then
    echo "Drift detected in apps/web/public/install.sh." >&2
    fail=1
  fi
  if ! diff -u <(generate_ps1) "$PUBLIC_DIR/install.ps1" >/dev/null; then
    echo "Drift detected in apps/web/public/install.ps1." >&2
    fail=1
  fi
  if [ "$fail" = 1 ]; then
    echo "Run scripts/sync-installers.sh to regenerate." >&2
    exit 1
  fi
  echo "Installers in sync."
  exit 0
fi

generate_sh > "$PUBLIC_DIR/install.sh"
generate_ps1 > "$PUBLIC_DIR/install.ps1"
echo "Synced apps/web/public/install.{sh,ps1} ← apps/cli/install/install.{sh,ps1}"
