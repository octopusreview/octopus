export async function register() {
  // Only start queue workers on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reconcileStaleRepoStates } = await import("./lib/boot-reconciler");
    await reconcileStaleRepoStates();

    const { startQueue } = await import("./lib/queue");
    const boss = await startQueue();

    // Recover orphaned community-review jobs (server restart, worker death, etc.)
    // Must run after startQueue so enqueue() works.
    const { recoverCommunityReviewJobs, cleanupExpiredCommunityReviewJobs } = await import(
      "./lib/community-review-recovery"
    );
    if (process.env.ENABLE_REVIEW_WORKERS === "true") {
      await recoverCommunityReviewJobs();
      await cleanupExpiredCommunityReviewJobs();

      // Periodic TTL cleanup (every hour)
      const cleanupTimer = setInterval(() => {
        cleanupExpiredCommunityReviewJobs().catch((err) =>
          console.error("[community-review/recovery] periodic cleanup failed:", err),
        );
      }, 60 * 60 * 1000);
      cleanupTimer.unref?.();

      // Polling fallback for PR review triggering — see lib/pr-poller.ts for
      // the why. Databricks Apps' OAuth proxy blocks GitHub webhooks, so we
      // poll instead. Only the review-engine replica runs this, just like the
      // pg-boss workers.
      const { startPrPoller } = await import("./lib/pr-poller");
      startPrPoller();
    }

    // Graceful shutdown: wait for active jobs (e.g. in-progress reviews) to finish
    const shutdown = async () => {
      console.log("[queue] Graceful shutdown, waiting for active jobs...");
      await boss.stop({ graceful: true, timeout: 300_000 }); // 5 min
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
