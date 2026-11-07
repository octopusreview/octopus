import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

let startFirst!: () => void;
let startSecond!: () => void;
const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
const secondStarted = new Promise<void>((resolve) => { startSecond = resolve; });
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
let lookups = 0;
let updates = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  res.setHeader("content-type", "application/json");
  if (path === "/") return res.end(JSON.stringify({ version: "1.18.0" }));
  if (path === "/collections" && req.method === "GET") {
    lookups++;
    if (lookups === 1) startFirst();
    else startSecond();
    await released;
    return res.end(JSON.stringify({ result: { collections: [{ name: "code_chunks" }] }, status: "ok", time: 0 }));
  }
  if (path === "/collections/code_chunks" && req.method === "PATCH") updates++;
  res.end(JSON.stringify({ result: true, status: "ok", time: 0 }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.QDRANT_URL = `http://127.0.0.1:${address.port}`;
mock.module("server-only", () => ({}));
try {
  const { ensureCollection } = await import("@/lib/qdrant");
  const first = new AbortController();
  const second = new AbortController();
  const reason = new DOMException("synthetic deadline", "TimeoutError");
  const firstResult = ensureCollection(first.signal).then(() => ({ ok: true }), (error) => ({ error }));
  await firstStarted;
  const secondResult = ensureCollection(second.signal).then(() => ({ ok: true }), (error) => ({ error }));
  await secondStarted;
  first.abort(reason);
  const outcome = await Promise.race([firstResult, delay(750, undefined, { ref: false }).then(() => "pending" as const)]);
  assert.ok(typeof outcome === "object" && "error" in outcome);
  assert.equal(outcome.error, reason);
  assert.equal(second.signal.aborted, false);
  release();
  assert.deepEqual(await secondResult, { ok: true });
  assert.equal(lookups, 2);
  assert.equal(updates, 1);
} finally {
  release();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
