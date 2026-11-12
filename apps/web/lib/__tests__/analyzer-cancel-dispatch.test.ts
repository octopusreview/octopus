import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("repository analysis cancellation before model dispatch", () => {
  for (const scenario of ["provider-lookup", "key-lookup", "router-pre-aborted", "normal"]) {
    it(`AI router: ${scenario}`, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/analyzer-router-cancel.ts", import.meta.url)), scenario], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)), stdout: "pipe", stderr: "pipe", env: process.env,
      });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      clearTimeout(watchdog);
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
    });
  }
  for (const scenario of ["during-model-selection", "pre-aborted", "normal-success", "spend-limit", "model-error"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/analyzer-cancel-dispatch.ts", import.meta.url)), scenario], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)), stdout: "pipe", stderr: "pipe", env: process.env,
      });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      clearTimeout(watchdog);
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
    });
  }
});
