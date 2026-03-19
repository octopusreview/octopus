import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ApiTokensClient } from "./api-tokens-client";

export default async function ApiTokensPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { role: true, organizationId: true },
  });

  if (!member) redirect("/dashboard");

  const tokens = await prisma.orgApiToken.findMany({
    where: { organizationId: member.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ApiTokensClient
      key={member.organizationId}
      tokens={tokens.map((t) => ({
        ...t,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
      isOwner={member.role === "owner"}
    />
  );
}
