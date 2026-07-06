import { prisma } from "@octopus/db";
import { createHash } from "crypto";

export async function authenticateApiToken(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token.startsWith("oct_")) {
    return null;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const apiToken = await prisma.orgApiToken.findUnique({
    where: { tokenHash, deletedAt: null },
    include: {
      organization: true,
      createdBy: true,
    },
  });

  if (!apiToken) {
    return null;
  }

  // Check expiration
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    return null;
  }

  // Check if org is banned
  if (apiToken.organization.bannedAt || apiToken.organization.deletedAt) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  prisma.orgApiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    org: apiToken.organization,
    user: apiToken.createdBy,
    token: apiToken,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `oct_${hex}`;
}

export function getTokenPrefix(token: string): string {
  return token.slice(0, 8) + "...";
}

// Platform-global service tokens (scoped; see lib/scopes.ts). Distinct `oct_svc_`
// namespace + 32-byte body. The prefix includes a few random chars so tokens are
// distinguishable in the admin list (plain "oct_svc_" would collide).
export function generateServiceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `oct_svc_${hex}`;
}

export function serviceTokenPrefix(token: string): string {
  return token.slice(0, 16) + "..."; // "oct_svc_" + 8 hex chars
}
