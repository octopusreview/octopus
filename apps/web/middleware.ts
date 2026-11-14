import { NextRequest, NextResponse } from "next/server";

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
  "/editor",
  "/vs-",
  "/api/auth",
  "/api/github",
  "/api/bitbucket/webhook",
  "/api/gitlab/webhook",
  "/api/forgejo/webhook/",
  "/api/forgejo/connector/",
  "/api/pubby",
  "/api/version",
  "/api/invitations",
  "/api/slack/commands",
  "/api/stripe",
  "/api/cli",
  // This endpoint validates API tokens or sessions in its own handler.
  "/api/review-attempts/",
  "/api/agent",
  "/api/presence",
  "/api/admin",
  "/api/newsletter",
  "/api/analyze-deps",
  "/api/blog",
  "/api/ask-octopus",
  // Token-less OSS bot-review trigger — called by a zero-permission action with
  // no session; gated by allowlist + consent file + rate limit in the handler.
  "/api/oss-review",
  "/api/status",
  "/api/health",
  "/api/ready",
];
// Let the router render the target of the anonymous 404 rewrite.
const publicExact = ["/", "/_not-found", "/api/marketing/visit"];

// Public content/marketing + feed paths. Anonymous visitors and crawlers must
// never be bounced to /login here; paths that aren't built yet then fall
// through to a normal 404 instead of a 307→/login (#443). Matched on an exact
// or path-segment boundary (not a bare prefix) so "/feed" can't also whitelist
// a future "/feedback". Extensioned feeds like /feed.xml already bypass the
// middleware via the matcher's dot rule.
const publicContentPrefixes = ["/careers", "/open-positions", "/jobs", "/feed", "/rss"];

// Pages that need a session. A signed-out visitor is sent to sign in for these
// and for API paths. Any other path is not a page this app serves, so it gets
// a real 404 instead of a redirect to /login: a mistyped or outdated URL must
// not look like a page behind a login wall. A page missing from this list
// fails closed (signed-out visitors see a 404, never its content).
const sessionPagePrefixes = [
  "/admin",
  "/change-password",
  "/chat",
  "/cli",
  "/complete-profile",
  "/dashboard",
  "/invitation",
  "/issues",
  "/knowledge",
  "/monitor",
  "/package-analyzer",
  "/repositories",
  "/review-attempts",
  "/review-logs",
  "/settings",
  "/timeline",
  "/usage",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Password-auth routes (forgot/reset/change) only exist on self-hosted
  // builds. On the SaaS build (flag unset) send them to /login so password
  // auth is a clean no-op rather than a half-working surface.
  if (
    process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED !== "true" &&
    (pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/reset-password") ||
      pathname.startsWith("/change-password"))
  ) {
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `http://${request.headers.get("host") || "localhost:3000"}`;
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  if (
    publicExact.includes(pathname) ||
    publicPrefixes.some((path) => pathname.startsWith(path)) ||
    publicContentPrefixes.some((path) => pathname === path || pathname.startsWith(path + "/"))
  ) {
    return NextResponse.next();
  }

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  if (!sessionToken) {
    const needsSession =
      pathname.startsWith("/api/") ||
      sessionPagePrefixes.some((path) => pathname === path || pathname.startsWith(path + "/"));
    if (!needsSession) {
      // No route answers this path, so the router renders its 404 page.
      return NextResponse.rewrite(new URL("/_not-found", request.url));
    }

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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api/forgejo/connector/result/?$|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
