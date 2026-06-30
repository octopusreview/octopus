/**
 * Minimal terminal output helpers — no `chalk`/`ora` dependency, keeping the
 * compiled Bun binary slim (the rest of apps/cli follows the same rule and
 * inlines ANSI in commands/review.ts). Color is auto-disabled when stdout is
 * not a TTY or NO_COLOR is set, so piped/CI output stays clean.
 */

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string, s: string): string {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  bold: (s: string) => paint("1", s),
  dim: (s: string) => paint("2", s),
  red: (s: string) => paint("31", s),
  green: (s: string) => paint("32", s),
  yellow: (s: string) => paint("33", s),
  cyan: (s: string) => paint("36", s),
};

export function success(msg: string): void {
  console.log(`${c.green("✓")} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${c.red("✗")} ${msg}`);
}

export function info(msg: string): void {
  console.log(msg);
}

export function warn(msg: string): void {
  console.error(`${c.yellow("⚠")} ${msg}`);
}

export function heading(title: string): void {
  console.log(`\n${c.bold(title)}`);
}

// Strip ANSI so column widths are measured by VISIBLE length, not byte length —
// otherwise colored cells throw the alignment off.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

/**
 * Strip terminal control sequences from UNTRUSTED text (e.g. streamed LLM
 * output in `octp chat`) before printing — defends against terminal-injection
 * via ANSI/OSC escapes (cursor moves, title rewrites, clipboard writes, etc.).
 * Preserves the visible characters plus newline / carriage-return / tab.
 */
export function sanitizeTerminal(s: string): string {
  return (
    s
      // OSC sequences: ESC ] ... (BEL | ST). These can rewrite the window
      // title or (on some terminals) the clipboard — strip them entirely.
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
      // CSI and charset-select sequences: ESC [ … / ESC ( … etc.
      .replace(/\x1b[[(][0-9;?]*[ -/]*[@-~]/g, "")
      // Any other ESC-introduced two-char sequence.
      .replace(/\x1b./g, "")
      // Remaining C0/C1 controls except \t (09), \n (0a), \r (0d).
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

/**
 * Render a left-aligned text table. `headers` optional; column widths are the
 * max visible width per column. Cells may contain ANSI color codes.
 */
export function table(rows: string[][], headers?: string[]): void {
  const all = headers ? [headers, ...rows] : rows;
  if (all.length === 0) return;
  const cols = Math.max(...all.map((r) => r.length));
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    widths[i] = Math.max(...all.map((r) => visibleLen(r[i] ?? "")));
  }
  const pad = (cell: string, i: number): string =>
    cell + " ".repeat(Math.max(0, widths[i] - visibleLen(cell)));
  const render = (r: string[]) =>
    r.map((cell, i) => pad(cell ?? "", i)).join("  ").trimEnd();
  if (headers) {
    console.log(c.bold(render(headers)));
  }
  for (const r of rows) console.log(render(r));
}
