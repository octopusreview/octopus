import { Suspense } from "react";
import { LoginContent } from "./login-content";

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

  return (
    <Suspense>
      <LoginContent socialEnabled={socialEnabled} />
    </Suspense>
  );
}
