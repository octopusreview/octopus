// STUB: Resend transactional email disabled for Databricks demo deployment.
// The exported getResend() returns a fake client whose .emails.send() logs instead.
// Re-enable by setting FEATURES_EMAIL=true and RESEND_API_KEY.

const emailEnabled = process.env.FEATURES_EMAIL === "true";

type SendArgs = {
  from?: string;
  to?: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  [key: string]: unknown;
};

type StubResend = {
  emails: {
    send: (args: SendArgs) => Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  };
};

let _resend: StubResend | null = null;

export function getResend(): StubResend {
  if (_resend) return _resend;
  if (!emailEnabled) {
    _resend = {
      emails: {
        send: async (args) => {
          console.log(
            `[resend-stub] to=${JSON.stringify(args.to)} subject="${args.subject}"`,
          );
          return { data: { id: `stub-${Date.now()}` }, error: null };
        },
      },
    };
    return _resend;
  }
  throw new Error(
    "FEATURES_EMAIL=true but the resend stub is in use. Restore lib/resend.ts to send real emails.",
  );
}
