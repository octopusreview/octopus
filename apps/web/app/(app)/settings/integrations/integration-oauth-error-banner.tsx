import { IconAlertTriangle } from "@tabler/icons-react";

const OAUTH_ERROR_MESSAGES = {
  state_expired: {
    title: "Connection flow expired",
    description:
      "Start the integration connection again and complete it within 10 minutes.",
  },
  invalid_state: {
    title: "Connection flow could not be verified",
    description:
      "Start the integration connection again from this page in the same browser.",
  },
  forbidden: {
    title: "Connection not permitted",
    description:
      "Sign in with the account that started the integration connection and make sure it has an owner or admin role in the organization, then try again.",
  },
  insufficient_role: {
    title: "Permission required",
    description:
      "Only organization owners and admins can connect integrations. Ask an admin to connect it, or try again once your role is updated.",
  },
} as const;

type OAuthErrorCode = keyof typeof OAUTH_ERROR_MESSAGES;

export function IntegrationOAuthErrorBanner({
  error,
}: {
  error: string | null;
}) {
  if (!error || !Object.hasOwn(OAUTH_ERROR_MESSAGES, error)) return null;

  const content = OAUTH_ERROR_MESSAGES[error as OAuthErrorCode];
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div>
        <p className="font-medium text-foreground">{content.title}</p>
        <p className="mt-0.5 text-muted-foreground">{content.description}</p>
      </div>
    </div>
  );
}
