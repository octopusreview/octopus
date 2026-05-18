import { spawnSync } from "node:child_process";
import { loadCredentials } from "../lib/credentials.js";
import { postJson } from "../lib/api.js";

/**
 * `octp review` — pre-PR review of local changes.
 *
 * Computes a diff of your working tree (or staged-only, or since-ref) and
 * sends it to the Octopus server for review against your org's configured
 * model. Prints findings in the terminal. Optionally exits non-zero so it
 * can plug into pre-commit / lefthook / CI before the PR is even created.
 *
 * This is additive to the cloud PR review — the cloud review still runs
 * for everyone when the PR opens, so coverage isn't gated on a developer
 * having the CLI installed. The local review just cuts the feedback loop
 * for people who do.
 *
 * Lifecycle:
 *   1. Load ~/.octopus/credentials. Exit 2 with hint if not signed in.
 *   2. Compute the diff via `git diff …`. Exit 2 if not a git repo.
 *   3. POST to /api/cli/review-local. Server runs the diff through the
 *      same review pipeline cloud reviews use.
 *   4. Print findings; exit 0 (or 1 if --strict and any critical).
 */

const MAX_DIFF_BYTES = 200 * 1024;

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
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
  truncated?: boolean;
};

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

  // Send to server
  if (verbose) {
    const sizeKb = (diff.length / 1024).toFixed(1);
    console.error(`Reviewing ${sizeKb} KB of diff via ${creds.baseUrl} (${creds.orgName})…`);
  }

  const res = await postJson<ReviewResponse>(
    `${creds.baseUrl}/api/cli/review-local`,
    {
      diff,
      context: {
        branch: gitBranch() ?? undefined,
        baseRef: mode.kind === "since" ? mode.ref : undefined,
      },
    },
    creds.token,
  );
  if (!res.ok) {
    console.error(`Review request failed: ${res.error}`);
    return 1;
  }
  const data = { ...res.data, truncated };

  // Output
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === "markdown") {
    console.log(renderMarkdown(data));
  } else {
    renderHuman(data);
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
    // No upstream and no main/master — just review the working tree changes.
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

function gitBranch(): string | null {
  const r = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return r ? r.trim() : null;
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
  magenta: "\x1b[35m",
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

function renderHuman(data: ReviewResponse): void {
  const { findings, model, provider, usage } = data;
  console.log(
    `${COLOR.bold}🐙 octp review${COLOR.reset}  ${COLOR.dim}${provider}:${model}  ${usage.inputTokens}→${usage.outputTokens} tokens${COLOR.reset}`,
  );
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
  console.log(`${COLOR.bold}${findings.length} finding${findings.length === 1 ? "" : "s"}${COLOR.reset}  ${COLOR.dim}${summary}${COLOR.reset}`);
}

function renderMarkdown(data: ReviewResponse): string {
  const lines: string[] = [];
  lines.push(`# octp review`);
  lines.push("");
  lines.push(`Model: \`${data.provider}:${data.model}\``);
  if (data.truncated) lines.push(`> ⚠ diff was truncated — findings may be incomplete`);
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
  • Reviews use your org's configured default model (Settings → Models).
  • The cloud PR review still runs on every PR — this is additive feedback for
    individual developers before they push. Coverage isn't gated on the CLI.
  • Hard cap of 200 KB diff. Larger diffs get truncated with a warning.
`);
}
