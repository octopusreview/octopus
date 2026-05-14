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
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `http://${request.headers.get("host") || "localhost:3000"}`;
    const fullPath = pathname + request.nextUrl.search;

    // Databricks Apps OAuth path — the proxy has already authenticated the
    // user and injected X-Forwarded-Email. Mint a Better-Auth session via the
    // dbx-bootstrap route and bounce the user back to where they were going.
    const dbxEmail = request.headers.get("x-forwarded-email");
    if (dbxEmail) {
      const bootstrap = new URL("/api/auth/dbx-bootstrap", appUrl);
      bootstrap.searchParams.set("returnTo", fullPath);
      return NextResponse.redirect(bootstrap);
    }

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
