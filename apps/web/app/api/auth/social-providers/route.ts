import { NextResponse } from "next/server";

// Reflects operator-set env at request time; never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/social-providers
 *
 * Reports which OAuth social providers are configured on the server, so the
 * login page can disable / annotate the Google, GitHub, and Microsoft buttons
 * when the operator hasn't set the env vars yet — instead of letting the user
 * click and get a generic Better Auth error.
 *
 * Boolean presence only — never returns the keys themselves.
 */
export function GET() {
  return NextResponse.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  });
}
