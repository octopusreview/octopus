import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { encryptString } from "@/lib/crypto";

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

  let orgId: string;
  try {
    const parsed = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    );
    orgId = parsed.orgId;
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
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
    return NextResponse.redirect(
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

  return NextResponse.redirect(
    new URL("/settings/integrations?success=slack", baseUrl),
  );
}
