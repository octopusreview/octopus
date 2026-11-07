import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const scenario = process.argv[2];
assert.ok(["keyed", "keyless", "wrong", "wrong-signal"].includes(scenario));
const expectedKey = "synthetic-qdrant-key";
const requests: Array<{ path: string; key: string | undefined }> = [];
const server = createServer((req, res) => {
  const key = req.headers["api-key"] as string | undefined;
  requests.push({ path: req.url ?? "", key });
  res.setHeader("content-type", "application/json");
  if (scenario !== "keyless" && key !== expectedKey) {
    res.writeHead(401).end(JSON.stringify({ status: { error: "unauthorized" }, time: 0 }));
  } else if (req.url === "/") {
    res.end(JSON.stringify({ title: "qdrant - vector search engine", version: "1.18.0" }));
  } else if (req.url === "/collections") {
    res.end(JSON.stringify({ result: { collections: [{ name: "code_chunks" }] }, status: "ok", time: 0 }));
  } else {
    res.end(JSON.stringify({ result: true, status: "ok", time: 0 }));
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.QDRANT_URL = `http://127.0.0.1:${address.port}`;
process.env.QDRANT_API_KEY = scenario === "keyless" ? "" : scenario.startsWith("wrong") ? "synthetic-wrong" : expectedKey;
mock.module("server-only", () => ({}));
const warnings: string[] = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
try {
  const { ensureCollection } = await import("@/lib/qdrant");
  if (scenario.startsWith("wrong")) {
    await assert.rejects(ensureCollection(scenario === "wrong-signal" ? new AbortController().signal : undefined));
    assert.ok(requests.some((request) => request.key === "synthetic-wrong"));
  } else {
    await ensureCollection();
    await ensureCollection(new AbortController().signal);
    const lookups = requests.filter((r) => r.path === "/collections");
    assert.equal(lookups.length, 2);
    assert.ok(lookups.every((r) => r.key === (scenario === "keyed" ? expectedKey : undefined)));
  }
  assert.ok(warnings.every((message) => !message.includes(expectedKey)));
} finally {
  console.warn = warn;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
