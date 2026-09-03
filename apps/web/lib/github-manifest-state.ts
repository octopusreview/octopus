// Shared between the GitHub App Manifest start + callback routes. Kept out of the
// route.ts files because Next.js only allows HTTP-method / route-config exports
// from a route segment. Mirrors lib/slack-oauth.ts.

// HttpOnly cookie holding the per-transaction nonce. The callback requires it to
// match the nonce embedded in the encrypted `state`, binding the flow to the
// browser that started it (CSRF protection).
export const GITHUB_MANIFEST_STATE_COOKIE = "gh_manifest_state";

// State lifetime: long enough to fill in the GitHub "Create App" screen, short
// enough to bound the replay window of a leaked code+state pair.
export const GITHUB_MANIFEST_STATE_TTL_MS = 15 * 60 * 1000;

// Contract for the encrypted `state` blob. `org` is the optional GitHub org the
// app is being created under (empty = personal account).
export type GithubManifestState = {
  userId: string;
  orgId: string;
  org: string;
  nonce: string;
  exp: number;
};

/**
 * The GitHub App manifest submitted to github.com/settings/apps/new. Pure so it
 * can be unit-tested. Permissions/events mirror the manual docs (contents:read,
 * pull_requests:write, checks:write, metadata:read; pull_request +
 * pull_request_review). `name` must be globally unique on GitHub.
 */
export function buildAppManifest(baseUrl: string, name: string) {
  return {
    name,
    url: baseUrl,
    hook_attributes: { url: `${baseUrl}/api/github/webhook`, active: true },
    redirect_url: `${baseUrl}/api/github/app-manifest/callback`,
    callback_urls: [`${baseUrl}/api/github/callback`],
    setup_url: `${baseUrl}/api/github/callback`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: "read",
      pull_requests: "write",
      checks: "write",
      metadata: "read",
    },
    // `repository` = created/renamed/transferred/deleted, so new repositories
    // on an "all repositories" install are discovered without a manual Sync.
    default_events: ["pull_request", "pull_request_review", "repository"],
  };
}
