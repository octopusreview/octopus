import type { Prisma } from "@octopus/db";

/**
 * Per-user pg advisory lock for the org-creation critical section.
 *
 * Two sibling functions create an Organization + maybe-grant the $150
 * welcome-credit on first org: `createOrganization` (the user-facing
 * server action) and `createOrgForUser` (the layout's first-login
 * auto-create). Both check `ownedCount === 0` to gate the bonus, and
 * both are vulnerable to the same TOCTOU race under Postgres's default
 * read-committed isolation: two parallel transactions see ownedCount=0,
 * both insert orgs, both grant the bonus.
 *
 * Centralising the lock acquisition here keeps the two call sites from
 * drifting (different keys, missing one site entirely) and gives future
 * org-creation paths a single point to wire through.
 *
 * Implementation note: `pg_advisory_xact_lock` takes a bigint, but
 * `hashtextextended(text, seed)` returns a bigint signed in (-2^63..2^63).
 * We pass the seed `0` (the conventional empty-key marker) and use a
 * scoped key string so the lock can't collide with any other advisory
 * lock callers elsewhere in the codebase.
 */
export async function acquireOrgCreationLock(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"createOrgForUser:" + userId}, 0))`;
}
