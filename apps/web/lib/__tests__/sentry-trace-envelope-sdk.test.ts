import { expect, it } from "bun:test";
import { join } from "node:path";

for (const mode of ["static", "stream", "unsampled", "edge", "edge-stream"]) {
  it(`sanitizes synthetic request fields in ${mode} SDK trace envelopes`, async () => {
    const child = Bun.spawn([process.execPath, ...(mode.startsWith("edge") ? ["--conditions=edge"] : []),
      join(import.meta.dir, "fixtures/sentry-trace-envelope-sdk.ts"), mode], { stdout: "pipe", stderr: "pipe", env: {
      ...process.env, SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", OCTOPUS_TEST_TRACE_QUERY: crypto.randomUUID(),
      OCTOPUS_TEST_TRACE_HEADER: crypto.randomUUID(), OCTOPUS_TEST_TRACE_BODY: crypto.randomUUID(), OCTOPUS_TEST_TRACE_JOB: crypto.randomUUID(),
    } });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${stdout}\n${stderr}`).toBe(0);
    } finally { clearTimeout(timeout); }
  }, 15_000);
}
