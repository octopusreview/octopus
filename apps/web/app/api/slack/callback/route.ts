import { NextRequest, NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { encryptString, decryptJson } from "@/lib/crypto";
import {
  SLACK_OAUTH_STATE_COOKIE,
  type SlackOAuthState,
} from "@/lib/slack-oauth";

// The state cookie is single-use: clear it on every callback response so a
// captured code+state pair cannot be replayed against a stale cookie.
function redirectClearingState(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.delete(SLACK_OAUTH_STATE_COOKIE);
  return response;
}

const SLACK_EVENT_TYPES = [
  "review-requested",
  "review-completed",
  "review-failed",
  "repo-indexed",
  "repo-analyzed",
  "knowledge-ready",
];

export async function GET(request: NextRequest) {
  const baseUrl = process.env.BETTER_AUTH_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[slack-callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=slack_denied", baseUrl),
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", baseUrl),
    );
  }

  // State is authenticated (AES-GCM): decryption fails if it was forged or
  // tampered with, so orgId/userId/nonce here are exactly what we issued.
  let state: SlackOAuthState;
  try {
    state = decryptJson<SlackOAuthState>(stateParam);
  } catch {
    return redirectClearingState(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
    );
  }
  const orgId = state.orgId;

  // Expiry is the cheapest structural check, so reject stale/replayed-after-
  // expiry state up front, before any I/O (cookie read, session fetch, DB).
  if (typeof state.exp !== "number" || Date.now() > state.exp) {
    return redirectClearingState(
      new URL("/settings/integrations?error=state_expired", baseUrl),
    );
  }

  // CSRF binding: the nonce in the (server-issued) state must match the
  // HttpOnly cookie set in the browser that initiated this exact OAuth
  // transaction. An attacker cannot plant this cookie in a victim's browser,
  // so a crafted callback (attacker code + forged/replayed state) has no
  // matching cookie and is rejected here.
  const cookieStore = await cookies();
  const cookieNonce = cookieStore.get(SLACK_OAUTH_STATE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== state.nonce) {
    return redirectClearingState(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return redirectClearingState(new URL("/login", baseUrl));
  }
  // The session completing the callback must be the same user that started it.
  if (session.user.id !== state.userId) {
    return redirectClearingState(
      new URL("/settings/integrations?error=forbidden", baseUrl),
    );
  }
  // Defense in depth: that user must still be an admin of the target org.
  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return redirectClearingState(
      new URL("/settings/integrations?error=forbidden", baseUrl),
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID!;
  const clientSecret = process.env.SLACK_CLIENT_SECRET!;
  const redirectUri = process.env.SLACK_REDIRECT_URI!;

  // Exchange code for token
  const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenData.ok) {
    console.error("[slack-callback] Token exchange failed:", tokenData.error);
    return redirectClearingState(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const teamId = tokenData.team?.id ?? "";
  const teamName = tokenData.team?.name ?? "";
  const accessToken = tokenData.access_token ?? "";
  const botUserId = tokenData.bot_user_id ?? null;
  const accessTokenEnc = encryptString(accessToken);

  // Upsert SlackIntegration (token encrypted at rest)
  const integration = await prisma.slackIntegration.upsert({
    where: { organizationId: orgId },
    create: {
      teamId,
      teamName,
      accessToken: accessTokenEnc,
      botUserId,
      organizationId: orgId,
    },
    update: {
      teamId,
      teamName,
      accessToken: accessTokenEnc,
      botUserId,
    },
  });

  // Create default event configs (all enabled)
  for (const eventType of SLACK_EVENT_TYPES) {
    await prisma.slackEventConfig.upsert({
      where: {
        slackIntegrationId_eventType: {
          slackIntegrationId: integration.id,
          eventType,
        },
      },
      create: {
        eventType,
        enabled: true,
        slackIntegrationId: integration.id,
      },
      update: {},
    });
  }

  return redirectClearingState(
    new URL("/settings/integrations?success=slack", baseUrl),
  );
}
