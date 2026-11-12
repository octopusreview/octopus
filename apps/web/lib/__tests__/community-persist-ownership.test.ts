import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("fails closed when repository ownership cannot be established", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/community-persist-ownership.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
