import "server-only";
import { prisma } from "@octopus/db";
import { enqueue, loadQueueConfig, computeStaleReclaimMs } from "./queue";

// Reviews that die mid-flight (engine restart on deploy, crash, OOM, or a hang
// past the job timeout) are left in "reviewing"/"queued" forever: the finalize
// path never runs, so no error is written, and pg-boss's own retries hit the
// claim guard inside the stale-reclaim window and get skipped. Without this
// reaper they accumulate as permanent silent orphans (observed: 37 days' worth).
//
// The reaper marks every orphan `failed` with a real message — `failed` is
// re-claimable, so a future push / @octopus re-review works cleanly — and, for
// PRs young enough that a re-review is still wanted, enqueues one auto-retry.
// The singletonKey throttles that to at most one reaper-requeue per PR per hour,
// so a genuinely poison PR can't be re-reviewed in a tight loop.

const REQUEUE_MAX_AGE_MS =
  (Number(process.env.OCTOPUS_REAP_REQUEUE_MAX_AGE_HOURS) || 6) * 60 * 60 * 1000;

export const REAP_FAILED_MESSAGE =
  "Review interrupted by a server restart or timeout. Push a new commit or comment @octopus to retry.";

export async function reapStuckReviews(
  now: Date = new Date(),
): Promise<{ requeued: number; failed: number }> {
  const config = await loadQueueConfig();
  // Same two windows as the claim guard (reviewer.ts): "reviewing" uses the
  // in-process timeout, "queued" the longer internal-cli timeout. Both exceed
  // the pg-boss job timeout, so a row past the window is genuinely dead — a live
  // worker would have been killed by pg-boss before its updatedAt got this old.
  const reviewingStale = new Date(
    now.getTime() - computeStaleReclaimMs(config.reviewTimeoutSeconds),
  );
  const queuedStale = new Date(
    now.getTime() - computeStaleReclaimMs(config.largeReviewTimeoutSeconds),
  );

  const orphans = await prisma.pullRequest.findMany({
    where: {
      OR: [
        { status: "reviewing", updatedAt: { lt: reviewingStale } },
        { status: "queued", updatedAt: { lt: queuedStale } },
      ],
    },
    select: { id: true, createdAt: true, status: true, updatedAt: true, reviewRequestVersion: true },
  });

  const requeueCutoff = new Date(now.getTime() - REQUEUE_MAX_AGE_MS);
  let requeued = 0;
  let failed = 0;

  for (const pr of orphans) {
    // A new claim or request may have replaced the stale row since selection.
    const updated = await prisma.pullRequest.updateMany({
      where: { id: pr.id, status: pr.status, updatedAt: pr.updatedAt, reviewRequestVersion: pr.reviewRequestVersion },
      data: { status: "failed", errorMessage: REAP_FAILED_MESSAGE },
    });
    if (updated.count === 0) continue;

    if (pr.createdAt > requeueCutoff) {
      await enqueue(
        "process-review",
        { pullRequestId: pr.id },
        { singletonKey: `reap:${pr.id}`, singletonSeconds: 3600 },
      );
      requeued++;
    } else {
      failed++;
    }
  }

  return { requeued, failed };
}
