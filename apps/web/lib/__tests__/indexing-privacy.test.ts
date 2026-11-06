import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { safeIndexLogMessage } from "../index-log-safety";
for (const fixture of ["indexing-admin-privacy.ts", "indexing-failure-event-privacy.ts"]) {
  it(`keeps synthetic indexing errors private: ${fixture}`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  });
}

it("preserves fixed indexing status messages without exposing appended details", () => {
  for (const message of [
    "Generating repository summary with AI...",
    "Repository summary generated",
    "Summary generation failed (indexing still succeeded)",
    "Go to GitHub Settings → Applications → Configure to grant access",
    "Indexing cancelled by user",
  ]) {
    expect(safeIndexLogMessage(message)).toBe(message);
    expect(safeIndexLogMessage(`${message} synthetic-secret`)).toBe("Indexing message withheld for privacy.");
  }
});
