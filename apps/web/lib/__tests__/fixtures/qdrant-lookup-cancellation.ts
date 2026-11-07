import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["pre-aborted", "existing-cancel", "missing-cancel", "error-cancel", "error", "existing-success", "missing-success"].includes(scenario));
const existing = scenario.startsWith("existing");
const cancelled = scenario.endsWith("cancel");
let started!: () => void;
const entered = new Promise<void>((resolve) => { started = resolve; });
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
const writes: string[] = [];
let lookups = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  res.setHeader("content-type", "application/json");
  if (path === "/") return res.end(JSON.stringify({ version: "1.18.0" }));
  if (path === "/collections" && req.method === "GET") {
    lookups++;
    started();
    if (cancelled) await released;
    if (scenario.startsWith("error")) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ status: { error: "synthetic failure" }, time: 0 }));
    }
    return res.end(JSON.stringify({ result: { collections: existing ? [{ name: "code_chunks" }] : [] }, status: "ok", time: 0 }));
  }
  writes.push(`${req.method} ${path}`);
  res.end(JSON.stringify({ result: true, status: "ok", time: 0 }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.QDRANT_URL = `http://127.0.0.1:${address.port}`;
mock.module("server-only", () => ({}));
try {
  const { ensureCollection } = await import("@/lib/qdrant");
  const controller = new AbortController();
  const reason = new DOMException("synthetic deadline", "TimeoutError");
  if (scenario === "pre-aborted") controller.abort(reason);
  const result = ensureCollection(cancelled || scenario === "pre-aborted" ? controller.signal : undefined).then(() => ({ ok: true }), (error) => ({ error }));
  if (scenario === "pre-aborted") {
    const outcome = await result;
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
    assert.equal(lookups, 0);
    assert.deepEqual(writes, []);
  } else if (cancelled) {
    await entered;
    controller.abort(reason);
    assert.equal(await Promise.race([result, delay(150).then(() => "pending")]), "pending");
    release();
    const outcome = await result;
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
    assert.deepEqual(writes, []);
  } else if (scenario === "error") {
    const outcome = await result;
    assert.ok("error" in outcome);
    assert.match(String(outcome.error), /Internal Server Error/);
    assert.deepEqual(writes, []);
  } else {
    assert.deepEqual(await result, { ok: true });
    assert.deepEqual(writes, existing ? ["PATCH /collections/code_chunks"] : ["PUT /collections/code_chunks", "PUT /collections/code_chunks/index"]);
  }
} finally {
  release();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
