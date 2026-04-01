import { Resend } from "resend";

const globalForResend = globalThis as unknown as { resend?: Resend };

export function getResend(): Resend {
  if (!globalForResend.resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    globalForResend.resend = new Resend(process.env.RESEND_API_KEY);
  }
  return globalForResend.resend;
}
