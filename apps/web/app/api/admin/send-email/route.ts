import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { getResend } from "@/lib/resend";
import { renderEmailTemplate } from "@/lib/email-renderer";
import { writeAuditLog } from "@/lib/audit";
import { headers } from "next/headers";
import { buildAudienceWhere } from "./audience";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { slug, audience, cooldownDays } = body;
  const cooldown = typeof cooldownDays === "number" ? cooldownDays : 30;

  if (!slug) {
    return NextResponse.json(
      { error: "Template slug is required" },
      { status: 400 },
    );
  }

  const appUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  const where = buildAudienceWhere(audience || "all");

  // Exclude users who received this template within the cooldown period
  const cooldownDate = new Date(Date.now() - cooldown * 24 * 60 * 60 * 1000);
  const recipients = await prisma.user.findMany({
    where: {
      ...where,
      emailSends: { none: { slug, sentAt: { gte: cooldownDate } } },
    },
    select: { id: true, email: true, name: true },
    take: 500,
  });

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: `No recipients found (everyone already received this email within the last ${cooldown} days)` },
      { status: 400 },
    );
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const firstName = recipient.name.split(" ")[0] || recipient.name;

    const result = await renderEmailTemplate(slug, {
      firstName,
      appUrl,
    });

    if (!result) {
      skipped++;
      continue;
    }

    try {
      await getResend().emails.send({
        from: result.from,
        to: recipient.email,
        subject: result.subject,
        html: result.html,
      });

      // Record the send
      await prisma.emailSend.create({
        data: { slug, userId: recipient.id },
      }).catch(() => {}); // ignore if duplicate

      sent++;
    } catch (err) {
      console.error(
        `[send-email] Failed to send to ${recipient.email}:`,
        err,
      );
      failed++;
    }
  }

  writeAuditLog({
    action: "email.bulk_sent",
    category: "email",
    actorId: session.user.id,
    actorEmail: session.user.email,
    metadata: { slug, audience, sent, failed, skipped, total: recipients.length },
  }).catch(() => {});

  return NextResponse.json({ sent, failed, skipped });
}
