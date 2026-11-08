import { expect, it } from "bun:test";

it("preserves safe configuration outcomes for both local review paths", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--local-classification"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("reports safe terminal background failures through the provider router", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/background-failure-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("keeps provider error content out of review failures", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--provider-error-privacy"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("keeps embedding failures out of hosted review outputs", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--embedding-error-privacy"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("keeps cancelled embedding failures private without reporting them", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--embedding-cancel-privacy"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("keeps best-effort embedding and storage failures private", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--best-effort-privacy"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("retains safe generation-stage diagnostics in a failed review attempt", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--generation-failure-diagnostic"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("retains generation diagnostics through the real adapter and router", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/generation-diagnostic-route.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("forwards queue retries and reports only terminal uncancelled failures", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/queue-background-failure-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("identifies failed preparation fetches through the reviewer", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--preparation-diagnostic"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
