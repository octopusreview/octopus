import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("preserves approved progress and withholds untrusted stored text", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/safe-sync-logs-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("scopes sync logs to tagged attempts while preserving legacy and authorization behavior", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/sync-log-routes-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("selects legacy history through actual legacy local-upload transitions", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/legacy-local-log-owner-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it.skipIf(!process.env.LOCAL_INDEX_WRITER_FILE)("selects upload history through actual new-writer transitions", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/legacy-local-log-owner-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
