import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("drives the OpenAI-compatible adapters and embeddings through the real SDK over loopback HTTP", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/openai-sdk-real-harness.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 25_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr, stdout: stdout.trim() }).toEqual({ code: 0, stderr: "", stdout: "PASS real OpenAI SDK adapters, failures and embeddings" });
  } finally { clearTimeout(deadline); }
}, 30_000);
