import { notFound } from "next/navigation";
import { getSuperAdmin } from "@/lib/superadmin";
import { prisma } from "@octopus/db";
import { ALL_SCOPES } from "@/lib/scopes";
import { TokensClient } from "./tokens-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service Tokens — Octopus Admin" };

/**
 * /admin/tokens — mint scoped service tokens for external apps (Claude/MCP/…).
 * Super-admin (vendor) only, mirroring /admin/telemetry: 404 for everyone else.
 * Self-host operators mint via scripts/mint-service-token.ts instead.
 */
export default async function ServiceTokensPage() {
  if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true") notFound();
  const sa = await getSuperAdmin();
  if (!sa) notFound();

  const tokens = await prisma.serviceToken.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return (
    <TokensClient
      allScopes={ALL_SCOPES}
      tokens={tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        scopes: t.scopes,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
