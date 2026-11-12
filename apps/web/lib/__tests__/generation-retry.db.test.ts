import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

(process.env.RUN_GENERATION_RETRY_DB_TESTS === "1" ? describe : describe.skip)("review generation retry with PostgreSQL", () => {
  it("keeps one durable generation budget and debits a keyed charge once", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/generation-retry-db.ts", import.meta.url))], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  }, 30_000);

  it("keeps failed attempts with unknown usage out of the daily usage chart", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/usage-unknown-db.tsx", import.meta.url))], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  }, 30_000);
});
