import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("GitLab webhook tenant enforcement", () => {
  it("authenticates the integration before selecting its repository", async () => {
    const harnessPath = fileURLToPath(
      new URL("./fixtures/gitlab-webhook-tenant-enforcement-harness.ts", import.meta.url),
    );
    const process = Bun.spawn([globalThis.process.execPath, harnessPath], {
      cwd: globalThis.process.cwd(),
      env: globalThis.process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    const resultLine = stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .at(-1);
    expect(resultLine).toBeDefined();
    expect(JSON.parse(resultLine!)).toEqual({
      tenantSecretSelectedRepository: true,
      tokenCheckedBeforeBody: true,
      invalidTokenRejected: true,
      ambiguousTokenRejected: true,
      unownedAndInactiveDropped: true,
      mergedAndNoteScoped: true,
    });
  });
});
