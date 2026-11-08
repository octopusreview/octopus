import { mock } from "bun:test";
import assert from "node:assert/strict";

let exists = true;
let updateFails = true;
let queryStatus = 400;
const requests: string[] = [];
const marker = "synthetic-secret-response-body";
const points = [
  { id: 1, score: 0.9, payload: { title: "First", text: "One", page: "guide", section: "intro" } },
  { id: 2, score: 0.7, payload: { title: "Second", text: "Two", page: "faq", section: "help" } },
];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  requests.push(`${request.method} ${path}`);
  if (path === "/") return Response.json({ version: "1.18.0" });
  if (path === "/collections") return Response.json({ result: { collections: exists ? [{ name: "docs_chunks" }] : [] }, status: "ok" });
  if (path === "/collections/docs_chunks" && request.method === "PATCH" && updateFails) {
    return Response.json({ status: { error: marker } }, { status: 400 });
  }
  if (path.endsWith("/points/query")) {
    if (queryStatus) return Response.json({ status: { error: marker } }, { status: queryStatus });
    return Response.json({ result: { points }, status: "ok" });
  }
  if (path.endsWith("/points/search")) return Response.json({ result: points, status: "ok" });
  return Response.json({ result: true, status: "ok" });
} });
process.env.QDRANT_URL = server.url.toString();
process.env.QDRANT_API_KEY = "";
mock.module("server-only", () => ({}));
const logs: unknown[][] = [];
const debug = console.debug;
const warn = console.warn;
console.debug = (...args) => { logs.push(args); };
console.warn = (...args) => { logs.push(args); };
try {
  const { ensureDocsCollection, searchDocsChunks } = await import("@/lib/qdrant");
  await ensureDocsCollection();
  assert.equal(logs.filter(([message]) => String(message).includes("sparse vector config")).length, 1);
  const expected = points.map(({ payload, score }) => ({ ...payload, score }));
  assert.deepEqual(await searchDocsChunks([1, 0, 0], 2, "hello"), expected);
  assert.equal(logs.filter(([message]) => String(message).includes("Falling back to dense-only search")).length, 1);
  assert.ok(!JSON.stringify(logs).includes(marker), JSON.stringify(logs));
  assert.ok(requests.includes("POST /collections/docs_chunks/points/search"));
  queryStatus = 503;
  await assert.rejects(searchDocsChunks([1, 0, 0], 2, "hello"));
  queryStatus = 0;
  assert.deepEqual(await searchDocsChunks([1, 0, 0], 2, "hello"), expected);
  assert.deepEqual(await searchDocsChunks([1, 0, 0], 2), expected);
  updateFails = false;
  await ensureDocsCollection();
  exists = false;
  await ensureDocsCollection();
  assert.ok(requests.includes("PUT /collections/docs_chunks"));
  assert.equal(requests.filter((request) => request === "PUT /collections/docs_chunks/index").length, 2);
  assert.equal(logs.filter(([message]) => String(message).includes("sparse vector config")).length, 1);
  assert.equal(logs.filter(([message]) => String(message).includes("Falling back to dense-only search")).length, 1);
} finally {
  console.debug = debug;
  console.warn = warn;
  server.stop(true);
}
