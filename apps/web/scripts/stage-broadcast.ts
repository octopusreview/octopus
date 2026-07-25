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
import { prisma } from "@octopus/db";
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

async function main() {
  const args = process.argv.slice(2);
  const create = args.includes("--create");
  const htmlFile = argVal(args, "--html");
  const subject = argVal(args, "--subject");
  const audienceName = argVal(args, "--audience") ?? "Octopus — opted-in users";

  if (!htmlFile || !subject) {
    console.error('Usage: stage-broadcast.ts --html <file> --subject "..." [--audience "..."] [--create]');
    process.exit(1);
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
    console.error("No opted-in recipients — refusing to create an empty broadcast.");
    process.exit(1);
  }

  const key = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "Octopus";
  if (!key || !fromEmail) {
    console.error("RESEND_API_KEY and EMAIL_FROM are required to create a broadcast.");
    process.exit(1);
  }
  const resend = new Resend(key);
  const from = `${fromName} <${fromEmail}>`;

  // Fresh audience per campaign so a re-run never sends to stale/duplicate lists.
  const aud = await resend.audiences.create({ name: `${audienceName} — ${subject}` });
  const audienceId = aud.data?.id;
  if (aud.error || !audienceId) throw new Error(`audiences.create failed: ${JSON.stringify(aud.error)}`);
  console.log(`  audience: ${audienceId}`);

  let ok = 0;
  let failed = 0;
  for (const r of recipients) {
    const res = await resend.contacts.create({
      audienceId,
      email: r.email,
      firstName: firstNameOf(r.name),
      unsubscribed: false,
    });
    if (res.error) {
      failed++;
      if (failed <= 10) console.warn(`  ! contact ${maskEmail(r.email)}: ${JSON.stringify(res.error)}`);
    } else {
      ok++;
    }
    if ((ok + failed) % 100 === 0) console.log(`  synced ${ok + failed}/${recipients.length}`);
  }
  console.log(`  contacts: ${ok} added, ${failed} failed`);

  const b = await resend.broadcasts.create({ audienceId, from, subject, html });
  if (b.error || !b.data?.id) throw new Error(`broadcasts.create failed: ${JSON.stringify(b.error)}`);
  console.log(`✓ DRAFT broadcast created: ${b.data.id}`);
  console.log("  Nothing sent. Review it in the Resend dashboard → Broadcasts, then click Send.");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
