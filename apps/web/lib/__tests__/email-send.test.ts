import { beforeEach, describe, expect, it, mock } from "bun:test";

// Transporter smoke test for the nodemailer v9 bump: intercept createTransport
// and assert lib/email.ts wires the transport from env and passes the message
// shape sendMail expects. Guards the createTransport/sendMail API surface we
// actually use (no v9 types are published yet — @types/nodemailer is 8.x).
const sendMailMock = mock(() => Promise.resolve({ messageId: "test" }));
const createTransportMock = mock(() => ({ sendMail: sendMailMock }));

mock.module("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransportMock(...args) },
}));
mock.module("@/lib/audit", () => ({
  writeAuditLog: () => Promise.resolve(),
}));

process.env.EMAIL_HOST = "smtp.test";
process.env.EMAIL_PORT = "587";
process.env.EMAIL_SECURE = "false";
process.env.EMAIL_USER = "u";
process.env.EMAIL_PASSWORD = "p";
process.env.EMAIL_FROM = "noreply@test";
process.env.EMAIL_FROM_NAME = "Octopus";

const { sendEmail } = await import("@/lib/email");

describe("email transporter (nodemailer v9 surface)", () => {
  beforeEach(() => sendMailMock.mockClear());

  it("builds the transport from env with the v9 createTransport options shape", () => {
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    const opts = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.host).toBe("smtp.test");
    expect(opts.port).toBe(587);
    expect(opts.secure).toBe(false);
    expect(opts.auth).toEqual({ user: "u", pass: "p" });
  });

  it("sends with the from/to/subject/html message shape", async () => {
    await sendEmail({ to: "dev@example.com", subject: "hi", html: "<b>hi</b>" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const msg = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(msg.from).toBe('"Octopus" <noreply@test>');
    expect(msg.to).toBe("dev@example.com");
    expect(msg.subject).toBe("hi");
    expect(msg.html).toBe("<b>hi</b>");
    expect(msg).not.toHaveProperty("raw");
  });
});
