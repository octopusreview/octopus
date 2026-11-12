import { expect, it } from "bun:test";

it("aborts a stalled contributors request and preserves successful indexing", async () => {
  const child = Bun.spawn([process.execPath, new URL("./fixtures/index-contributor-abort-harness.ts", import.meta.url).pathname], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(code, err + out).toBe(0);
}, 10_000);
