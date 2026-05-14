// Databricks Apps OAuth → Better-Auth session bootstrap.
//
// The Apps platform fronts every request with an OAuth proxy that injects
// X-Forwarded-Email / X-Forwarded-User / X-Forwarded-Preferred-Username headers.
// This route trusts those headers (the proxy is the only ingress path),
// upserts the User row in Lakebase, mints a Better-Auth Session row + cookie,
// and bounces the caller back to the originally-requested path.

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@octopus/db";
import { normalizeEmail } from "@/lib/email-normalize";
import { writeAuditLog } from "@/lib/audit";

// Force Node runtime — Edge can't use Prisma.
export const runtime = "nodejs";
// Don't pre-render; this route is fully request-driven.
export const dynamic = "force-dynamic";

const SESSION_TTL_DAYS = 7;
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Prevent open redirect — only allow same-origin paths.
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard"; // protocol-relative
  return raw;
}

function cuid(): string {
  // Best-effort short id matching the shape Better-Auth uses elsewhere.
  return `c${crypto.randomBytes(12).toString("hex")}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rawEmail = req.headers.get("x-forwarded-email");
  const preferred = req.headers.get("x-forwarded-preferred-username");
  const dbxUserId = req.headers.get("x-forwarded-user");
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));

  if (!rawEmail) {
    // No proxy headers — caller can't be authenticated by this route.
    return NextResponse.json(
      { error: "X-Forwarded-Email header missing — this endpoint is only valid behind the Databricks Apps proxy." },
      { status: 401 },
    );
  }

  const email = normalizeEmail(rawEmail.trim().toLowerCase());
  const name = preferred?.trim() || email;

  // Upsert User. If new, write a signup audit log.
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: cuid(),
        email,
        name,
        emailVerified: true,
      },
    });
    await writeAuditLog({
      action: "auth.signup",
      category: "auth",
      actorId: user.id,
      actorEmail: user.email,
      targetType: "user",
      targetId: user.id,
      metadata: { source: "databricks-apps", dbxUserId: dbxUserId ?? null },
    });
  }

  // Mint a Session row Better-Auth will recognise.
  const sessionId = cuid();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      id: sessionId,
      token,
      userId: user.id,
      expiresAt,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  await writeAuditLog({
    action: "auth.login",
    category: "auth",
    actorId: user.id,
    actorEmail: user.email,
    targetType: "session",
    targetId: sessionId,
    metadata: { source: "databricks-apps" },
  });

  // 302 → returnTo, with the session cookie set.
  const appUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin;
  const target = new URL(returnTo, appUrl);
  const res = NextResponse.redirect(target);
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
