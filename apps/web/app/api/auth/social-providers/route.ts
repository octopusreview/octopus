import { NextResponse } from "next/server";

/**
 * GET /api/auth/social-providers
 *
 * Reports which OAuth social providers are configured on the server. The
 * login page uses this so it can disable / annotate the Google + GitHub
 * buttons when the operator hasn't set the env vars yet, instead of
 * letting the user click and get a generic Better Auth error.
 *
 * Boolean only — never returns the keys themselves.
 */
export function GET() {
  return NextResponse.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
}
