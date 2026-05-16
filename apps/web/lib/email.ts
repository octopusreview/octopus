// STUB: Email sending disabled for Databricks demo deployment.
// All emails are logged to console; audit log writes preserved for telemetry.
// Re-enable by setting FEATURES_EMAIL=true and SMTP env vars (EMAIL_HOST, etc.).
import nodemailer, { type Transporter } from "nodemailer";
import { writeAuditLog } from "./audit";

const emailEnabled = process.env.FEATURES_EMAIL === "true";

export const transporter: Transporter | null = emailEnabled
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    })
  : null;

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!emailEnabled || !transporter) {
    console.log(
      `[email-stub] to=${to} subject="${subject}" html.length=${html.length}`,
    );
  } else {
    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });
  }

  // Audit log preserved in both stub and real-send paths.
  writeAuditLog({
    action: "email.sent",
    category: "email",
    metadata: { recipient: to, subject: subject.slice(0, 100), stubbed: !emailEnabled },
  }).catch(() => {});
}
