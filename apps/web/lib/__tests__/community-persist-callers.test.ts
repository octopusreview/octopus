import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["worker", "worker-no-pr", "worker-job-transferred", "worker-cancelled", "worker-cancelled-after-generation", "action"]) {
  it(`does not complete after a community ownership failure: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/community-persist-callers.ts", import.meta.url)), scenario], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });
}
