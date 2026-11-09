import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("derives private credential and installation rate identities", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-index-rate-scope.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", OCTOPUS_DATA_KEY: "1".repeat(64), BETTER_AUTH_SECRET: "synthetic-legacy-key" },
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
