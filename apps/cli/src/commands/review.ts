import { spawnSync } from "node:child_process";
import { loadCredentials } from "../lib/credentials.js";
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

  // Resolve the git remote → Octopus repo id
  const remoteUrl = gitRemoteUrl();
  if (!remoteUrl) {
    console.error(
      "No git remote configured. Add a remote (`git remote add origin <url>`) and push the repo to GitHub/GitLab/Bitbucket first, then connect it via /settings/integrations.",
    );
    return 2;
  }
  if (verbose) console.error(`Resolving repo for ${remoteUrl}…`);
  const resolveRes = await getJson<RepoMatch>(
    `${creds.baseUrl}/api/cli/repos/by-remote?url=${encodeURIComponent(remoteUrl)}`,
    { headers: { authorization: `Bearer ${creds.token}` } },
  );
  if (!resolveRes.ok) {
    if (resolveRes.status === 404) {
      console.error(
        `${remoteUrl} isn't registered with Octopus in org "${creds.orgName}". ` +
          `Open /settings/integrations on ${creds.baseUrl} and connect the repo first.`,
      );
    } else {
      console.error(`Could not resolve repo: ${resolveRes.error}`);
    }
    return 1;
  }
  if (verbose) {
    const sizeKb = (diff.length / 1024).toFixed(1);
    console.error(`Reviewing ${sizeKb} KB of diff against ${resolveRes.data.fullName}…`);
  }

  // Hit the canonical local-review endpoint
  const res = await postJson<ReviewResponse>(
    `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(resolveRes.data.id)}/local-review`,
    {
      diff,
      title: commitSubject() ?? undefined,
      author: gitAuthorName() ?? undefined,
    },
    creds.token,
  );
  if (!res.ok) {
    if (res.status === 402) {
      console.error(
        "Monthly spend limit reached for this org. Adjust in /settings/billing or wait until next cycle.",
      );
    } else {
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
    renderHuman(data, resolveRes.data.fullName);
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
  • Uses the same review pipeline as cloud PR reviews — context search,
    finding capping, your repo's reviewConfig, the works.
  • Requires the repo to be connected to Octopus (Settings → Integrations).
  • The cloud PR review still runs on every PR — this is additive feedback
    for individual developers before they push. Coverage isn't gated on
    the CLI being installed.
  • Hard cap of 500 KB diff. Larger diffs get truncated with a warning.
`);
}
