import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

(process.env.RUN_REAPER_DB_TESTS === "1" ? describe : describe.skip)("review reaper with PostgreSQL", () => {
  it("preserves fresh claims and retries only unchanged stale reviews", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/reaper-race-synthetic.ts", import.meta.url))], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  }, 30_000);

  it("records the attempt of a review whose worker stopped, once", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/reaper-interrupted-attempt-db.ts", import.meta.url))], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  }, 30_000);
});
