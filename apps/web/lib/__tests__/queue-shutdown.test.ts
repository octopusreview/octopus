import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const harness = fileURLToPath(new URL("./fixtures/queue-shutdown-failure-harness.ts", import.meta.url));

async function terminate(mode: "alone" | "next") {
  const child = Bun.spawn([process.execPath, harness, mode], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  let output = "";
  while (!output.includes("ready")) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`child ended early: ${output}`);
    output += new TextDecoder().decode(value);
  }
  child.kill("SIGTERM");
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
}

it("exits non-zero when the queue could not be stopped and nothing else owns the signal", async () => {
  const { code, stderr } = await terminate("alone");
  expect(code).toBe(1);
  expect(stderr).toContain("Graceful shutdown failed: Error");
  expect(stderr).not.toContain("synthetic-secret");
}, 20_000);

it("keeps Next's exit code when the queue could not be stopped", async () => {
  expect((await terminate("next")).code).toBe(143);
}, 20_000);
