import { prisma } from "@octopus/db";
import { enqueue } from "./queue";

const LOG = (msg: string, ...rest: unknown[]) =>
  console.log(`[community-review/recovery] ${msg}`, ...rest);
const ERR = (msg: string, ...rest: unknown[]) =>
  console.error(`[community-review/recovery] ${msg}`, ...rest);

// Jobs whose updatedAt is older than this without progressing are considered
// orphaned (worker died, server restarted mid-flight, etc.) and re-enqueued.
const STALE_MS = 5 * 60 * 1000;

/**
 * Boot-time recovery for community-review jobs.
 *
 * Scenarios this handles:
 * - Server restarted while a job was indexing/reviewing → updatedAt freezes,
 *   this re-enqueues so the worker resumes.
 * - Job past expiresAt → mark failed + audit (TTL enforcement).
 *
 * Periodic cleanup (delete expired completed/failed rows) is handled
 * separately so old jobs don't accumulate forever.
 */
export async function recoverCommunityReviewJobs() {
  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_MS);

    // 1. Expire jobs past their TTL while still in flight.
    const expired = await prisma.communityReviewJob.findMany({
      where: {
        status: { in: ["indexing", "reviewing"] },
        expiresAt: { lt: now },
      },
      select: { id: true, repoFullName: true, organizationId: true },
    });

    if (expired.length > 0) {
      LOG(`expiring ${expired.length} in-flight jobs past TTL`);
      for (const job of expired) {
        await prisma.communityReviewJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: "Job exceeded TTL while in flight",
            completedAt: now,
            githubToken: null,
          },
        });
        await prisma.auditLog.create({
          data: {
            action: "community_review.expired",
            category: "review",
            targetType: "community_review_job",
            targetId: job.id,
            organizationId: job.organizationId,
            metadata: { repoFullName: job.repoFullName, reason: "ttl_exceeded_in_flight" },
          },
        }).catch(() => {});
      }
    }

    // 2. Re-enqueue orphaned in-flight jobs (server restart recovery).
    const orphans = await prisma.communityReviewJob.findMany({
      where: {
        status: { in: ["indexing", "reviewing"] },
        updatedAt: { lt: staleCutoff },
        expiresAt: { gt: now },
      },
      select: { id: true, repoFullName: true, status: true, attempts: true },
    });

    if (orphans.length > 0) {
      LOG(`re-enqueueing ${orphans.length} orphaned jobs`);
      for (const job of orphans) {
        try {
          await enqueue("community-review", { jobId: job.id });
          LOG(`re-enqueued jobId=${job.id} repo=${job.repoFullName} status=${job.status} prevAttempts=${job.attempts}`);
        } catch (err) {
          ERR(`failed to re-enqueue jobId=${job.id}:`, err);
        }
      }
    } else {
      LOG("no orphan jobs to recover");
    }
  } catch (err) {
    ERR("recovery failed:", err);
  }
}

/**
 * Hard cleanup: delete community-review rows whose expiresAt is past.
 * Writes one audit log per cleanup batch (not per row) to stay cheap.
 */
export async function cleanupExpiredCommunityReviewJobs() {
  try {
    const now = new Date();

    // Pull a batch first so we can audit which IDs we're deleting.
    const batch = await prisma.communityReviewJob.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true, status: true, repoFullName: true, organizationId: true },
      take: 500,
    });

    if (batch.length === 0) {
      LOG("cleanup: nothing to delete");
      return { deleted: 0 };
    }

    const ids = batch.map((b) => b.id);
    const { count } = await prisma.communityReviewJob.deleteMany({
      where: { id: { in: ids } },
    });

    LOG(`cleanup: deleted ${count} expired jobs`);

    await prisma.auditLog.create({
      data: {
        action: "community_review.cleanup",
        category: "system",
        targetType: "community_review_job",
        metadata: {
          deletedCount: count,
          jobIds: ids,
          breakdown: batch.reduce<Record<string, number>>((acc, b) => {
            acc[b.status] = (acc[b.status] ?? 0) + 1;
            return acc;
          }, {}),
        },
      },
    }).catch((err) => ERR("cleanup audit log failed (non-fatal):", err));

    return { deleted: count };
  } catch (err) {
    ERR("cleanup failed:", err);
    return { deleted: 0, error: err };
  }
}
