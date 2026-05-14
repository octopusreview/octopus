import { NextRequest, NextResponse } from "next/server";

const publicPrefixes = [
  "/login",
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  // ── Databricks Apps OAuth bootstrap ────────────────────────────────────────
  // When the Databricks Apps OAuth proxy fronts us, EVERY request arrives with
  // X-Forwarded-Email already authenticated. If the user doesn't yet have a
  // Better-Auth session cookie, mint one via /api/auth/dbx-bootstrap regardless
  // of whether the path is "public" — public pages like /login don't make
  // sense when the user is already authenticated upstream.
  //
  // We DON'T redirect from these paths to avoid loops:
  //   /api/auth/dbx-bootstrap  (the bootstrap route itself)
  //   /api/auth/*              (Better-Auth internals)
  //   /api/version             (health check)
  //   /api/github/webhook etc. (webhook callers don't pass the proxy)
  const dbxEmail = request.headers.get("x-forwarded-email");
  const isBootstrap = pathname.startsWith("/api/auth/dbx-bootstrap");
  const isWebhookOrHealth =
    pathname.startsWith("/api/github/") ||
    pathname.startsWith("/api/bitbucket/webhook") ||
    pathname.startsWith("/api/pubby") ||
    pathname === "/api/version" ||
    pathname.startsWith("/api/cli") ||
    pathname.startsWith("/api/agent") ||
    pathname.startsWith("/api/stripe");

  if (dbxEmail && !sessionToken && !isBootstrap && !isWebhookOrHealth) {
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `http://${request.headers.get("host") || "localhost:3000"}`;
    // After bootstrap, send the user to whatever they were trying to load —
    // except /login which is meaningless under Databricks SSO; bounce to /dashboard instead.
    const returnTo =
      pathname === "/login" || pathname === "/"
        ? "/dashboard"
        : pathname + request.nextUrl.search;
    const bootstrap = new URL("/api/auth/dbx-bootstrap", appUrl);
    bootstrap.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(bootstrap);
  }

  // ── Public-path early exit ─────────────────────────────────────────────────
  if (
    publicExact.includes(pathname) ||
    publicPrefixes.some((path) => pathname.startsWith(path))
  ) {
    return NextResponse.next();
  }

  // ── Authenticated-path gate (Better-Auth session required) ─────────────────
  if (!sessionToken) {
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `http://${request.headers.get("host") || "localhost:3000"}`;
    const fullPath = pathname + request.nextUrl.search;
    const loginUrl = new URL("/login", appUrl);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
