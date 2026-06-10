/**
 * Substitute `{{NAME}}` placeholders in a prompt template with literal
 * string values.
 *
 * Why this exists: `String.prototype.replace(string, string)` interprets
 * `$&` (whole match), `$'` (suffix), `$\`` (prefix), and `$<name>` in the
 * REPLACEMENT string as substitution patterns. Our replacement values
 * come from indexed repo content, user-supplied PR metadata, translated
 * review-language names, and other untrusted-or-user-shaped strings, all
 * of which can legitimately contain those byte sequences. A `$&` in repo
 * code would otherwise splice in the matched placeholder text — small
 * but real prompt-injection / drift surface.
 *
 * Using the function form of replace (`(_match) => value`) makes the
 * replacement literal. Using a regex with the /g flag also fixes the
 * "first-occurrence only" quirk of `replace(string, string)` — if a
 * template ever uses the same placeholder twice, both get filled.
 *
 * Callers: `lib/reviewer.ts` (canonical PR review) and `lib/review-core.ts`
 * (local-review). Both used the same vulnerable pattern before this helper.
 */
export function substitutePromptVars(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [name, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${escapeForRegex(name)}\\}\\}`, "g");
    out = out.replace(re, () => value);
  }
  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
