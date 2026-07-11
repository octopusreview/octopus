import { createInterface } from "node:readline";
import { loadCredentials } from "../lib/credentials.js";
import { getJson, isTransportSafe, postJson } from "../lib/api.js";
import { sanitizeTerminal } from "../lib/output.js";

/**
 * `octp admin` — operator-only commands against the /api/admin/* endpoints.
 *
 * Auth is deliberately NOT the customer device-flow token (that is org-scoped):
 * these endpoints are gated by the server's ADMIN_API_SECRET, supplied here
 * via OCTOPUS_ADMIN_SECRET (or ADMIN_API_SECRET) in the environment. The base
 * URL falls back to the signed-in credentials' baseUrl so self-hosted
 * operators get the right default without extra flags.
 *
 * Subcommands:
 *   octp admin incidents [--since 3h] [--match 429]
 *   octp admin incidents notify --incident-key <key> [--since 3h] [--match 429]
 *        [--credits 5] [--summary "…"] [--template slug] [--send] [--yes] [--force]
 *   octp admin credits grant --org <slug|id> --amount 10 --reason "…" [--yes] [--force]
 *
 * `incidents notify` is dry-run unless --send is passed, and --send asks for
 * an interactive confirmation unless --yes is passed. The server enforces the
 * same dry-run default and the per-org credit cap independently.
 */

const NOTIFY_TIMEOUT_MS = 5 * 60_000; // bulk email sends can be slow

interface AdminContext {
  baseUrl: string;
  secret: string;
}

type Recipient = { email: string; name: string };

interface AffectedOrg {
  orgId: string;
  orgSlug: string;
  orgName: string;
  failedCount: number;
  firstFailureAt: string;
  lastFailureAt: string;
  repositories: string[];
  errors: string[];
  recipients: Recipient[];
}

interface FailedReviewsResponse {
  since: string;
  until: string;
  match: string | null;
  totals: { orgs: number; failedReviews: number };
  orgs: AffectedOrg[];
}

interface OrgOutcome {
  orgSlug: string;
  orgName: string;
  failedCount: number;
  recipients: string[];
  creditUsd: number;
  action: "planned" | "sent" | "skipped" | "error";
  reason?: string;
}

interface NotifyResponse {
  dryRun: boolean;
  incidentKey: string;
  /** The window start the server resolved, as ISO — reused verbatim for the live send. */
  since: string;
  orgs: OrgOutcome[];
  totals: { orgs: number; emails: number; creditUsd: number };
}

interface GrantResponse {
  org: { id: string; slug: string; name: string };
  granted: number;
  balance: { free: number; purchased: number; total: number };
}

function printAdminHelp(): void {
  console.log(`octp admin — operator commands (requires OCTOPUS_ADMIN_SECRET)

Usage:
  octp admin incidents [--since 3h] [--match 429]
      List orgs with failed reviews in the window, with admin recipients.

  octp admin incidents notify --incident-key <key> [options]
      Email affected orgs' owners/admins + optionally grant free credits.
      Dry-run by default; add --send to execute (asks to confirm).
      --since <3h|45m|2d|ISO>   window (default 3h, max 30d)
      --match <text>            only failures whose error contains <text>
      --credits <usd>           free credits per org (default 0, cap $50)
      --summary <text>          one-line cause shown in the email
      --template <slug>         email template (default incident-resolved)
      --send                    actually send (otherwise dry-run)
      --yes                     skip the interactive confirmation
      --force                   allow credits above the cap

  octp admin credits grant --org <slug|id> --amount <usd> --reason <text> [--yes] [--force]
      One-off goodwill grant to a single org's free-credit balance.

Common flags:
  --url <base>                  API base (default: OCTOPUS_ADMIN_URL, then your
                                signed-in baseUrl from ~/.octopus/credentials)
  --insecure                    Allow sending the admin secret over cleartext
                                HTTP to a non-local host (not recommended)
`);
}

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

async function resolveContext(argv: string[]): Promise<AdminContext | null> {
  const secret = process.env.OCTOPUS_ADMIN_SECRET || process.env.ADMIN_API_SECRET;
  if (!secret) {
    console.error("No admin secret. Set OCTOPUS_ADMIN_SECRET to the server's ADMIN_API_SECRET.");
    return null;
  }

  let baseUrl = getFlag(argv, "--url") || process.env.OCTOPUS_ADMIN_URL;
  if (!baseUrl) {
    const creds = await loadCredentials();
    baseUrl = creds?.baseUrl;
  }
  if (!baseUrl) {
    console.error("No API base URL. Pass --url, set OCTOPUS_ADMIN_URL, or sign in with `octp` first.");
    return null;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  // The admin secret is strictly more sensitive than a customer token (it
  // grants mass-email + credit-granting) — same cleartext guard as login.ts.
  if (!isTransportSafe(cleanBase) && !argv.includes("--insecure")) {
    console.error("Refusing to send the admin secret over cleartext HTTP to a non-local host.");
    console.error("Use an https URL (or a loopback / private-LAN host), or pass --insecure to override.");
    return null;
  }

  return { baseUrl: cleanBase, secret };
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("Refusing to send without a TTY confirmation — pass --yes to override.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  return answer.trim() === "SEND";
}

function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) => iso.replace("T", " ").slice(0, 16);
  return `${fmt(startIso)} → ${fmt(endIso)} UTC`;
}

// All org/repo/error strings below are server-provided (and error text can
// echo upstream API responses) — sanitize before they reach the terminal.
function printOrgTable(orgs: AffectedOrg[]): void {
  for (const org of orgs) {
    console.log(`\n  ${sanitizeTerminal(org.orgName)} (${sanitizeTerminal(org.orgSlug)})`);
    console.log(`    failed reviews : ${org.failedCount}  [${formatWindow(org.firstFailureAt, org.lastFailureAt)}]`);
    console.log(`    repositories   : ${sanitizeTerminal(org.repositories.join(", "))}`);
    console.log(`    recipients     : ${sanitizeTerminal(org.recipients.map((r) => r.email).join(", ")) || "(none — would be skipped)"}`);
    for (const err of org.errors) {
      console.log(`    error          : ${sanitizeTerminal(err)}`);
    }
  }
}

function printOutcomes(result: NotifyResponse): void {
  for (const org of result.orgs) {
    const credit = org.creditUsd > 0 ? ` +$${org.creditUsd.toFixed(2)}` : "";
    const reason = org.reason ? ` — ${sanitizeTerminal(org.reason)}` : "";
    console.log(`  [${org.action.toUpperCase().padEnd(7)}] ${sanitizeTerminal(org.orgSlug)} (${org.failedCount} failed, ${org.recipients.length} recipient(s)${credit})${reason}`);
  }
  console.log(
    `\n  Totals: ${result.totals.orgs} org(s), ${result.totals.emails} email(s), $${result.totals.creditUsd.toFixed(2)} credits${result.dryRun ? "  [DRY RUN]" : ""}`,
  );
}

async function incidentsList(argv: string[], ctx: AdminContext): Promise<number> {
  const since = getFlag(argv, "--since") ?? "3h";
  const match = getFlag(argv, "--match");
  const qs = new URLSearchParams({ since });
  if (match) qs.set("match", match);

  const res = await getJson<FailedReviewsResponse>(
    `${ctx.baseUrl}/api/admin/incidents/failed-reviews?${qs}`,
    { headers: { authorization: `Bearer ${ctx.secret}` } },
  );
  if (!res.ok) {
    console.error(`Failed (HTTP ${res.status}): ${res.error}`);
    return 1;
  }

  const { totals, orgs } = res.data;
  console.log(
    `Failed reviews since ${res.data.since}${match ? ` matching "${match}"` : ""}: ${totals.failedReviews} across ${totals.orgs} org(s)`,
  );
  if (orgs.length > 0) printOrgTable(orgs);
  return 0;
}

async function incidentsNotify(argv: string[], ctx: AdminContext): Promise<number> {
  const incidentKey = getFlag(argv, "--incident-key");
  if (!incidentKey) {
    console.error("Missing --incident-key (e.g. openai-429-2026-07-11). It is the idempotency key: re-runs with the same key never re-email an org.");
    return 2;
  }

  const creditsRaw = getFlag(argv, "--credits");
  const creditUsd = creditsRaw === undefined ? 0 : Number(creditsRaw);
  if (Number.isNaN(creditUsd) || creditUsd < 0) {
    console.error(`Invalid --credits value: ${creditsRaw}`);
    return 2;
  }

  const payload = {
    incidentKey,
    since: getFlag(argv, "--since") ?? "3h",
    match: getFlag(argv, "--match"),
    template: getFlag(argv, "--template"),
    summary: getFlag(argv, "--summary"),
    creditUsd,
    force: argv.includes("--force"),
  };

  // Always dry-run first so the operator sees the exact blast radius.
  const dry = await postJson<NotifyResponse>(
    `${ctx.baseUrl}/api/admin/incidents/notify`,
    { ...payload, dryRun: true },
    ctx.secret,
    { timeoutMs: NOTIFY_TIMEOUT_MS },
  );
  if (!dry.ok) {
    console.error(`Dry run failed (HTTP ${dry.status}): ${dry.error}`);
    return 1;
  }

  console.log(`Incident "${incidentKey}" — plan:\n`);
  printOutcomes(dry.data);

  if (!argv.includes("--send")) {
    console.log("\nDry run only. Re-run with --send to execute.");
    return 0;
  }
  if (dry.data.totals.orgs === 0) {
    console.log("\nNothing to send.");
    return 0;
  }

  if (!argv.includes("--yes")) {
    const ok = await confirm(
      `\nSend ${dry.data.totals.emails} email(s) and grant $${dry.data.totals.creditUsd.toFixed(2)} across ${dry.data.totals.orgs} org(s)? Type SEND to proceed: `,
    );
    if (!ok) {
      console.log("Aborted.");
      return 1;
    }
  }

  // Pin the live send to the exact window the operator just approved — a
  // relative --since would re-resolve at send time and could pull in orgs
  // that failed after the plan was printed.
  const live = await postJson<NotifyResponse>(
    `${ctx.baseUrl}/api/admin/incidents/notify`,
    { ...payload, since: dry.data.since, dryRun: false },
    ctx.secret,
    { timeoutMs: NOTIFY_TIMEOUT_MS },
  );
  if (!live.ok) {
    console.error(`Send failed (HTTP ${live.status}): ${live.error}`);
    return 1;
  }

  console.log("\nResult:\n");
  printOutcomes(live.data);
  return live.data.orgs.some((o) => o.action === "error") ? 1 : 0;
}

async function creditsGrant(argv: string[], ctx: AdminContext): Promise<number> {
  const org = getFlag(argv, "--org");
  const amountRaw = getFlag(argv, "--amount");
  const reason = getFlag(argv, "--reason");
  if (!org || !amountRaw || !reason) {
    console.error("Usage: octp admin credits grant --org <slug|id> --amount <usd> --reason <text> [--yes] [--force]");
    return 2;
  }
  const amountUsd = Number(amountRaw);
  if (Number.isNaN(amountUsd) || amountUsd <= 0) {
    console.error(`Invalid --amount value: ${amountRaw}`);
    return 2;
  }

  if (!argv.includes("--yes")) {
    const ok = await confirm(
      `Grant $${amountUsd.toFixed(2)} free credits to "${org}" (${reason})? Type SEND to proceed: `,
    );
    if (!ok) {
      console.log("Aborted.");
      return 1;
    }
  }

  const res = await postJson<GrantResponse>(
    `${ctx.baseUrl}/api/admin/credits/grant`,
    { org, amountUsd, reason, force: argv.includes("--force") },
    ctx.secret,
  );
  if (!res.ok) {
    console.error(`Grant failed (HTTP ${res.status}): ${res.error}`);
    return 1;
  }

  const { balance } = res.data;
  console.log(
    `Granted $${res.data.granted.toFixed(2)} to ${sanitizeTerminal(res.data.org.slug)}. Balance: $${balance.free.toFixed(2)} free + $${balance.purchased.toFixed(2)} purchased = $${balance.total.toFixed(2)}.`,
  );
  return 0;
}

export async function adminCommand(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printAdminHelp();
    return argv.length === 0 ? 2 : 0;
  }

  const ctx = await resolveContext(argv);
  if (!ctx) return 2;

  const sub = argv[0];
  if (sub === "incidents") {
    if (argv[1] === "notify") return await incidentsNotify(argv.slice(2), ctx);
    return await incidentsList(argv.slice(1), ctx);
  }
  if (sub === "credits") {
    if (argv[1] === "grant") return await creditsGrant(argv.slice(2), ctx);
    console.error(`Unknown credits subcommand: ${argv[1] ?? "(none)"}`);
    console.error("Try: octp admin credits grant --help");
    return 2;
  }

  console.error(`Unknown admin subcommand: ${sub}`);
  printAdminHelp();
  return 2;
}
