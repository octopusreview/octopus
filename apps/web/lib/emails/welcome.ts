import { prisma } from "@octopus/db";
import { getResend } from "../resend";
import { renderEmailTemplate } from "../email-renderer";
import { writeAuditLog } from "../audit";

const APP_URL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

interface WelcomeEmailData {
  userId: string;
  email: string;
  name: string;
}

export async function sendWelcomeEmail({
  userId,
  email,
  name,
}: WelcomeEmailData): Promise<void> {
  // Skip if already sent
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { welcomeEmailSentAt: true },
  });

  if (user?.welcomeEmailSentAt) {
    console.log(`[welcome-email] Already sent to ${email}, skipping`);
    return;
  }

  const firstName = name.split(" ")[0] || name;

  const result = await renderEmailTemplate("welcome", {
    firstName,
    appUrl: APP_URL,
  }, { userId });

  if (!result) {
    console.warn("[welcome-email] Template disabled or missing, skipping");
    return;
  }

  const { error } = await getResend().emails.send({
    from: result.from,
    to: email,
    subject: result.subject,
    html: result.html,
  });

  if (error) {
    throw new Error(`Failed to send welcome email: ${error.message}`);
  }

  // Mark as sent
  await prisma.user.update({
    where: { id: userId },
    data: { welcomeEmailSentAt: new Date() },
  });

  writeAuditLog({
    action: "email.welcome_sent",
    category: "email",
    actorId: userId,
    actorEmail: email,
    targetType: "user",
    targetId: userId,
  }).catch(() => {});

  console.log(`[welcome-email] Sent to ${email}`);
}
