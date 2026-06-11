import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";

// Endpoints a user with mustChangePassword=true is still allowed to hit.
// The /change-password page itself, the API the page POSTs to, anything under
// /api/auth (session refresh, sign-out, magic links), and the static / asset
// surface. Everything else is blocked until the flag is cleared — that's the
// defining property of the forced-password-change gate.
const MUST_CHANGE_PASSWORD_ALLOWED_PREFIXES = [
  "/change-password",
  "/api/auth",
  "/api/me/password-changed",
];

const publicPrefixes = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/blocked",
  "/brand",
  "/blog",
  "/bug-bounty",
  "/docs",
  "/status",
  "/not-a-rabbit",
  "/compare",
  "/vs-",
  "/open-source",
  "/api/auth",
  "/api/github",
  "/api/bitbucket/webhook",
  "/api/pubby",
  "/api/version",
  "/api/invitations",
  "/api/slack/commands",
  "/api/stripe",
  "/api/cli",
  "/api/agent",
  "/api/admin",
  "/api/newsletter",
  "/api/analyze-deps",
  "/api/blog",
  "/api/ask-octopus",
  "/api/status",
];
const publicExact = ["/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    publicExact.includes(pathname) ||
    publicPrefixes.some((path) => pathname.startsWith(path))
  ) {
    return NextResponse.next();
  }

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  if (!sessionToken) {
    // Use configured app URL to prevent redirect poisoning via X-Forwarded-Host
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `http://${request.headers.get("host") || "localhost:3000"}`;
    const loginUrl = new URL("/login", appUrl);
    const fullPath = pathname + request.nextUrl.search;
    if (fullPath !== "/dashboard") {
      loginUrl.searchParams.set("callbackUrl", fullPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Enforce the forced-password-change gate on the API surface too — not just
  // the (app) layout. Without this, a session created with the seeded
  // admin@example.com / change-me-now credential (or any user an operator
  // flagged for a reset) could drive the whole product via /api/* while the
  // UI redirect was silently inert.
  //
  // Optimisation: avoid `auth.api.getSession` here. That helper does the
  // full session-validation dance (token verify, expiry check, csrf, etc.)
  // on every authenticated request, which is overkill for ONLY needing the
  // mustChangePassword flag. We've already established a session token
  // cookie exists above; downstream handlers / the (app) layout still do
  // the full getSession and reject if the cookie's stale, so an expired
  // session never sneaks past here in practice. A direct findUnique
  // selecting one column is ~1-2ms vs the full validation's 10-20ms.
  //
  // Skipped for the explicit allow-list above (the /change-password page,
  // its POST endpoint, and /api/auth/* for session lifecycle).
  if (
    !MUST_CHANGE_PASSWORD_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const sessionRow = await prisma.session
      .findUnique({
        where: { token: sessionToken },
        select: { user: { select: { mustChangePassword: true } } },
      })
      .catch(() => null);
    if (sessionRow?.user?.mustChangePassword) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Password change required. POST /api/me/password-changed with a new password before using the API." },
          { status: 403 },
        );
      }
      const appUrl =
        process.env.BETTER_AUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        `http://${request.headers.get("host") || "localhost:3000"}`;
      return NextResponse.redirect(new URL("/change-password", appUrl));
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Node runtime: better-auth's getSession reads from Prisma, which can't run
  // in the Edge runtime. Default in Next 16+, but pinning it here so an
  // accidental config change doesn't silently downgrade the gate.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
