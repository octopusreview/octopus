import { expect, it } from "bun:test";
import { join } from "node:path";

for (const environment of ["development", "production"]) {
  it(`keeps unexpected local-review errors private in ${environment}`, async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/cli-review-safe-errors.ts")], {
      env: { ...process.env, NODE_ENV: environment }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  });
}

it("safely handles embedding dimension and reranker failures", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/provider-safe-failures.ts")], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
}, 10000);
