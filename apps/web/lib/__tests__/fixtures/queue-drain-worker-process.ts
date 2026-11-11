// Parent-side helpers for tests that run queue-drain-worker-harness.ts as real worker processes.
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const harness = fileURLToPath(new URL("./queue-drain-worker-harness.ts", import.meta.url));

export async function until(check: () => unknown, label: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(25);
  }
}

/** Resolves once the process has read the drain row and, if allowed, registered its worker. */
export async function startWorkerProcess({ queue, databaseUrl, serverId, mode = "", version = "0.0.0" }: {
  queue: string; databaseUrl: string; serverId: string; mode?: string; version?: string;
}) {
  const child = Bun.spawn([process.execPath, harness, queue, mode], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl, OCTOPUS_SERVER_ID: serverId, NEXT_PUBLIC_APP_VERSION: version, ENABLE_REVIEW_WORKERS: "true" },
  });
  const output = { stdout: "", stderr: "" };
  for (const stream of ["stdout", "stderr"] as const) {
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of child[stream] as ReadableStream<Uint8Array>) output[stream] += decoder.decode(chunk);
    })();
  }
  const count = (line: string) => output.stdout.split("\n").filter(item => item === line).length;
  const saw = (line: string) => until(() => {
    if (child.exitCode !== null && !count(line)) throw new Error(`worker ended before "${line}": ${output.stdout}\n${output.stderr}`);
    return count(line);
  }, line);
  await saw("ready");
  return { child, output, count, saw, serverId };
}
