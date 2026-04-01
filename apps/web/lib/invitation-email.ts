import { sendEmail } from "./email";
import { renderEmailTemplate } from "./email-renderer";

const APP_URL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

export async function sendInvitationEmail({
  email,
  token,
  organizationName,
  inviterName,
  role,
}: {
  email: string;
  token: string;
  organizationName: string;
  inviterName: string;
  role: string;
}) {
  const acceptUrl = `${APP_URL}/api/invitations/${token}/accept`;
  const declineUrl = `${APP_URL}/api/invitations/${token}/decline`;

  const result = await renderEmailTemplate("invitation", {
    inviterName,
    organizationName,
    role,
    acceptUrl,
    declineUrl,
  });

  if (!result) {
    // Fallback if template missing
    await sendEmail({
      to: email,
      subject: `You've been invited to join ${organizationName} on Octopus`,
      html: `<p>${inviterName} has invited you to join ${organizationName}. <a href="${acceptUrl}">Accept</a></p>`,
    });
    return;
  }

  await sendEmail({
    to: email,
    subject: result.subject,
    html: result.html,
  });
}
