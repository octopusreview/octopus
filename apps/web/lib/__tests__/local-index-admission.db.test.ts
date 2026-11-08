import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it.skipIf(process.env.RUN_LOCAL_INDEX_ADMISSION_DB_TESTS !== "1")("rejects a local index after its repository changes", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/local-index-admission-db.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  } finally { clearTimeout(timeout); }
}, 25_000);
