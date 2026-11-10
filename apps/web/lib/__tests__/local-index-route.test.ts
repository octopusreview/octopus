import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("reports an identity change without confusing legacy clients", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/local-index-route.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
