import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { loadCredentials } from "../lib/credentials.js";
import { loadConfig } from "../lib/config.js";
import { getJson, postJson } from "../lib/api.js";
import { ensureRepoIndexed } from "../lib/local-index.js";

/**
 * `octp review` — pre-PR review of local changes.
 *
 * Computes a diff of your working tree (or staged-only, or since-ref),
 * resolves the current git remote to a registered Octopus repository,
 * and posts the diff to the existing /api/cli/repos/<id>/local-review
 * endpoint — the same one the canonical review pipeline uses. The
 * server runs the diff through `generateLocalReview` which includes
 * context search against the indexed repo, two-pass review, finding
 * capping, and the operation-tagged ai_usage row.
 *
 * Local-only mode (no registered repo) is intentionally NOT supported:
 * the review quality without indexed context is materially worse and
 * we don't want a feature with two reliability tiers. If the repo
 * isn't registered, surface a clear "register it first" message.
 *
 * Additive to the cloud PR review — the cloud review still runs on
 * every PR when it opens, so coverage isn't gated on the CLI being
 * installed. This is just the fast individual-dev feedback loop.
 */

const MAX_DIFF_BYTES = 500 * 1024; // matches the server cap on /local-review
// CLI-side timeout on the review request. Without this the CLI hangs
// indefinitely if the server's LLM call stalls (eg. Ollama daemon down,
// or a long context-building step). 5 min is generous enough for the
// largest real reviews; override with OCTP_REVIEW_TIMEOUT_MS for outliers.
const REVIEW_TIMEOUT_MS = Number(process.env.OCTP_REVIEW_TIMEOUT_MS ?? 5 * 60_000);

type Finding = {
  severity: string;
  title: string;
  filePath: string;
  startLine: number;
  endLine: number;
  category: string;
  description: string;
  suggestion: string;
  confidence: number;
  whyTestsDoNotAlreadyCoverThis?: string;
  suggestedRegressionTest?: string;
  minimumFixScope?: string;
};

type ReviewResponse = {
  findings: Finding[];
  summary?: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Server flag — true when the bare (no-repo-context) path was used. */
  bareMode?: boolean;
};

type RepoMatch = { id: string; fullName: string; provider: string };

type ReviewMode =
  | { kind: "default" } // upstream..HEAD plus uncommitted
  | { kind: "staged" }
  | { kind: "since"; ref: string };

export async function reviewCommand(argv: string[]): Promise<number> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error(
      "No credentials. Run `octp` to sign in first, or `octp onboard` to redo the wizard.",
    );
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const mode = parseMode(argv);
  if (!mode) return 2;

  const strict = argv.includes("--strict");
  const format = (flagValue(argv, "--format") ?? "human") as "human" | "json" | "markdown";
  if (!["human", "json", "markdown"].includes(format)) {
    console.error(`Unknown --format: ${format}. Use human | json | markdown.`);
    return 2;
  }
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const indexFlag = argv.includes("--index");
  const noIndexFlag = argv.includes("--no-index");
  if (indexFlag && noIndexFlag) {
    console.error("--index and --no-index are mutually exclusive.");
    return 2;
  }

  // Compute the diff
  const diffResult = computeDiff(mode);
  if (!diffResult.ok) {
    console.error(diffResult.error);
    return 2;
  }
  let diff = diffResult.diff;
  let truncated = false;
  if (diff.length > MAX_DIFF_BYTES) {
    if (verbose) {
      console.error(
        `Diff is ${diff.length} bytes — truncating to ${MAX_DIFF_BYTES} so it fits the review budget.`,
      );
    }
    diff = diff.slice(0, MAX_DIFF_BYTES);
    truncated = true;
  }
  if (diff.trim().length === 0) {
    if (format === "human") console.log("No changes to review.");
    return 0;
  }

  // Try to resolve the git remote → Octopus repo id. If the repo is
  // registered, we use the context-aware path. If not, offer to index
  // the working tree locally (CLI uploads files; server embeds + stores
  // in qdrant) so the next review — and this one — gets codebase context
  // without requiring the GitHub App install. The bare-mode fallback
  // remains for "no remote at all" and "user declined indexing."
  const remoteUrl = gitRemoteUrl();
  let repoMatch: RepoMatch | null = null;
  if (!remoteUrl) {
    console.error(
      "No git remote configured — falling back to bare mode (no codebase context). " +
        "Add a remote and re-run to index this repo for context-aware reviews.",
    );
  } else {
    if (verbose) console.error(`Resolving repo for ${remoteUrl}…`);
    const resolveRes = await getJson<RepoMatch>(
      `${creds.baseUrl}/api/cli/repos/by-remote?url=${encodeURIComponent(remoteUrl)}`,
      { headers: { authorization: `Bearer ${creds.token}` } },
    );
    if (resolveRes.ok) {
      repoMatch = resolveRes.data;
    } else if (resolveRes.status === 404) {
      // Repo isn't connected yet. Offer to index the working tree (or
      // auto-index when --index is passed). Skipping (--no-index or "n"
      // at the prompt) falls through to bare mode like the old behaviour.
      const decision = await decideIndex({
        autoYes: indexFlag,
        autoNo: noIndexFlag,
        baseUrl: creds.baseUrl,
      });
      if (decision === "yes") {
        console.error(
          `\nIndexing working tree for context-aware reviews. ` +
            `This sends file contents to ${creds.baseUrl} — same trust ` +
            `boundary as cloud PR reviews. Skip with --no-index.\n`,
        );
        const indexResult = await ensureRepoIndexed(creds, remoteUrl, process.cwd(), {
          tty: Boolean(process.stderr.isTTY),
        });
        if (indexResult.ok) {
          // Either we just indexed (kind: "indexed") or the server told us
          // the repo is already managed via the platform install
          // (kind: "platform-managed"). Both cases want the canonical
          // review path against an existing repoId, so a single by-remote
          // re-fetch covers them — no caller-side branching needed.
          repoMatch = await refetchRepoMatch(creds, remoteUrl, verbose);
          if (!repoMatch) {
            // shouldn't happen — but if it does, fall back to bare mode
            // rather than crashing.
            console.error(
              "Index step succeeded but the repo couldn't be resolved by-remote. Continuing in bare mode.",
            );
          } else if (verbose) {
            console.error(`Indexed — now reviewing against ${repoMatch.fullName}.`);
          }
        } else if (indexResult.reason === "timeout") {
          console.error(
            "Indexing is still running on the server (timed out after 10 min). " +
              "Continuing in bare mode for this run — re-run `octp review` later for context-aware output.",
          );
        } else {
          console.error(
            `Indexing failed (${indexResult.error}). Continuing in bare mode for this run.`,
          );
        }
      }
      // decision === "no" → silent fallthrough to bare mode (renderer
      // surfaces the caveat in the output banner).
    } else {
      console.error(
        `Could not check whether this repo is connected to Octopus ` +
          `(HTTP ${resolveRes.status}: ${resolveRes.error}). ` +
          `Falling back to bare mode — review quality will be lower than usual.`,
      );
    }
  }

  // Honour the wizard's model pick if it set one. The server's
  // `getReviewModel` chain only considers repo/org/platform defaults, not
  // anything saved to ~/.octopus/config.json. Without this pass-through,
  // a user who picked Ollama in the wizard would still get hit by whatever
  // the org default is (often missing API key → 500).
  const localConfig = await loadConfig();
  const modelOverride = localConfig.model || undefined;
  if (modelOverride && verbose) {
    console.error(`Using locally-configured model: ${modelOverride}`);
  }

  if (verbose) {
    const sizeKb = (diff.length / 1024).toFixed(1);
    if (repoMatch) {
      console.error(`Reviewing ${sizeKb} KB of diff against ${repoMatch.fullName}…`);
    } else {
      console.error(`Reviewing ${sizeKb} KB of diff in bare mode (no repo context)…`);
    }
  }

  const endpoint = repoMatch
    ? `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repoMatch.id)}/local-review`
    : `${creds.baseUrl}/api/cli/review-local`;

  if (verbose) {
    const mins = (REVIEW_TIMEOUT_MS / 60_000).toFixed(0);
    console.error(`Request timeout: ${mins} min (override with OCTP_REVIEW_TIMEOUT_MS)`);
  }
  const res = await postJson<ReviewResponse>(
    endpoint,
    {
      diff,
      title: commitSubject() ?? undefined,
      author: gitAuthorName() ?? undefined,
      model: modelOverride,
    },
    creds.token,
    { timeoutMs: REVIEW_TIMEOUT_MS },
  );
  if (!res.ok) {
    if (res.status === 402) {
      console.error(
        "Monthly spend limit reached for this org. Adjust in /settings/billing or wait until next cycle.",
      );
    } else if (res.status === 422) {
      // ReviewConfigError on the server — message is safe to show and
      // is actionable (set API key, pick a model, start Ollama, etc.).
      console.error(res.error);
    } else if (res.status === 0) {
      // Timeout / network failure from the CLI side. Already prefixed
      // "Request timed out — …" in api.ts when it's an abort.
      console.error(res.error);
    } else {
      // Server returns a generic message in production and a "<generic>:
      // <real error>" form in development — same wrapper either way.
      console.error(`Review request failed (HTTP ${res.status}): ${res.error}`);
    }
    return 1;
  }
  const data = { ...res.data, truncated };

  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === "markdown") {
    console.log(renderMarkdown(data));
  } else {
    renderHuman(data, repoMatch?.fullName ?? "(bare mode, no repo context)");
  }

  if (strict) {
    const criticalCount = data.findings.filter((f) => isCritical(f.severity)).length;
    if (criticalCount > 0) return 1;
  }
  return 0;
}

// ── Indexing prompt ──────────────────────────────────────────────────────────

/**
 * Decide whether to offer (or skip) the local-indexing flow when the repo
 * isn't yet connected. Order of precedence:
 *   1. --no-index flag → "no" (script-friendly: never prompt, never index)
 *   2. --index flag → "yes" (script-friendly: always index without prompt)
 *   3. stdin not a TTY → "no" (CI/scripts: don't hang waiting for input)
 *   4. interactive → ask the user; default depends on `baseUrl`
 *
 * The default on bare Enter depends on whether the configured server is
 * reachable only from the local machine / private network:
 *   - localhost / 127.x.x.x / ::1 / *.local / RFC1918 IPs → default "yes".
 *     There's no data egress beyond what the user already controls, so
 *     the prompt is just a heads-up about the action.
 *   - anything else (cloud / public host) → default "no". This is a
 *     one-way upload of working-tree contents (untracked-but-unignored
 *     secrets, proprietary code) that we don't want to exfiltrate on
 *     an accidental Enter.
 *
 * The flag-driven paths (`--index`, `--no-index`) are unaffected by the
 * host classification.
 */
async function decideIndex(opts: {
  autoYes: boolean;
  autoNo: boolean;
  baseUrl: string;
}): Promise<"yes" | "no"> {
  if (opts.autoNo) return "no";
  if (opts.autoYes) return "yes";
  if (!process.stdin.isTTY) return "no";

  const local = isLocalServer(opts.baseUrl);
  const yesLabel = local ? "[Y]" : "[y]";
  const noLabel = local ? "[n]" : "[N]";
  const def = local ? "Y" : "N";
  const hostHint = local ? ` (local server — ${opts.baseUrl})` : "";

  process.stderr.write(
    "\nThis repo isn't indexed in Octopus yet.\n" +
      `Index it now for context-aware reviews? Files are uploaded to your Octopus server${hostHint}.\n` +
      `  ${yesLabel} yes   ${noLabel} no, just review the diff in bare mode   (default: ${def})\n> `,
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    // `once("line")` and `once("close")` race — the loser stays registered
    // unless explicitly removed. Without the off() calls, the listener that
    // didn't fire leaks until the process exits, and a future close fires
    // a no-op handler (or worse, if we later re-use rl).
    const answer = await new Promise<string>((resolveAnswer) => {
      const onLine = (s: string) => {
        rl.off("close", onClose);
        resolveAnswer(s);
      };
      const onClose = () => {
        rl.off("line", onLine);
        resolveAnswer("");
      };
      rl.once("line", onLine);
      rl.once("close", onClose);
    });
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") return local ? "yes" : "no";
    return trimmed[0] === "y" ? "yes" : "no";
  } finally {
    rl.close();
  }
}

/**
 * Treat the server as "local" (and therefore safe to default to indexing on)
 * when it's reachable only from the same machine / private LAN. The
 * classification is conservative — any URL we can't parse, or any public
 * hostname, gets treated as non-local so default-no applies.
 *
 * Covered:
 *   - hostname `localhost` (any case)
 *   - IPv4 loopback `127.0.0.0/8`
 *   - IPv6 loopback `::1`
 *   - mDNS `*.local` hostnames
 *   - RFC1918 private IPv4 (10/8, 172.16/12, 192.168/16)
 *   - IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
 */
export function isLocalServer(baseUrl: string): boolean {
  let host: string;
  try {
    const u = new URL(baseUrl);
    host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "::1" || host === "::") return true;
  if (host.endsWith(".local")) return true;
  // IPv4
  const v4 = host.split(".");
  if (v4.length === 4 && v4.every((p) => /^\d+$/.test(p))) {
    const [a, b] = v4.map(Number);
    // 0.0.0.0 is the wildcard bind address — a `baseUrl` pointing at it
    // can only mean "this machine", same as 127.x.
    if (a === 0 && b === 0 && v4[2] === "0" && v4[3] === "0") return true;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  // IPv6 — rough prefix match for link-local / unique-local. `fe80:` alone
  // catches both the compressed (`fe80::1`) and uncompressed forms because
  // both share the same leading 5 chars.
  if (host.startsWith("fe80:")) return true;
  if (/^f[cd]/.test(host)) return true;
  return false;
}

async function refetchRepoMatch(
  creds: { baseUrl: string; token: string },
  remoteUrl: string,
  verbose: boolean,
): Promise<RepoMatch | null> {
  const res = await getJson<RepoMatch>(
    `${creds.baseUrl}/api/cli/repos/by-remote?url=${encodeURIComponent(remoteUrl)}`,
    { headers: { authorization: `Bearer ${creds.token}` } },
  );
  if (res.ok) return res.data;
  if (verbose) {
    console.error(`by-remote re-fetch failed: HTTP ${res.status} — ${res.error}`);
  }
  return null;
}

// ── Flag parsing ─────────────────────────────────────────────────────────────

function parseMode(argv: string[]): ReviewMode | null {
  if (argv.includes("--staged")) return { kind: "staged" };
  const since = flagValue(argv, "--since");
  if (since) return { kind: "since", ref: since };
  return { kind: "default" };
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("-")) return undefined;
  return v;
}

// ── Git ──────────────────────────────────────────────────────────────────────

function computeDiff(mode: ReviewMode): { ok: true; diff: string } | { ok: false; error: string } {
  if (!isGitRepo()) {
    return {
      ok: false,
      error:
        "Not a git repository. Run `octp review` from inside a repo, or `cd` into one first.",
    };
  }
  if (mode.kind === "staged") {
    return { ok: true, diff: git(["diff", "--staged"]) ?? "" };
  }
  if (mode.kind === "since") {
    const tree = git(["diff", `${mode.ref}..HEAD`]) ?? "";
    const uncommitted = git(["diff"]) ?? "";
    return { ok: true, diff: combine(tree, uncommitted) };
  }
  // default: upstream..HEAD plus uncommitted. Fall through to main/master
  // when there's no upstream tracking branch (common right after `git init`
  // or for branches not yet pushed).
  const upstream =
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) ??
    git(["rev-parse", "--abbrev-ref", "main"]) ??
    git(["rev-parse", "--abbrev-ref", "master"]);
  if (!upstream) {
    return { ok: true, diff: git(["diff", "HEAD"]) ?? "" };
  }
  const base = git(["merge-base", upstream.trim(), "HEAD"]);
  if (!base) {
    return { ok: true, diff: git(["diff", "HEAD"]) ?? "" };
  }
  const tree = git(["diff", `${base.trim()}..HEAD`]) ?? "";
  const uncommitted = git(["diff"]) ?? "";
  return { ok: true, diff: combine(tree, uncommitted) };
}

function combine(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}\n${b}`;
}

function isGitRepo(): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "true";
}

function git(args: string[]): string | null {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout;
}

function gitRemoteUrl(): string | null {
  // Prefer "origin"; fall back to the first remote we can find.
  const origin = git(["remote", "get-url", "origin"]);
  if (origin) return origin.trim();
  const remotes = git(["remote"]);
  const first = remotes?.split("\n").map((s) => s.trim()).filter(Boolean)[0];
  if (!first) return null;
  return git(["remote", "get-url", first])?.trim() ?? null;
}

function commitSubject(): string | null {
  return git(["log", "-1", "--pretty=%s"])?.trim() ?? null;
}

function gitAuthorName(): string | null {
  return git(["config", "user.name"])?.trim() ?? null;
}

// ── Output renderers ─────────────────────────────────────────────────────────

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
};

function isCritical(severity: string): boolean {
  return /critical|🔴/i.test(severity);
}

function severityGlyph(severity: string): string {
  const s = severity.toLowerCase();
  if (s.includes("critical") || severity.includes("🔴")) return "🔴";
  if (s.includes("high") || severity.includes("🟠")) return "🟠";
  if (s.includes("medium") || severity.includes("🟡")) return "🟡";
  if (s.includes("low") || severity.includes("🔵")) return "🔵";
  return "💡";
}

type RenderedData = ReviewResponse & { truncated?: boolean };

function renderHuman(data: RenderedData, repoFullName: string): void {
  const { findings, model, usage } = data;
  console.log(
    `${COLOR.bold}🐙 octp review${COLOR.reset}  ${COLOR.dim}${repoFullName} · ${model} · ${usage.inputTokens}→${usage.outputTokens} tokens${COLOR.reset}`,
  );
  if (data.bareMode) {
    console.log(
      `${COLOR.yellow}ℹ bare mode — no codebase context. Connect the repo at /settings/integrations for higher-quality reviews.${COLOR.reset}`,
    );
  }
  if (data.truncated) {
    console.log(
      `${COLOR.yellow}⚠ diff truncated to ${(MAX_DIFF_BYTES / 1024).toFixed(0)} KB — findings may be incomplete${COLOR.reset}`,
    );
  }
  if (findings.length === 0) {
    console.log(`${COLOR.green}✓ no findings${COLOR.reset}`);
    return;
  }
  console.log("");
  for (const f of findings) {
    console.log(
      `${severityGlyph(f.severity)} ${COLOR.bold}${f.severity}${COLOR.reset}  ${COLOR.cyan}${f.filePath}:${f.startLine}${COLOR.reset}`,
    );
    console.log(`  ${COLOR.bold}${f.title}${COLOR.reset}`);
    console.log(`  ${f.description}`);
    if (f.suggestion) console.log(`  ${COLOR.dim}suggestion:${COLOR.reset} ${f.suggestion}`);
    if (f.suggestedRegressionTest)
      console.log(`  ${COLOR.dim}test:${COLOR.reset} ${f.suggestedRegressionTest}`);
    console.log("");
  }
  const buckets: Record<string, number> = {};
  for (const f of findings) {
    const g = severityGlyph(f.severity);
    buckets[g] = (buckets[g] ?? 0) + 1;
  }
  const summary = Object.entries(buckets)
    .map(([g, n]) => `${n} ${g}`)
    .join(" · ");
  console.log(
    `${COLOR.bold}${findings.length} finding${findings.length === 1 ? "" : "s"}${COLOR.reset}  ${COLOR.dim}${summary}${COLOR.reset}`,
  );
}

function renderMarkdown(data: RenderedData): string {
  const lines: string[] = [];
  lines.push(`# octp review`);
  lines.push("");
  lines.push(`Model: \`${data.model}\``);
  if (data.truncated) lines.push(`> ⚠ diff was truncated — findings may be incomplete`);
  if (data.summary) {
    lines.push("");
    lines.push(data.summary);
  }
  lines.push("");
  if (data.findings.length === 0) {
    lines.push("✓ no findings");
    return lines.join("\n");
  }
  for (const f of data.findings) {
    lines.push(`## ${severityGlyph(f.severity)} ${f.title}`);
    lines.push("");
    lines.push(`**File:** \`${f.filePath}:${f.startLine}\`  `);
    lines.push(`**Severity:** ${f.severity}  `);
    if (f.category) lines.push(`**Category:** ${f.category}  `);
    lines.push("");
    lines.push(f.description);
    if (f.suggestion) {
      lines.push("");
      lines.push(`**Suggestion:** ${f.suggestion}`);
    }
    if (f.suggestedRegressionTest) {
      lines.push("");
      lines.push(`**Test idea:** ${f.suggestedRegressionTest}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`octp review — pre-PR review of local changes

Usage:
  octp review                        Review upstream..HEAD plus uncommitted changes
  octp review --staged               Review only \`git diff --staged\` output
  octp review --since <ref>          Review since a given ref (eg. HEAD~3, main)

Flags:
  --strict                           Exit 1 if any critical (🔴) findings — for pre-commit hooks
  --format <human|json|markdown>     Output format (default: human)
  --index                            Index the working tree now without prompting (script-friendly)
  --no-index                         Skip the index prompt — always review in bare mode
  --verbose, -v                      Log progress to stderr
  --help, -h                         This help

Notes:
  • If the repo is connected to Octopus (Settings → Integrations), reviews
    use the canonical pipeline with codebase context, finding capping, and
    your repo's reviewConfig — same as cloud PR reviews.
  • If the repo isn't connected, you'll be prompted to index the working
    tree (files are uploaded to your Octopus server). The bare-Enter
    default is "yes" for local servers (localhost / private LAN) and
    "no" for public hosts. Once indexed, subsequent reviews use the
    same context-aware path as cloud reviews.
  • Decline the index prompt (or pass --no-index) to review in "bare mode"
    instead — same LLM call but no codebase context.
  • The cloud PR review still runs on every PR — this is additive feedback
    for individual developers before they push.
  • Hard cap of 500 KB diff. Larger diffs get truncated with a warning.
`);
}
