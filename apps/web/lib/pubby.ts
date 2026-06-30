import { PubbyServer } from "@getpubby/sdk/server";

export const pubby = new PubbyServer({
  appId: process.env.PUBBY_APP_ID!,
  key: process.env.PUBBY_APP_KEY!,
  secret: process.env.PUBBY_APP_SECRET!,
  apiHost: "https://api.pubby.dev",
});

/**
 * Whether Pubby is configured. The client above is constructed unconditionally
 * (the `!` assertions don't throw at construction), so on self-hosted / no-Pubby
 * installs `pubby.trigger()` would fail at call time. New code should early-return
 * when this is false; the browser likewise switches to polling when
 * NEXT_PUBLIC_PUBBY_KEY is absent.
 */
export const PUBBY_ENABLED = !!(
  process.env.PUBBY_APP_ID &&
  process.env.PUBBY_APP_KEY &&
  process.env.PUBBY_APP_SECRET
);
