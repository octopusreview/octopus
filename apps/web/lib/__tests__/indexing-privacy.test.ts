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
    "Starting indexing",
    "Indexing complete",
    "Local indexing batch failed",
    "Local indexing stopped: monthly spend limit reached",
    "GitHub indexing paused after repeated rate limits. Check GitHub limits before retrying.",
    "GitHub has blocked access to this repository, so it cannot be indexed.",
  ]) {
    expect(safeIndexLogMessage(message)).toBe(message);
    expect(safeIndexLogMessage(`${message} synthetic-secret`)).toBe("Indexing message withheld for privacy.");
  }
});

it("preserves bounded rate-limit progress without extra text", () => {
  expect(safeIndexLogMessage("Rate limited, waiting 60s...")).toBe("Rate limited, waiting 60s...");
  for (const message of ["Rate limited, waiting 60s... synthetic-secret", "Rate limited, waiting 1234567890123s...", "Rate limited, waiting NaNs..."]) {
    expect(safeIndexLogMessage(message)).toBe("Indexing message withheld for privacy.");
  }
});

it("keeps the denied-response retry message bounded and private", () => {
  for (const status of [403, 429]) {
    const message = `GitHub returned HTTP ${status}, waiting 5s before retry...`;
    expect(safeIndexLogMessage(message)).toBe(message);
    expect(safeIndexLogMessage(`${message} synthetic-secret`)).toBe("Indexing message withheld for privacy.");
  }
  expect(safeIndexLogMessage("GitHub returned HTTP 500, waiting 5s before retry...")).toBe("Indexing message withheld for privacy.");
});

it("keeps indexing errors private through hosted review outputs", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--indexing-review-privacy"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
