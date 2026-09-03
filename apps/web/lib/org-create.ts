import { prisma } from "@octopus/db";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";
import { canUserCreateOrg, hasEverOwnedOrg } from "@/lib/org-limits";
import { assessWelcomeCredit, logWelcomeOutcome } from "@/lib/welcome-credit";
import { addFreeCredits } from "@/lib/credits";
import { MAX_OWNED_ORGS_PER_USER, WELCOME_FREE_CREDITS } from "@/lib/constants";

/**
 * Sentinel stored in `Organization.welcomeRiskReason` when the welcome grant
 * is deferred at org creation (owner has no OAuth `accounts` row). The
 * deferred release REQUIRES this marker: `welcomeGrantedAt` shipped nullable
 * with no backfill, so every pre-stamp user still has NULL there — without
 * the marker, their next repo sync would mint a retroactive bonus. Only the
 * two creation paths (createOrgForUser and the createOrganization action)
 * may write it.
 */
export const WELCOME_DEFERRED_REASON = "deferred_no_oauth";

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

  // Assess welcome-bonus risk before the tx (reads only); the tx confirms
  // first-org atomically.
  const welcome = await assessWelcomeCredit(userId);

  // Re-check limit and create atomically to prevent TOCTOU race
  const created = await prisma.$transaction(async (tx) => {
    const ownedCount = await tx.organizationMember.count({
      where: { userId, role: "owner", deletedAt: null, organization: { deletedAt: null } },
    });
    if (ownedCount >= MAX_OWNED_ORGS_PER_USER) {
      throw new Error(`Organization limit reached (max ${MAX_OWNED_ORGS_PER_USER}).`);
    }

    // First org = bonus not yet granted (leak-proof stamp) AND never owned an
    // org (soft-delete-safe). `ownedCount` above is active-only (drives the cap).
    const firstOrg = welcome.eligible && !(await hasEverOwnedOrg(tx, userId));

    // Consume the one-time bonus on the first org: stamp welcomeGrantedAt
    // exactly once (updateMany where null → only one tx wins, so concurrent
    // creates can't double-grant). A WITHHELD first org still consumes the
    // bonus, so it can't be retried after an org hard-delete. Credits are added
    // only when the claim wins AND the risk score clears.
    //
    // Users with no OAuth credential (magic-link signups have no `accounts`
    // row) get neither claim nor grant here: their bonus is DEFERRED to the
    // first repository connect (grantDeferredWelcomeCredit below) — a real
    // product signal a signup farm doesn't produce. welcomeGrantedAt stays
    // null so the deferred path can claim it.
    let grantBonus = false;
    let deferred = false;
    if (firstOrg) {
      const hasOauthAccount = (await tx.account.count({ where: { userId } })) > 0;
      if (hasOauthAccount) {
        const claim = await tx.user.updateMany({
          where: { id: userId, welcomeGrantedAt: null },
          data: { welcomeGrantedAt: new Date() },
        });
        grantBonus = claim.count === 1 && welcome.grant;
      } else {
        deferred = true;
      }
    }

    const org = await tx.organization.create({
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
          welcomeRiskScore: welcome.score,
          welcomeRiskReason: deferred ? WELCOME_DEFERRED_REASON : welcome.reason,
        }),
        ...(grantBonus && {
          freeCreditBalance: WELCOME_FREE_CREDITS,
          creditTransactions: {
            create: {
              amount: WELCOME_FREE_CREDITS,
              type: "free_credit",
              description: `Welcome bonus — $${WELCOME_FREE_CREDITS} free credits`,
              balanceAfter: WELCOME_FREE_CREDITS,
            },
          },
        }),
      },
    });
    return { org, firstOrg, granted: grantBonus, deferred };
  });
  const org = created.org;

  // Surface a silently-withheld (or race-lost) welcome bonus in the logs.
  // A deferred grant isn't withheld — it's pending first repo connect.
  if (!created.deferred) {
    logWelcomeOutcome({ userId, orgId: org.id, firstOrg: created.firstOrg, granted: created.granted, decision: welcome });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompleted: true },
  });

  return org;
}

/**
 * Deferred welcome grant — call after repositories are connected to an org
 * via a real forge integration (GitHub App install/sync/webhook, GitLab or
 * Bitbucket OAuth callback). Releases the bonus for users whose grant was
 * skipped at org creation because they have no OAuth credential (magic-link
 * signups): connecting a repo is the product signal a signup farm doesn't
 * produce. Do NOT call it from client-asserted repo-creation paths (CLI local
 * indexing, token-driven action/OSS review payloads) — a farmed API token
 * could self-grant through those.
 *
 * Only orgs marked WELCOME_DEFERRED_REASON at creation can release: legacy
 * orgs (pre-stamp owners with welcomeGrantedAt=NULL, never backfilled) don't
 * carry the marker, so they can't mint a retroactive bonus. A Bitbucket
 * workspace or GitLab namespace already attached to ANOTHER org doesn't
 * count as a product signal either — one bought forge account must not
 * release grants for unlimited farmed orgs (GitHub needs no such check:
 * Organization.githubInstallationId is unique).
 *
 * Idempotent: the once-per-user welcomeGrantedAt claim (updateMany where null)
 * means multiple repos, retries, and concurrent connects grant at most once.
 * A hold/block risk band still withholds — and consumes the claim — exactly
 * like the org-creation path. Never throws: a grant failure must not break a
 * repo connect.
 */
export async function grantDeferredWelcomeCredit(orgId: string): Promise<void> {
  try {
    const owner = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, role: "owner", deletedAt: null, organization: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { userId: true, organization: { select: { welcomeRiskReason: true } } },
    });
    if (!owner) return;
    // No deferral marker → nothing was deferred for this org (legacy org, or
    // marker already consumed by a prior release). Refuse.
    if (owner.organization.welcomeRiskReason !== WELCOME_DEFERRED_REASON) return;

    const welcome = await assessWelcomeCredit(owner.userId);
    if (!welcome.eligible) return; // already granted/claimed — the common repeat-connect case

    // Refuse (without consuming the claim) when this org's forge identity is
    // shared with another org — a later unshared connect can still release.
    const [bb, gl] = await Promise.all([
      prisma.bitbucketIntegration.findUnique({
        where: { organizationId: orgId },
        select: { workspaceSlug: true },
      }),
      prisma.gitlabIntegration.findUnique({
        where: { organizationId: orgId },
        select: { gitlabHost: true, namespacePath: true },
      }),
    ]);
    const forgeReused =
      (bb !== null &&
        (await prisma.bitbucketIntegration.count({
          where: { workspaceSlug: bb.workspaceSlug, organizationId: { not: orgId } },
        })) > 0) ||
      (gl !== null &&
        (await prisma.gitlabIntegration.count({
          where: { gitlabHost: gl.gitlabHost, namespacePath: gl.namespacePath, organizationId: { not: orgId } },
        })) > 0);
    if (forgeReused) {
      console.warn("[welcome-credit] deferred welcome grant refused: forge already attached to another org", {
        orgId,
        userId: owner.userId,
      });
      return;
    }

    const claim = await prisma.user.updateMany({
      where: { id: owner.userId, welcomeGrantedAt: null },
      data: { welcomeGrantedAt: new Date() },
    });
    if (claim.count !== 1) return; // lost a concurrent claim

    await prisma.organization.update({
      where: { id: orgId },
      data: { welcomeRiskScore: welcome.score, welcomeRiskReason: welcome.reason },
    });

    if (welcome.grant) {
      // Not atomic with the claim above (addFreeCredits runs its own tx). A
      // crash in between fails CLOSED — no credits, admin can grant manually —
      // which beats duplicating the credit arithmetic in a nested tx.
      await addFreeCredits(
        orgId,
        WELCOME_FREE_CREDITS,
        `Welcome bonus — $${WELCOME_FREE_CREDITS} free credits`,
      );
    }
    logWelcomeOutcome({ userId: owner.userId, orgId, firstOrg: true, granted: welcome.grant, decision: welcome });
  } catch (err) {
    console.error("[welcome-credit] deferred welcome grant failed:", err);
  }
}
