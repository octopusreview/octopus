#!/usr/bin/env bash
# After `bun run app:assemble`, Bun's isolated install pattern leaves
# node_modules/.bun/<pkg>@<ver>/node_modules/<pkg> but no top-level
# node_modules/<pkg>. Databricks Apps workspace upload doesn't preserve
# symlinks, so we COPY (not symlink) each package up to node_modules/<pkg>.
#
# Run after `bun run app:assemble`, before `bundle deploy`.
set -euo pipefail

STAGE="${1:-databricks/app/_stage}"
NM="$STAGE/node_modules"
BUN_DIR="$NM/.bun"
# Next.js standalone trims `.bun/` packages to just what nft saw — but Next
# itself often needs more at runtime (e.g. @swc/helpers/_/...). Source from
# the workspace root's COMPLETE `.bun/` cache instead.
WORKSPACE_BUN="${2:-node_modules/.bun}"

if [[ ! -d "$BUN_DIR" ]]; then
  echo "no $BUN_DIR found — nothing to do" >&2
  exit 0
fi
if [[ ! -d "$WORKSPACE_BUN" ]]; then
  echo "warning: $WORKSPACE_BUN missing — falling back to standalone cache only" >&2
  WORKSPACE_BUN=""
fi

copied=0
for entry in "$BUN_DIR"/*/; do
  pkg_with_ver="$(basename "$entry")"
  pkg="${pkg_with_ver%@*}"
  # Bun encodes scoped packages as `@scope+name`; convert `+` → `/`.
  # Also handle url-encoded `%2F`.
  if [[ "$pkg" == @* ]]; then
    pkg="${pkg/+//}"
  fi
  pkg="${pkg//%2F//}"

  # Prefer the workspace-root copy (complete), fall back to standalone copy (trimmed).
  inner=""
  if [[ -n "$WORKSPACE_BUN" && -d "$WORKSPACE_BUN/$pkg_with_ver/node_modules/$pkg" ]]; then
    inner="$WORKSPACE_BUN/$pkg_with_ver/node_modules/$pkg"
  elif [[ -d "$entry/node_modules/$pkg" ]]; then
    inner="$entry/node_modules/$pkg"
  else
    inner=$(find "$entry/node_modules" -maxdepth 2 -type d -name "$(basename "$pkg")" -print -quit 2>/dev/null || true)
    [[ -z "$inner" ]] && continue
  fi

  target="$NM/$pkg"
  if [[ "$pkg" == *"/"* ]]; then
    mkdir -p "$(dirname "$target")"
  fi
  if [[ -e "$target" && ! -L "$target" ]]; then
    continue  # already a real directory
  fi
  rm -rf "$target"
  cp -R "$inner" "$target"
  copied=$((copied + 1))
done

# Drop .bun/ to save upload size — top-level packages are all we need
rm -rf "$BUN_DIR"

# Repair the broken symlinks that Next.js nft (file-tracing) created inside
# the build output. They point at the deleted .bun/ cache; rewrite each as a
# REAL COPY of the corresponding flattened top-level package. We can't use a
# symlink because Databricks workspace upload doesn't preserve symlinks.
repaired=0
while IFS= read -r broken; do
  [[ -z "$broken" ]] && continue
  # Strip the hash suffix to find the real package name.
  # e.g. `client-27419f76e49cb433` → `client` (under @prisma/)
  parent="$(dirname "$broken")"
  base="$(basename "$broken")"
  # Names look like `<pkg>-<hex>`. Strip a trailing `-<hex>` if present.
  if [[ "$base" =~ ^(.+)-[0-9a-f]{8,}$ ]]; then
    real_name="${BASH_REMATCH[1]}"
  else
    real_name="$base"
  fi
  # Figure out the package path under the top-level _stage/node_modules.
  # If $parent ends with `/@<scope>`, the real pkg is `@<scope>/<real_name>`.
  if [[ "$(basename "$parent")" =~ ^@ ]]; then
    pkg_path="$(basename "$parent")/$real_name"
  else
    pkg_path="$real_name"
  fi
  src="$NM/$pkg_path"
  if [[ -d "$src" ]]; then
    rm -f "$broken"
    cp -R "$src" "$broken"
    repaired=$((repaired + 1))
  else
    # No top-level copy — drop the broken symlink (nft thought it needed this
    # but the package isn't actually used at runtime, or it's a dev dep).
    rm -f "$broken"
  fi
done < <(find "$STAGE" -type l 2>/dev/null)

echo "copied $copied packages, repaired $repaired nft symlinks, removed .bun/ cache"
