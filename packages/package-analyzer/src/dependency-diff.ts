import type { DependencyChange } from "./types";

/**
 * Compare old and new package.json contents, returning the list of
 * added / updated / removed dependencies.
 *
 * Both inputs are raw JSON strings (or null when the file didn't exist).
 */
export function extractDependencyChanges(
  oldContent: string | null,
  newContent: string | null,
  file: string,
): DependencyChange[] {
  const oldPkg = safeParse(oldContent);
  const newPkg = safeParse(newContent);

  if (!oldPkg && !newPkg) return [];

  // File deleted — all deps removed
  if (!newPkg) {
    return [
      ...depsToChanges(oldPkg?.dependencies, "removed", false, file),
      ...depsToChanges(oldPkg?.devDependencies, "removed", true, file),
    ];
  }

  const changes: DependencyChange[] = [];

  compareDeps(oldPkg?.dependencies, newPkg.dependencies, false, file, changes);
  compareDeps(oldPkg?.devDependencies, newPkg.devDependencies, true, file, changes);

  return changes;
}

/**
 * For the "public repo" mode: extract ALL dependencies from a single
 * package.json as if they were all newly added (no base to compare against).
 */
export function extractAllDependencies(
  content: string,
  file: string,
): DependencyChange[] {
  const pkg = safeParse(content);
  if (!pkg) return [];

  return [
    ...depsToChanges(pkg.dependencies, "added", false, file),
    ...depsToChanges(pkg.devDependencies, "added", true, file),
  ];
}

// ── Helpers ──────────────────────────────────────────────────────

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function safeParse(raw: string | null): PkgJson | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PkgJson;
  } catch {
    return null;
  }
}

function depsToChanges(
  deps: Record<string, string> | undefined,
  changeType: DependencyChange["changeType"],
  isDev: boolean,
  file: string,
): DependencyChange[] {
  if (!deps) return [];
  return Object.entries(deps).map(([name, version]) => ({
    name,
    version,
    changeType,
    isDevDependency: isDev,
    file,
  }));
}

function compareDeps(
  oldDeps: Record<string, string> | undefined,
  newDeps: Record<string, string> | undefined,
  isDev: boolean,
  file: string,
  out: DependencyChange[],
) {
  const old = oldDeps ?? {};
  const fresh = newDeps ?? {};

  // Added or updated
  for (const [name, version] of Object.entries(fresh)) {
    if (!(name in old)) {
      out.push({ name, version, changeType: "added", isDevDependency: isDev, file });
    } else if (old[name] !== version) {
      out.push({ name, version, previousVersion: old[name], changeType: "updated", isDevDependency: isDev, file });
    }
  }

  // Removed
  for (const name of Object.keys(old)) {
    if (!(name in fresh)) {
      out.push({ name, version: old[name], changeType: "removed", isDevDependency: isDev, file });
    }
  }
}
