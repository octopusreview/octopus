import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";

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

  const integration = await prisma.slackIntegration.findUnique({
    where: { organizationId: orgId },
    select: { accessToken: true },
  });

  if (!integration) {
    return NextResponse.json({ error: "Slack not connected" }, { status: 404 });
  }

  const slackToken = decryptStringMaybeLegacy(integration.accessToken);

  const allChannels: { id: string; name: string }[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "1000",
    });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      {
        headers: { Authorization: `Bearer ${slackToken}` },
      },
    );

    const data = await response.json();

    if (!data.ok) {
      console.error("[slack-channels] API error:", data.error);
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    for (const ch of data.channels ?? []) {
      allChannels.push({ id: ch.id, name: ch.name });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  allChannels.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ channels: allChannels });
}
