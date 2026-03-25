import { NextRequest, NextResponse } from "next/server";

const publicPrefixes = ["/login", "/blocked", "/brand", "/docs", "/email-preview", "/api/auth", "/api/github", "/api/bitbucket/webhook", "/api/pubby", "/api/version", "/api/invitations", "/api/slack/commands", "/api/stripe", "/api/cli", "/api/newsletter", "/api/analyze-deps"];
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
    // Use x-forwarded headers or BETTER_AUTH_URL to avoid 0.0.0.0 redirects
    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const loginUrl = new URL("/login", `${proto}://${host}`);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
