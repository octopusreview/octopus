import "server-only";
import { prisma } from "@octopus/db";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";
import { canUserCreateOrg } from "@/lib/org-limits";
import { MAX_OWNED_ORGS_PER_USER } from "@/lib/constants";
import { acquireOrgCreationLock } from "@/lib/org-creation-lock";

/**
 * Pure DB operation: create an Organization owned by `userId` with a
 * derived name + slug, grant the $150 welcome-credit on first org. NO
 * authentication — the caller is responsible for asserting that the
 * acting session legitimately owns `userId`.
 *
 * This function lives in `lib/` (not in any `"use server"` module)
 * deliberately. Exports from `"use server"` modules are automatically
 * registered as invokable server actions reachable from any client, so
 * placing this function there would expose an unauthenticated, callable
 * "create org owned by arbitrary user" endpoint (and the originally
 * shipped code did — see the audit finding that prompted this lib).
 *
 * Callers:
 *   - `(app)/complete-profile/actions.ts:completeProfile`
 *   - `(app)/layout.tsx` (first-login auto-create — userId comes from session)
 *   - `api/cli/auth/orgs/route.ts` (userId comes from session)
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

  // Per-user advisory lock so concurrent calls for the same user serialize.
  // Without this, two parallel transactions both see ownedCount === 0 under
  // Postgres's default read-committed isolation and both insert an org with
  // the $150 welcome bonus.
  const org = await prisma.$transaction(async (tx) => {
    await acquireOrgCreationLock(tx, userId);

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
