import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("GitHub webhook tenant enforcement", () => {
  it("routes by the signed installation while preserving telemetry and lifecycle behavior", async () => {
    const harnessPath = fileURLToPath(
      new URL("./fixtures/github-webhook-tenant-enforcement-harness.ts", import.meta.url),
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
      invalidSignatureRejected: true,
      trustedRoutingEnforced: true,
      unmappedInstallationDropped: true,
      mergedAndMentionScoped: true,
      ledgerFailureNonFatal: true,
      uninstallTenantCaptured: true,
    });
  });
});
