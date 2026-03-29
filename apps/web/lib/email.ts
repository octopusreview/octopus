import nodemailer from "nodemailer";
import { writeAuditLog } from "./audit";

export const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  });

  // Fire-and-forget audit log for every email sent
  writeAuditLog({
    action: "email.sent",
    category: "email",
    metadata: { recipient: to, subject: subject.slice(0, 100) },
  }).catch(() => {});
}
