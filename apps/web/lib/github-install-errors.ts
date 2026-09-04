/**
 * GitHub App install/connect error codes surfaced on /settings/integrations
 * (?error=<code>), with their titles and messages.
 *
 * Two audiences read these: self-host operators, who can act on configuration
 * hints, and Octopus Cloud customers, who cannot. Codes that describe OUR
 * misconfiguration are rewritten for cloud so a customer is never told to add
 * client IDs or callback URLs (that copy caused a support ticket after the
 * install verification step shipped without its credentials in production).
 */
export type GitHubInstallErrorCode =
  | "installation_already_bound"
  | "invalid_installation_id"
  | "missing_state"
  | "invalid_state_bad_signature"
  | "invalid_state_expired"
  | "invalid_state_malformed"
  | "replay_detected"
  | "state_store_unavailable"
  | "session_required"
  | "state_user_mismatch"
  | "state_browser_mismatch"
  | "github_app_not_configured"
  | "github_verification_not_configured"
  | "github_authorization_denied"
  | "github_authorization_failed"
  | "installation_not_accessible"
  | "not_a_member"
  | "manifest_forbidden"
  | "manifest_already_configured"
  | "manifest_bad_org"
  | "manifest_expired"
  | "manifest_failed"

export const ERROR_TITLES: Record<GitHubInstallErrorCode, string> = {
  installation_already_bound: "Already connected elsewhere",
  invalid_installation_id: "Invalid installation",
  missing_state: "Install flow interrupted",
  invalid_state_bad_signature: "Install flow could not be verified",
  invalid_state_expired: "Install flow expired",
  invalid_state_malformed: "Install flow could not be verified",
  replay_detected: "Install link already used",
  state_store_unavailable: "Install verification unavailable",
  session_required: "Sign-in required",
  state_user_mismatch: "Install session changed",
  state_browser_mismatch: "Install browser could not be verified",
  github_app_not_configured: "GitHub App not configured",
  github_verification_not_configured: "GitHub verification needs configuration",
  github_authorization_denied: "GitHub authorization declined",
  github_authorization_failed: "GitHub authorization failed",
  installation_not_accessible: "Installation access not verified",
  not_a_member: "Organization access lost",
  manifest_forbidden: "Not allowed",
  manifest_already_configured: "GitHub App already set up",
  manifest_bad_org: "Invalid organization",
  manifest_expired: "Setup expired",
  manifest_failed: "Couldn't create the GitHub App",
};

export const ERROR_MESSAGES: Record<GitHubInstallErrorCode, string> = {
  installation_already_bound:
    "This GitHub installation is already connected to another Octopus organization. Disconnect it there first, then try again.",
  invalid_installation_id: "The installation ID GitHub returned is not valid.",
  missing_state:
    "The GitHub callback arrived without a valid flow token. Please start the install from Octopus again.",
  invalid_state_bad_signature:
    "The install token could not be verified. Please start the install from Octopus again.",
  invalid_state_expired:
    "The install flow expired. Please start it again and complete it within 10 minutes.",
  invalid_state_malformed:
    "The install token is malformed. Please start the install from Octopus again.",
  replay_detected:
    "This install link has already been used. Please start a new install flow.",
  state_store_unavailable:
    "The install verification store is temporarily unavailable. Please try again.",
  session_required:
    "Sign in again, then restart the GitHub App installation.",
  state_user_mismatch:
    "The signed-in user is not the user who started this installation. Restart the install from Octopus.",
  state_browser_mismatch:
    "This browser did not start the installation, or its install cookie expired. Start again from Octopus.",
  github_app_not_configured:
    "No GitHub App is configured for this instance yet. Create the GitHub App below, then start the install again.",
  github_verification_not_configured:
    "Add the GitHub App client ID, client secret, and Octopus callback URL, then restart the install.",
  github_authorization_denied:
    "GitHub authorization was declined. Authorize the GitHub App to verify the installation belongs to you.",
  github_authorization_failed:
    "Octopus could not verify your GitHub authorization. Check the GitHub App callback URL and try again.",
  installation_not_accessible:
    "Your GitHub user cannot access this installation. Ask an organization owner to install it or use an authorized account.",
  not_a_member:
    "You are no longer a member of the organization you started the install for. Switch organizations and try again.",
  manifest_forbidden:
    "Only an organization owner or admin can create the GitHub App. Ask an admin, or switch to an org you own.",
  manifest_already_configured:
    "A GitHub App is already configured for this instance. Reload the page — you should see an “Install GitHub App” button.",
  manifest_bad_org:
    "That doesn't look like a valid GitHub organization name. Leave it blank to create the App under your personal account.",
  manifest_expired:
    "The setup flow expired. Please start again and finish within 15 minutes.",
  manifest_failed:
    "Something went wrong creating the GitHub App. Please try again; if it persists, use the manual setup guide.",
};


/** Every code the integrations page accepts from the query string. */
export const GITHUB_INSTALL_ERROR_CODES = Object.keys(ERROR_TITLES) as GitHubInstallErrorCode[];

export function isGithubInstallErrorCode(value: string | null | undefined): value is GitHubInstallErrorCode {
  return !!value && Object.prototype.hasOwnProperty.call(ERROR_TITLES, value);
}

const CLOUD_SIDE = {
  title: "We couldn't finish connecting GitHub",
  message:
    "Something on our side stopped the GitHub connection from completing. It has been logged. Please try again in a few minutes; if it keeps happening, email support@octopus-review.ai.",
};

/** Codes whose operator instructions must not reach a cloud customer. */
const CLOUD_OVERRIDES: Partial<Record<GitHubInstallErrorCode, { title: string; message: string }>> = {
  github_app_not_configured: CLOUD_SIDE,
  github_verification_not_configured: CLOUD_SIDE,
  github_authorization_failed: CLOUD_SIDE,
};

export function resolveGithubErrorCopy(
  code: GitHubInstallErrorCode,
  selfHosted: boolean,
): { title: string; message: string } {
  const override = selfHosted ? undefined : CLOUD_OVERRIDES[code];
  return override ?? { title: ERROR_TITLES[code], message: ERROR_MESSAGES[code] };
}
