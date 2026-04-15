import { auth } from "@/lib/auth";
import { pubby } from "@/lib/pubby";
import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { headers } from "next/headers";

export async function POST(req: Request) {
  // Clone request body since we may need to read it in both auth paths
  const body = await req.json();
  const { socket_id, channel_name } = body;

  // Try API token auth first (for headless agents)
  const apiAuth = await authenticateApiToken(req);
  if (apiAuth) {
    // Agents can only subscribe to their org's agent channel
    const agentChannelMatch = channel_name.match(
      /^private-agent-org-(.+)$/,
    );
    if (agentChannelMatch && agentChannelMatch[1] === apiAuth.org.id) {
      const authResponse = pubby.authenticatePrivateChannel(
        socket_id,
        channel_name,
      );
      return Response.json(authResponse);
    }

    return new Response("Channel not allowed for API token", { status: 403 });
  }

  // Fall back to browser session auth
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (channel_name.startsWith("presence-")) {
    // Validate presence-chat-{conversationId} channels
    const chatMatch = channel_name.match(/^presence-chat-(.+)$/);
    if (chatMatch) {
      const conversationId = chatMatch[1];
      const conversation = await prisma.chatConversation.findFirst({
        where: {
          id: conversationId,
          isShared: true,
          deletedAt: null,
        },
        select: { organizationId: true },
      });

      if (!conversation) {
        return new Response("Conversation not found or not shared", { status: 403 });
      }

      // Verify org membership
      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: conversation.organizationId,
          userId: session.user.id,
          deletedAt: null,
        },
      });
      if (!membership) {
        return new Response("Not a member of this organization", { status: 403 });
      }

      const authResponse = pubby.authenticatePresenceChannel(
        socket_id,
        channel_name,
        session.user.id,
        { name: session.user.name, image: session.user.image }
      );
      return Response.json(authResponse);
    }

    // Validate presence-org-{orgId} channels
    const orgMatch = channel_name.match(/^presence-org-(.+)$/);
    if (orgMatch) {
      const orgId = orgMatch[1];
      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: orgId,
          userId: session.user.id,
          deletedAt: null,
        },
      });
      if (!membership) {
        return new Response("Not a member of this organization", { status: 403 });
      }

      const authResponse = pubby.authenticatePresenceChannel(
        socket_id,
        channel_name,
        session.user.id,
        { name: session.user.name, image: session.user.image }
      );
      return Response.json(authResponse);
    }

    // Deny unrecognized presence channel patterns
    return new Response("Channel not allowed", { status: 403 });
  }

  // Deny all other channels for session users
  return new Response("Channel not allowed", { status: 403 });
}
