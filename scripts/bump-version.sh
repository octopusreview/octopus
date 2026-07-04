#!/usr/bin/env bash
# Bump the version in package.json and apps/web/package.json.
# Usage: scripts/bump-version.sh X.Y.Z
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 X.Y.Z" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$ROOT/package.json" "$ROOT/apps/web/package.json"; do
  node -e "const fs=require('fs');const p='$f';const j=JSON.parse(fs.readFileSync(p));j.version='$VERSION';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
  echo "Updated $f -> $VERSION"
done

echo "Now commit, then tag: git tag v$VERSION"
