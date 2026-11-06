import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["success", "error-complete", "success-body", "error-body"]) {
  it(`bounds the complete Ollama response (${scenario})`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/agent-ollama-timeout-harness.ts", import.meta.url)), scenario], { stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  }, 7000);
}
