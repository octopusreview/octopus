import { Suspense } from "react";
import { LoginContent } from "./login-content";

// The provider gate below reads runtime env, but without a dynamic marker
// Next statically prerenders this page AT IMAGE BUILD TIME — where no OAuth
// env exists — baking "(not configured)" into the HTML no matter what the
// running container has. Force per-request rendering so the gate reflects
// the deployment's actual configuration.
export const dynamic = "force-dynamic";

/**
 * Reads which OAuth providers the operator configured (presence only, never the
 * secrets) and passes it to the client form, so unconfigured buttons render
 * disabled on first paint — no client round-trip, no public endpoint.
 */
export default function LoginPage() {
  const socialEnabled = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  };

  // Email/password sign-in + signup is self-hosted only (see auth.ts gate).
  const passwordAuth = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true";

  return (
    <Suspense>
      <LoginContent socialEnabled={socialEnabled} passwordAuth={passwordAuth} />
    </Suspense>
  );
}
