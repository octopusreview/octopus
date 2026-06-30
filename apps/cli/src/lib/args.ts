/**
 * Tiny argv helpers shared by the operational commands. apps/cli parses argv
 * by hand (no commander) so each command stays a plain async function; these
 * keep that parsing consistent.
 */

/** Value following `flag` (e.g. `--format json`). Undefined if absent or if the
 * next token is itself a flag. */
export function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("-")) return undefined;
  return v;
}

export function hasFlag(argv: string[], ...flags: string[]): boolean {
  return flags.some((f) => argv.includes(f));
}

/**
 * Positional args — argv entries that are neither a flag nor the value
 * consumed by one of `valueFlags`. Lets a command pull `<key> <value>` out of
 * a mixed argv without a parser library.
 */
export function positionals(argv: string[], valueFlags: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      if (valueFlags.includes(a)) i++; // skip this flag's value
      continue;
    }
    out.push(a);
  }
  return out;
}
