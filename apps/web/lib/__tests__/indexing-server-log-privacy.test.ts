import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const mode of ["community", "action", "community-summary", "action-summary"]) {
  it(`withholds synthetic indexing errors from ${mode} server logs`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/indexing-server-log-privacy.ts", import.meta.url)), mode], { stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  });
}
