// Shared between the Slack OAuth start and callback routes. Kept out of the
// route.ts files because Next.js only allows HTTP-method and route-config
// exports from a route segment.

// HttpOnly cookie holding the per-transaction OAuth state nonce. The callback
// requires it to match the nonce embedded in the encrypted `state`, binding the
// flow to the browser that initiated it (CSRF protection).
export const SLACK_OAUTH_STATE_COOKIE = "slack_oauth_state";

// OAuth state lifetime: long enough to complete the Slack consent screen, short
// enough to bound the window a leaked code+state pair can be replayed.
export const SLACK_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
