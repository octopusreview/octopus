import { auth } from "@/lib/auth";
import { pubby } from "@/lib/pubby";
import { prisma } from "@octopus/db";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { channel, event, data } = await req.json();

  // Validate channel access: presence-chat-{conversationId}
  const chatMatch = channel.match(/^presence-chat-(.+)$/);
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

    await pubby.trigger(channel, event, data);
    return Response.json({ ok: true });
  }

  // Validate channel access: presence-org-{orgId}
  const orgMatch = channel.match(/^presence-org-(.+)$/);
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

    await pubby.trigger(channel, event, data);
    return Response.json({ ok: true });
  }

  // Deny all other channel patterns
  return new Response("Channel not allowed", { status: 403 });
}
