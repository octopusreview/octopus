/**
 * Substitute `{{NAME}}` placeholders in a prompt template with literal
 * string values, in ONE pass.
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
 * Single-pass design: an earlier sequential implementation looped over
 * `vars` and called `out = out.replace(re, ...)` per key. That re-scanned
 * the ENTIRE accumulated string on every pass, so a value containing a
 * later placeholder like `"{{B}}"` got re-expanded on the next iteration —
 * untrusted content could inject substitution sites that the prompt author
 * never wrote. The current implementation builds one regex over the union
 * of all placeholder names and runs a single pass: a `{{B}}` byte sequence
 * inside the value of `{{A}}` is preserved verbatim.
 *
 * Callers: `lib/reviewer.ts` (canonical PR review) and `lib/review-core.ts`
 * (local-review). Both used the same vulnerable pattern before this helper.
 */
export function substitutePromptVars(
  template: string,
  vars: Record<string, string>,
): string {
  const names = Object.keys(vars);
  if (names.length === 0) return template;
  // Sort by length descending so longer placeholder names match first when
  // one name is a prefix of another (e.g. "USER" vs "USER_ID"). Without
  // this, "USER" would steal the leading 4 chars of "USER_ID" matches.
  names.sort((a, b) => b.length - a.length);
  const alternation = names.map(escapeForRegex).join("|");
  const re = new RegExp(`\\{\\{(${alternation})\\}\\}`, "g");
  return template.replace(re, (_match, name: string) => vars[name]);
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
