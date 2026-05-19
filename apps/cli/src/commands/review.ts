import { spawnSync } from "node:child_process";
import { loadCredentials } from "../lib/credentials.js";
import { loadConfig } from "../lib/config.js";
import { getJson, postJson } from "../lib/api.js";

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
  // registered, we use the context-aware path. If not (or if there's no
  // git remote at all), we fall through to bare mode — lower quality but
  // doesn't force the user to install the GitHub App just to use the CLI.
  const remoteUrl = gitRemoteUrl();
  let repoMatch: RepoMatch | null = null;
  if (!remoteUrl) {
    // No remote configured. Bare mode is still useful (eg. unpublished
    // personal repo, scratch repo). Always log this — silent quality
    // downgrade is the bug the bot called out.
    console.error(
      "No git remote configured — falling back to bare mode (no codebase context). " +
        "Connect the repo on github/gitlab/bitbucket and via /settings/integrations for context-aware reviews.",
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
      // Expected case: the remote isn't connected to Octopus. Silent
      // fall-through; the renderer surfaces the caveat.
    } else {
      // Unexpected: server hiccup, 401, etc. Falling to bare mode would
      // silently downgrade review quality without the user knowing —
      // surface the error so they can decide whether to retry. Always
      // logged (not gated on --verbose).
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
  --verbose, -v                      Log progress to stderr
  --help, -h                         This help

Notes:
  • If the repo is connected to Octopus (Settings → Integrations), reviews
    use the canonical pipeline with codebase context, finding capping, and
    your repo's reviewConfig — same as cloud PR reviews.
  • If the repo isn't connected, falls back to "bare mode" — same LLM
    call but no codebase context. Lower quality; an inline note tells
    you when it happens.
  • The cloud PR review still runs on every PR — this is additive feedback
    for individual developers before they push.
  • Hard cap of 500 KB diff. Larger diffs get truncated with a warning.
`);
}
