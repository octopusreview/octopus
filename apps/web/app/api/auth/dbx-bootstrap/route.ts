// Databricks Apps OAuth → Better-Auth session bootstrap.
//
// The Databricks Apps proxy authenticates the user and forwards every request
// with `x-forwarded-access-token` (the user's Databricks OAuth access token).
// Some releases also include `x-forwarded-email` / `x-forwarded-user` /
// `x-forwarded-preferred-username`. The canonical, always-present signal per
// the docs is the access token; we resolve identity from it by calling the
// workspace's SCIM `/Me` endpoint with that token as the bearer.
//
// This route trusts the proxy (it's the only ingress path), upserts the User
// row in Lakebase, mints a Better-Auth Session row + cookie, and bounces the
// caller back to the originally-requested path.

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
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//")) return "/dashboard"; // protocol-relative
  return raw;
}

function cuid(): string {
  return `c${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeHost(raw: string | undefined): string {
  let h = (raw ?? "").trim().replace(/\/$/, "");
  if (h && !/^https?:\/\//i.test(h)) h = `https://${h}`;
  return h;
}

/**
 * Resolve the authenticated user's email + display name from the Databricks
 * Apps proxy headers. Tries x-forwarded-email first (cheap); falls back to
 * SCIM /Me using x-forwarded-access-token (per the official docs).
 */
async function resolveIdentity(req: NextRequest): Promise<{
  email: string;
  name: string;
  dbxUserId: string | null;
} | null> {
  const headerEmail =
    req.headers.get("x-forwarded-email") ||
    req.headers.get("x-forwarded-preferred-username");
  const headerUser = req.headers.get("x-forwarded-user");

  if (headerEmail && headerEmail.includes("@")) {
    return {
      email: headerEmail.trim().toLowerCase(),
      name:
        req.headers.get("x-forwarded-preferred-username")?.trim() ||
        headerEmail.trim(),
      dbxUserId: headerUser,
    };
  }

  const accessToken = req.headers.get("x-forwarded-access-token");
  if (!accessToken) return null;

  // Resolve via SCIM /Me using the user's forwarded access token.
  const host = normalizeHost(process.env.DATABRICKS_HOST);
  if (!host) {
    console.warn("[dbx-bootstrap] DATABRICKS_HOST missing — cannot resolve SCIM /Me");
    return null;
  }
  try {
    const r = await fetch(`${host}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      console.warn(
        `[dbx-bootstrap] SCIM /Me returned ${r.status} ${r.statusText} — falling back to header-only identity`,
      );
      if (headerUser && headerUser.includes("@")) {
        return { email: headerUser.toLowerCase(), name: headerUser, dbxUserId: headerUser };
      }
      return null;
    }
    const j = (await r.json()) as {
      id?: string;
      userName?: string;
      displayName?: string;
      emails?: Array<{ value?: string; primary?: boolean }>;
    };
    const primaryEmail =
      j.emails?.find((e) => e.primary)?.value || j.emails?.[0]?.value || j.userName;
    if (!primaryEmail || !primaryEmail.includes("@")) {
      console.warn("[dbx-bootstrap] SCIM /Me response has no usable email", j);
      return null;
    }
    return {
      email: primaryEmail.trim().toLowerCase(),
      name: j.displayName || j.userName || primaryEmail,
      dbxUserId: j.id ?? headerUser,
    };
  } catch (e) {
    console.warn("[dbx-bootstrap] SCIM /Me failed:", (e as Error).message);
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const identity = await resolveIdentity(req);

  if (!identity) {
    return NextResponse.json(
      {
        error:
          "Databricks Apps proxy headers missing or unresolvable — this endpoint is only valid behind the Apps OAuth proxy.",
      },
      { status: 401 },
    );
  }

  const email = normalizeEmail(identity.email);
  const name = identity.name || email;

  // Upsert User. If new, write a signup audit log.
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { id: cuid(), email, name, emailVerified: true },
    });
    await writeAuditLog({
      action: "auth.signup",
      category: "auth",
      actorId: user.id,
      actorEmail: user.email,
      targetType: "user",
      targetId: user.id,
      metadata: { source: "databricks-apps", dbxUserId: identity.dbxUserId },
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

  // Better-Auth signs the session cookie using Hono's signedCookie format:
  //   cookie_value = `${token}.${base64(HMAC-SHA256(BETTER_AUTH_SECRET, token))}`
  // Without the signature suffix, Better-Auth's getSession() can't verify the
  // cookie and treats subsequent requests as unauthenticated. So sign here.
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "BETTER_AUTH_SECRET missing — cannot sign session cookie." },
      { status: 500 },
    );
  }
  const hmac = crypto.createHmac("sha256", secret).update(token).digest();
  // Hono uses `btoa(String.fromCharCode(...))` which yields standard base64 (with `+/=`).
  const signature = hmac.toString("base64");
  const signedCookie = `${token}.${signature}`;

  // 302 → returnTo, with the session cookie set.
  const appUrl =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin;
  const target = new URL(returnTo, appUrl);
  const res = NextResponse.redirect(target);
  res.cookies.set(SESSION_COOKIE_NAME, signedCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  console.log(
    `[dbx-bootstrap] minted signed session for ${email} (user=${user.id}, session=${sessionId}) → ${returnTo}`,
  );
  return res;
}
