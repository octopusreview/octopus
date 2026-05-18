/**
 * Strict semver comparator and parser. Pure functions — kept out of
 * `releases.ts` so they can be exercised by Bun tests without dragging
 * the `server-only` import along.
 *
 * Behaviour:
 *   - `compareSemver(a, b)` returns -1 if a<b, 0 if equal, 1 if a>b.
 *   - Throws on invalid main-version parts (non-numeric, more than 3 parts).
 *   - Honours prerelease ranking per semver.org §11:
 *       1.0.0-rc.1 < 1.0.0
 *       1.0.0-alpha < 1.0.0-beta
 *   - Build metadata (after `+`) is stripped before comparison per §10.
 */

export function compareSemver(a: string, b: string): number {
  const ap = parseSemver(a);
  const bp = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (ap.main[i] !== bp.main[i]) return ap.main[i] < bp.main[i] ? -1 : 1;
  }
  if (!ap.pre && bp.pre) return 1;
  if (ap.pre && !bp.pre) return -1;
  if (!ap.pre && !bp.pre) return 0;
  return comparePrerelease(ap.pre!, bp.pre!);
}

function parseSemver(input: string): { main: [number, number, number]; pre: string | null } {
  const trimmed = input.trim().replace(/^v/, "");
  // Strip build metadata first (everything after `+`), THEN split off
  // prerelease at the first `-`. Doing it in this order matters: a prior
  // implementation split on `/[-+]/` and then checked `input.includes("+")`
  // to decide whether to keep `pre`, which silently dropped prerelease
  // info for inputs like `1.0.0-rc.1+build` (treating it as plain `1.0.0`).
  const noBuild = trimmed.split("+")[0];
  const dashIdx = noBuild.indexOf("-");
  const main = dashIdx === -1 ? noBuild : noBuild.slice(0, dashIdx);
  const pre = dashIdx === -1 ? null : noBuild.slice(dashIdx + 1);
  const parts = main.split(".");
  if (parts.length === 0 || parts.length > 3) {
    throw new Error(`Not a semver string: ${input}`);
  }
  const nums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const part = parts[i] ?? "0";
    if (!/^\d+$/.test(part)) throw new Error(`Not a semver string: ${input}`);
    nums[i] = parseInt(part, 10);
  }
  return { main: nums, pre };
}

function comparePrerelease(a: string, b: string): number {
  const ai = a.split(".");
  const bi = b.split(".");
  for (let i = 0; i < Math.max(ai.length, bi.length); i += 1) {
    const ax = ai[i];
    const bx = bi[i];
    if (ax === undefined) return -1;
    if (bx === undefined) return 1;
    const aNum = /^\d+$/.test(ax);
    const bNum = /^\d+$/.test(bx);
    if (aNum && bNum) {
      const an = parseInt(ax, 10);
      const bn = parseInt(bx, 10);
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric < alphanumeric per §11
    } else if (ax !== bx) {
      return ax < bx ? -1 : 1;
    }
  }
  return 0;
}
