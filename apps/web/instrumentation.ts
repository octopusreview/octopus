export async function register() {
  // Only start queue workers on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reconcileStaleRepoStates } = await import("./lib/boot-reconciler");
    await reconcileStaleRepoStates();

    // Self-hosted only: seed a default admin if the user table is empty.
    // The seeded account is forced to change its password on first sign-in.
    // No-op on the hosted SaaS (flag unset).
    if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true") {
      const { bootstrapDefaultAdmin } = await import("./lib/bootstrap-admin");
      await bootstrapDefaultAdmin();
    }

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

      // Daily audit-log retention enforcement (03:00 UTC). pg-boss dedups the
      // schedule across instances; the worker in queue-workers.ts runs the
      // deletion. Self-hosters tune the window via AUDIT_LOG_RETENTION_DAYS.
      await boss.schedule("enforce-audit-retention", "0 3 * * *");

      // Daily ActivityEvent (live-telemetry) retention (04:00 UTC — offset from
      // the audit job to avoid simultaneous deleteMany load). Window tunable via
      // ACTIVITY_RETENTION_DAYS (default 30).
      await boss.schedule("enforce-activity-retention", "0 4 * * *");

      // Daily release-cache refresh (05:00 UTC — offset from the retention jobs).
      // Gated to self-hosted: the release-check/update panel only surfaces there
      // (same server-side flag the admin bootstrap above uses). pg-boss dedups
      // the cron across instances; the worker in queue-workers.ts does the fetch.
      if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true") {
        await boss.schedule("refresh-release-cache", "0 5 * * *");
      }
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
