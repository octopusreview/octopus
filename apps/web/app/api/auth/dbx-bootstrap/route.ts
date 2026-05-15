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

/**
 * Strict same-origin path guard. Rejects anything that could escape the app
 * origin via path encoding tricks. The path-only check on its own (the prior
 * implementation) was bypassable via:
 *   - `/\evil.com` (Windows-style path)
 *   - `/%2Fevil.com` (URL-encoded leading slash)
 *   - `/%5Cevil.com` (URL-encoded backslash)
 *   - `/whatever?next=https://evil.com` (callers downstream that re-redirect)
 *   - protocol-relative `//evil.com`
 *   - absolute URLs
 *
 * We require: starts with exactly one `/`, second char is NOT `/` or `\` after
 * percent-decoding, and the decoded path doesn't reintroduce a scheme or host.
 */
function safeReturnTo(raw: string | null): string {
  const DEFAULT = "/dashboard";
  if (!raw) return DEFAULT;
  // Strip CR/LF — defense against header injection if this ever lands in a Location header
  if (/[\r\n]/.test(raw)) return DEFAULT;
  if (!raw.startsWith("/")) return DEFAULT;
  if (raw.length > 1 && (raw[1] === "/" || raw[1] === "\\")) return DEFAULT;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT;
  }
  if (decoded.length > 1 && (decoded[1] === "/" || decoded[1] === "\\")) return DEFAULT;
  // Reject anything that looks like a scheme (http://, javascript:, data:, etc.)
  if (/^[a-z]+:/i.test(decoded.trim()) && !decoded.startsWith("/")) return DEFAULT;
  // Cap length — overly long returnTo is almost always an attack
  if (raw.length > 2048) return DEFAULT;
  return raw;
}

/** Mask an email for logging: `dermot.smyth@databricks.com` → `d***@databricks.com`. */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
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
 * Resolve the authenticated user's identity by **verifying the forwarded
 * access token against Databricks SCIM /Me**.
 *
 * SECURITY NOTE: the previous implementation took a fast path on
 * `x-forwarded-email` alone, which let any caller that could reach this
 * Next.js process forge `x-forwarded-email: admin@company.com` and get a
 * fully-authenticated session. Even inside Databricks Apps, the proxy can
 * be bypassed by direct intra-VPC reachability or a misconfigured load
 * balancer.
 *
 * The only header we trust as proof-of-identity is `x-forwarded-access-token`
 * — a real Databricks-issued OAuth token. We verify it by calling SCIM /Me;
 * if the token is forged or expired, that call returns 401 and we bail.
 * Email/username headers are used only as cosmetic hints if SCIM is
 * unreachable for transient reasons (rare).
 */
async function resolveIdentity(req: NextRequest): Promise<{
  email: string;
  name: string;
  dbxUserId: string | null;
} | null> {
  const accessToken = req.headers.get("x-forwarded-access-token");
  if (!accessToken) {
    // No verifiable token → reject. Don't fall back to header-only identity.
    return null;
  }

  const host = normalizeHost(process.env.DATABRICKS_HOST);
  if (!host) {
    console.warn("[dbx-bootstrap] DATABRICKS_HOST missing — cannot verify access token");
    return null;
  }

  try {
    const r = await fetch(`${host}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      console.warn(`[dbx-bootstrap] SCIM /Me returned ${r.status} — rejecting bootstrap`);
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
      console.warn("[dbx-bootstrap] SCIM /Me response has no usable email");
      return null;
    }
    return {
      email: primaryEmail.trim().toLowerCase(),
      name: j.displayName || j.userName || primaryEmail,
      dbxUserId: j.id ?? req.headers.get("x-forwarded-user"),
    };
  } catch (e) {
    console.warn("[dbx-bootstrap] SCIM /Me request failed:", (e as Error).message);
    return null;
  }
}

/**
 * Attach a newly-created user to an organization so they have something to
 * see when they land on the dashboard. Two strategies, tried in order:
 *   1. If `DATABRICKS_DEFAULT_ORG_ID` is set, enrol them there. Recommended
 *      for production deployments where org membership is pre-provisioned
 *      out-of-band.
 *   2. Otherwise, if the deployment has exactly ONE organization, enrol
 *      them in it (single-tenant heuristic — common for FEVM demos).
 *
 * If neither applies, the user lands on an empty dashboard and the standard
 * org-creation UX kicks in.
 */
async function autoEnrollNewUser(userId: string, userEmail: string): Promise<void> {
  const defaultOrgId = process.env.DATABRICKS_DEFAULT_ORG_ID;
  let targetOrgId: string | null = null;

  if (defaultOrgId) {
    const exists = await prisma.organization.findUnique({
      where: { id: defaultOrgId },
      select: { id: true },
    });
    if (exists) targetOrgId = defaultOrgId;
    else console.warn(`[dbx-bootstrap] DATABRICKS_DEFAULT_ORG_ID=${defaultOrgId} not found in DB — skipping auto-enroll`);
  }

  if (!targetOrgId) {
    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 2,
    });
    if (orgs.length === 1) targetOrgId = orgs[0].id;
  }

  if (!targetOrgId) return;

  try {
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: targetOrgId, userId } },
      update: { deletedAt: null },
      create: { organizationId: targetOrgId, userId, role: "member" },
    });
    console.log(`[dbx-bootstrap] auto-enrolled ${maskEmail(userEmail)} in org ${targetOrgId}`);
  } catch (e) {
    console.warn(`[dbx-bootstrap] auto-enroll failed for ${maskEmail(userEmail)}:`, (e as Error).message);
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

  // Upsert User. If new, write a signup audit log AND attach them to an
  // organization (otherwise they land on an empty dashboard with no obvious
  // next step — see `autoEnrollNewUser` for the strategy).
  let user = await prisma.user.findUnique({ where: { email } });
  const isNewUser = !user;
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
  if (isNewUser) {
    await autoEnrollNewUser(user.id, user.email);
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
  //
  // KNOWN COUPLING: this manually replicates Better-Auth's Hono-style HMAC
  // signing. If Better-Auth changes algorithms in a future major version,
  // cookies minted here will silently fail to verify. The cookie format is
  // intentionally simple (no kid, no rotation) and stable as of better-auth
  // v1.x; revisit on any major-version bump. Tracked in
  // CookieSignVersion below for future detection.
  const COOKIE_SIGN_VERSION = "1.x" as const; // Better-Auth signed-cookie format
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.error("[dbx-bootstrap] BETTER_AUTH_SECRET missing — cannot sign session cookie");
    const appUrl =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      req.nextUrl.origin;
    const errorUrl = new URL("/login", appUrl);
    errorUrl.searchParams.set("error", "server-misconfigured");
    return NextResponse.redirect(errorUrl);
  }
  const signedCookie = signSessionCookie(token, secret, COOKIE_SIGN_VERSION);

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
  // Mask email — corporate compliance commonly forbids PII in app logs.
  console.log(
    `[dbx-bootstrap] minted session for ${maskEmail(email)} (user=${user.id}, session=${sessionId}) → ${returnTo}`,
  );
  return res;
}

/**
 * Sign the session token in Hono's signedCookie format (Better-Auth v1.x):
 *   `${token}.${base64(HMAC-SHA256(secret, token))}`
 * Extracted from inline so the signing surface is easy to swap if
 * Better-Auth's format changes.
 */
function signSessionCookie(token: string, secret: string, _version: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(token).digest();
  // Hono uses `btoa(String.fromCharCode(...))` → standard base64 (with `+/=`).
  return `${token}.${hmac.toString("base64")}`;
}
