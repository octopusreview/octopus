import { prisma } from "@octopus/db";

// Never cache a readiness probe — it must reflect the instance's live state.
export const dynamic = "force-dynamic";

// Bound the DB check so a hung/unresponsive database fails the probe fast
// (returns 503) rather than letting the request hang.
const DB_CHECK_TIMEOUT_MS = 2000;

/**
 * GET /api/health — unauthenticated readiness probe for the Cloudflare load
 * balancer (per-origin monitor) and the blue-green deploy gate. Returns 200 when
 * this instance can reach its primary database (the dependency every request
 * needs), else 503 so the LB stops routing to it / the deploy doesn't promote a
 * not-ready leg. Intentionally does NOT gate on Qdrant/Redis — those degrade
 * search/reviews but the app still serves, so they shouldn't pull a leg out of
 * rotation. No data is returned beyond a coarse status.
 */
export async function GET() {
  try {
    // Bound the probe at the DRIVER level: `SET LOCAL statement_timeout` makes
    // Postgres abort the query and RELEASE the pooled connection if the DB is
    // slow/hung. (A raced, uncancellable promise would 503 fast but leave the
    // query — and its checked-out connection — pending, so repeated probes
    // against a degraded DB could exhaust the pool and starve real traffic.)
    // The $transaction timeout is a belt-and-suspenders overall bound. The
    // interpolated value is a hardcoded constant, so $executeRawUnsafe is safe.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${DB_CHECK_TIMEOUT_MS}`);
        await tx.$queryRaw`SELECT 1`;
      },
      { timeout: DB_CHECK_TIMEOUT_MS + 1000 },
    );
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
