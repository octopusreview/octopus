import { prisma } from "@octopus/db";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";
import { canUserCreateOrg } from "@/lib/org-limits";
import { MAX_OWNED_ORGS_PER_USER } from "@/lib/constants";

/**
 * Creates an organization for a user. Pure DB operation — no cookie setting,
 * no auth check (callers are responsible).
 *
 * Why this lives in /lib instead of complete-profile/actions.ts:
 * Next.js treats EVERY export from a `"use server"` module as a publicly
 * invokable server action — a route reachable from any client that obtains
 * its action ID, with no session check beyond what the function performs
 * itself. This function takes `userId` as a parameter, so exporting it from
 * a "use server" module exposed an unauthenticated endpoint that any caller
 * could use to create owner-organizations for arbitrary user IDs (e.g. to
 * grief victims by exhausting their MAX_OWNED_ORGS_PER_USER cap).
 *
 * Keeping it in a plain server lib makes it importable from server-side
 * code (Server Components, server actions, route handlers) without being
 * routable on its own.
 */
export async function createOrgForUser(userId: string, userName: string) {
  const allowed = await canUserCreateOrg(userId);
  if (!allowed) {
    throw new Error(`Organization limit reached (max ${MAX_OWNED_ORGS_PER_USER}).`);
  }

  const firstName = userName.split(" ")[0];
  const orgName = `${firstName}'s Organization`;
  const baseSlug = toBaseSlug(orgName);

  // Generate unique slug with random suffix (checks all orgs including soft-deleted)
  let slug = `${baseSlug}-${randomSlugSuffix()}`;
  for (let i = 0; i < 10; i++) {
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) break;
    slug = `${baseSlug}-${randomSlugSuffix()}`;
  }

  // Re-check limit and create atomically to prevent TOCTOU race
  const org = await prisma.$transaction(async (tx) => {
    const ownedCount = await tx.organizationMember.count({
      where: { userId, role: "owner", deletedAt: null, organization: { deletedAt: null } },
    });
    if (ownedCount >= MAX_OWNED_ORGS_PER_USER) {
      throw new Error(`Organization limit reached (max ${MAX_OWNED_ORGS_PER_USER}).`);
    }

    const firstOrg = ownedCount === 0;

    return tx.organization.create({
      data: {
        name: orgName,
        slug,
        members: {
          create: {
            userId,
            role: "owner",
          },
        },
        ...(firstOrg && {
          freeCreditBalance: 150,
          creditTransactions: {
            create: {
              amount: 150,
              type: "free_credit",
              description: "Welcome bonus — $150 free credits",
              balanceAfter: 150,
            },
          },
        }),
      },
    });
  });

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompleted: true },
  });

  return org;
}
