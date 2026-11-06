import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
for (const fixture of ["indexing-admin-privacy.ts", "indexing-failure-event-privacy.ts"]) {
  it(`keeps synthetic indexing errors private: ${fixture}`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  });
}
