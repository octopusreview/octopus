import { NextRequest } from "next/server";
import { prisma } from "@octopus/db";
import { createHash } from "crypto";

export async function authenticateStatusToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const apiToken = await prisma.statusApiToken.findUnique({
    where: { tokenHash, deletedAt: null },
  });

  if (!apiToken) return null;

  // Update lastUsedAt
  prisma.statusApiToken
    .update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return apiToken;
}
