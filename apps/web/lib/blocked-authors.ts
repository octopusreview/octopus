import { prisma } from "@octopus/db";

/**
 * Check if a PR author is blocked from triggering reviews.
 * Combines global (SystemConfig) and org-level blocked author lists.
 */
export async function isAuthorBlocked(orgId: string, prAuthor: string): Promise<boolean> {
  const [org, systemConfig] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { blockedAuthors: true },
    }),
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { blockedAuthors: true },
    }),
  ]);

  const globalBlocked = (systemConfig?.blockedAuthors as string[]) ?? [];
  const orgBlocked = (org?.blockedAuthors as string[]) ?? [];

  const authorLower = prAuthor.toLowerCase();
  return [...globalBlocked, ...orgBlocked].some(
    (blocked) => blocked.toLowerCase() === authorLower,
  );
}
