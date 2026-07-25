/**
 * Stage a Resend Broadcast to opted-in users from an HTML email file.
 *
 * DRY RUN by default: counts recipients and writes nothing. With --create it
 * creates a fresh Resend audience, syncs the opted-in contacts into it, and
 * creates a DRAFT broadcast. It NEVER sends — sending is a manual review + click
 * in the Resend dashboard.
 *
 * Recipients = users with marketingEmailsEnabled = true AND emailVerified = true
 * (consent + a deliverable address). Resend Broadcasts append the unsubscribe
 * link automatically (the template also references {{{RESEND_UNSUBSCRIBE_URL}}}).
 *
 * Runs on the WDC box (the DB is VPN-only). Env: DATABASE_URL, RESEND_API_KEY,
 * EMAIL_FROM, EMAIL_FROM_NAME.
 *
 *   Dry run:  bun run apps/web/scripts/stage-broadcast.ts --html <file> --subject "..."
 *   Create:   bun run apps/web/scripts/stage-broadcast.ts --html <file> --subject "..." --create
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { Resend } from "resend";

/** First token of a display name, or "there" when empty — used for {{{FIRST_NAME}}}. */
export function firstNameOf(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}

/** Mask an email for log output: jane.doe@x.com -> j***@x.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local[0] ?? ""}***@${domain}`;
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resend has a low req/s limit. Run a contact op, retrying on 429 with backoff,
 *  and throttle slightly between calls. Returns the SDK's { data, error } result. */
async function resendOp<T extends { error: unknown }>(op: () => Promise<T>): Promise<T> {
  let res = await op();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const err = res.error as { statusCode?: number; name?: string } | null;
    const rateLimited = err && (err.statusCode === 429 || err.name === "rate_limit_exceeded");
    if (!rateLimited) break;
    await sleep(attempt * 1000);
    res = await op();
  }
  await sleep(60); // ~16 req/s ceiling; stay well under Resend's limit
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const create = args.includes("--create");
  const htmlFile = argVal(args, "--html");
  const subject = argVal(args, "--subject");
  const audienceName = argVal(args, "--audience") ?? "Octopus — opted-in users";

  if (!htmlFile || !subject) {
    throw new Error('Usage: stage-broadcast.ts --html <file> --subject "..." [--audience "..."] [--create]');
  }

  const html = readFileSync(htmlFile, "utf8");
  const recipients = await prisma.user.findMany({
    where: { marketingEmailsEnabled: true, emailVerified: true },
    select: { email: true, name: true },
  });

  console.log(`[stage-broadcast] Mode: ${create ? "CREATE DRAFT" : "DRY RUN (no writes)"}`);
  console.log(`  recipients (marketingEmailsEnabled && emailVerified): ${recipients.length}`);
  console.log(`  subject: ${subject}`);
  console.log(`  html:    ${html.length} chars`);
  for (const r of recipients.slice(0, 5)) console.log(`    - ${maskEmail(r.email)}`);
  if (recipients.length > 5) console.log(`    … and ${recipients.length - 5} more`);

  if (!create) {
    console.log("Dry run — nothing created in Resend. Re-run with --create to stage a DRAFT broadcast.");
    return;
  }
  if (recipients.length === 0) {
    throw new Error("No opted-in recipients — refusing to create an empty broadcast.");
  }

  const key = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Octopus";
  if (!key || !fromEmail) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required to create a broadcast.");
  }
  const resend = new Resend(key);
  const from = `${fromName} <${fromEmail}>`;

  // Reuse a STABLE audience (found by name) so Resend's per-contact unsubscribe
  // state survives across campaigns. A fresh audience each run would re-add
  // everyone as subscribed and silently re-mail people who had opted out.
  const audiences = await resend.audiences.list();
  if (audiences.error) throw new Error(`audiences.list failed: ${JSON.stringify(audiences.error)}`);
  let audienceId = audiences.data?.data?.find((a) => a.name === audienceName)?.id;
  if (audienceId) {
    console.log(`  audience reused: ${audienceId} (${audienceName})`);
  } else {
    const created = await resend.audiences.create({ name: audienceName });
    audienceId = created.data?.id;
    if (created.error || !audienceId) throw new Error(`audiences.create failed: ${JSON.stringify(created.error)}`);
    console.log(`  audience created: ${audienceId} (${audienceName})`);
  }

  // Snapshot existing contacts (paginated) so we never mutate their state.
  const existing = new Map<string, { unsubscribed: boolean }>();
  let after: string | undefined;
  for (;;) {
    const page = await resend.contacts.list({ audienceId, limit: 100, ...(after ? { after } : {}) });
    if (page.error) throw new Error(`contacts.list failed: ${JSON.stringify(page.error)}`);
    const rows = page.data?.data ?? [];
    for (const c of rows) existing.set(c.email.toLowerCase(), { unsubscribed: c.unsubscribed });
    if (!page.data?.has_more || rows.length === 0) break;
    after = rows[rows.length - 1].id;
  }
  const dbSet = new Set(recipients.map((r) => r.email.toLowerCase()));

  // Add only NEW opted-in contacts (subscribed). Existing contacts are left
  // untouched so a prior unsubscribe is preserved.
  let added = 0;
  let addFailed = 0;
  for (const r of recipients) {
    if (existing.has(r.email.toLowerCase())) continue;
    const res = await resendOp(() =>
      resend.contacts.create({
        audienceId,
        email: r.email,
        firstName: firstNameOf(r.name),
        unsubscribed: false,
      }),
    );
    if (res.error) {
      addFailed++;
      if (addFailed <= 10) console.warn(`  ! add ${maskEmail(r.email)}: ${JSON.stringify(res.error)}`);
    } else {
      added++;
    }
    if ((added + addFailed) % 100 === 0) console.log(`  added ${added + addFailed}…`);
  }

  // Honor DB opt-outs: unsubscribe anyone still subscribed in Resend who is no
  // longer in the opted-in set.
  let optedOut = 0;
  let optOutFailed = 0;
  for (const [email, c] of existing) {
    if (dbSet.has(email) || c.unsubscribed) continue;
    const res = await resendOp(() => resend.contacts.update({ audienceId, email, unsubscribed: true }));
    if (res.error) optOutFailed++;
    else optedOut++;
  }

  const skipped = recipients.length - added - addFailed;
  console.log(`  contacts: +${added} added, ${skipped} already present, ${optedOut} unsubscribed (DB opt-out)`);

  // Gate: don't create a broadcast off a badly-synced audience.
  const attempted = added + addFailed + optedOut + optOutFailed;
  const failed = addFailed + optOutFailed;
  if (added === 0 && existing.size === 0) {
    throw new Error("Audience is empty after sync — refusing to create a broadcast.");
  }
  if (failed > 0 && failed > Math.max(5, Math.ceil(attempted * 0.02))) {
    throw new Error(
      `Too many contact-sync failures (${failed}/${attempted}) — aborting before broadcast. Nothing else changed.`,
    );
  }
  if (failed > 0) console.warn(`  note: ${failed} contact op(s) failed but under threshold — continuing.`);

  const b = await resend.broadcasts.create({ audienceId, from, subject, html });
  if (b.error || !b.data?.id) throw new Error(`broadcasts.create failed: ${JSON.stringify(b.error)}`);
  console.log(`✓ DRAFT broadcast created: ${b.data.id}`);
  console.log("  Nothing sent. Review it in the Resend dashboard → Broadcasts, then click Send.");
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
