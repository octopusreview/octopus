import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PgBoss } from "pg-boss";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";
const databaseUrl = enabled ? localQueueTestDatabaseUrl(process.env.DATABASE_URL) : undefined;
const harness = fileURLToPath(new URL("./fixtures/queue-shutdown-harness.ts", import.meta.url));

// Start the child, send SIGTERM once its job is running, and report how the job ended.
let childOutput = "";
async function terminateMidJob(mode: "next" | "manual" | "unfixed" | "inline" | "inline-bound") {
  const schema = `pgboss_test_${randomUUID().replaceAll("-", "")}`;
  const observer = new PgBoss({ connectionString: databaseUrl!, schema });
  observer.on("error", () => {});
  const child = Bun.spawn([process.execPath, harness, schema, mode], { stdout: "pipe", stderr: "pipe" });
  try {
    let output = "";
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    while (!output.includes("job-started") || !/job-id (\S+)\r?\n/.test(output)) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`child ended early: ${output}\n${await new Response(child.stderr).text()}`);
      output += decoder.decode(value);
    }
    const id = /job-id (\S+)/.exec(output)![1];
    child.kill("SIGTERM");
    const code = await child.exited;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) output += decoder.decode(chunk.value);
    childOutput = output;
    await observer.start();
    return { code, state: (await observer.getJobById("slow", id))?.state };
  } finally {
    child.kill("SIGKILL");
    await observer.getDb().executeSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await observer.stop({ graceful: false, close: true }).catch(() => {});
  }
}

it.skipIf(!enabled)("lets an in-flight job finish before Next's signal handler exits the process", async () => {
  expect(await terminateMidJob("next")).toEqual({ code: 143, state: "completed" });
}, 40_000);

it.skipIf(!enabled)("exits by itself after the drain when nothing else handles the signal", async () => {
  expect(await terminateMidJob("manual")).toEqual({ code: 0, state: "completed" });
}, 40_000);

it.skipIf(!enabled)("without the shutdown hook the same signal abandons the job", async () => {
  const result = await terminateMidJob("unfixed");
  expect(result.code).toBe(143);
  expect(result.state).toBe("active");
}, 40_000);

it.skipIf(!enabled)("waits for detached inline work as well as the job", async () => {
  expect(await terminateMidJob("inline")).toEqual({ code: 143, state: "completed" });
  expect(childOutput).toContain("inline-finished");
}, 40_000);

it.skipIf(!enabled)("stops waiting for inline work when the bound passes", async () => {
  const started = Date.now();
  expect(await terminateMidJob("inline-bound")).toEqual({ code: 143, state: "completed" });
  expect(childOutput).not.toContain("inline-finished");
  expect(Date.now() - started).toBeLessThan(15_000);
}, 40_000);
