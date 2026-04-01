export async function register() {
  // Only start queue workers on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startQueue } = await import("./lib/queue");
    await startQueue();
  }
}
