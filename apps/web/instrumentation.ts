export async function register() {
  // Only start queue workers on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reconcileStaleRepoStates } = await import("./lib/boot-reconciler");
    await reconcileStaleRepoStates();

    const { startQueue } = await import("./lib/queue");
    const boss = await startQueue();

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
