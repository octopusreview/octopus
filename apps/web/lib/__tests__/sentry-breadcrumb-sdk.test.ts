import { expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

for (const mode of ["server", "browser", "edge"]) {
  const label = mode === "browser" ? "browser filter with the Node SDK" : `${mode} SDK`;
  it(`removes synthetic breadcrumb values from the ${label} transport`, async () => {
    const command = [process.execPath, ...(mode === "edge" ? ["--conditions=edge"] : []),
      join(import.meta.dir, "fixtures/sentry-breadcrumb-sdk.ts"), mode];
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: {
      ...process.env, SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "",
      OCTOPUS_TEST_BREADCRUMB_QUERY: crypto.randomUUID(), OCTOPUS_TEST_BREADCRUMB_TOKEN: crypto.randomUUID(),
    } });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${stdout}\n${stderr}`).toBe(0);
    } finally { clearTimeout(timeout); }
  }, 15_000);
}

it("sanitizes an automatically recorded Node HTTP breadcrumb", async () => {
  const directory = await mkdtemp(join(tmpdir(), "octopus-sentry-breadcrumb-"));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  try {
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/sentry-breadcrumb-http.ts")], target: "node" });
    expect(build.success, build.logs.join("\n")).toBe(true);
    const artifact = join(directory, "probe.mjs");
    await Bun.write(artifact, build.outputs[0]);
    const child = Bun.spawn(["node", artifact], { stdout: "pipe", stderr: "pipe", env: {
      PATH: process.env.PATH, OCTOPUS_TEST_BREADCRUMB_TARGET: server.url.href,
      OCTOPUS_TEST_BREADCRUMB_QUERY: crypto.randomUUID(),
    } });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${stdout}\n${stderr}`).toBe(0);
    } finally { clearTimeout(timeout); }
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
