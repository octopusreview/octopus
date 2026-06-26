import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { encryptJson } from "@/lib/crypto";
import {
  SLACK_OAUTH_STATE_COOKIE,
  SLACK_OAUTH_STATE_TTL_MS,
} from "@/lib/slack-oauth";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 400 });
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Slack integration not configured" },
      { status: 500 },
    );
  }

  // High-entropy nonce that ties this OAuth transaction to the browser that
  // started it. The nonce is both embedded in the (encrypted, tamper-proof)
  // state and stored in an HttpOnly cookie; the callback only proceeds when the
  // two match. An attacker cannot set this cookie in a victim's browser, so a
  // crafted callback URL (forged state + attacker code) is rejected. The state
  // also carries the initiating userId and orgId so the callback can re-check
  // both against the live session instead of trusting attacker-controlled input.
  const nonce = randomBytes(32).toString("base64url");
  const state = encryptJson({
    orgId,
    userId: session.user.id,
    nonce,
    exp: Date.now() + SLACK_OAUTH_STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "chat:write,channels:read,groups:read,commands",
    redirect_uri: redirectUri,
    state,
  });

  const response = NextResponse.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`,
  );
  response.cookies.set(SLACK_OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SLACK_OAUTH_STATE_TTL_MS / 1000),
  });
  return response;
}
