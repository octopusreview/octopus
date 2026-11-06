import { mock } from "bun:test";
import assert from "node:assert/strict";

const entries = Array.from({ length: 600 }, (_, i) => ({ orgId: "org-a", repoId: "repo-a", timestamp: i, message: `event ${i}`, level: "info" }));
entries[598].message = "synthetic-private-path synthetic-secret";
Object.assign(entries[598], { extra: "synthetic-secret" });
entries[599].message = "Processing local batch 1/2";
entries.push({ orgId: "org-b", repoId: "repo-a", timestamp: 1000, message: "other org", level: "error" });
entries.push({ orgId: "org-a", repoId: "repo-b", timestamp: 1001, message: "other repo", level: "error" });
const stored: Array<{ message: string }> = [];
let failRead = false;
let failWrite = false;
let failDelete = false;
mock.module("@elastic/elasticsearch", () => ({ Client: class {
  indices = { exists: async () => true };
  async index({ body }: { body: { message: string } }) { if (failWrite) throw new Error("synthetic-secret"); stored.push(body); }
  async deleteByQuery() { if (failDelete) throw new Error("synthetic-secret"); }
  async search(query: { size: number; query: { bool: { filter: Array<{ term: Record<string, string> }> } }; sort: Array<{ timestamp: { order: string } }> }) {
    if (failRead) throw new Error("synthetic-secret");
    const terms = Object.assign({}, ...query.query.bool.filter.map(filter => filter.term));
    const direction = query.sort[0].timestamp.order === "desc" ? -1 : 1;
    return { hits: { hits: entries.filter(row => row.orgId === terms.orgId && row.repoId === terms.repoId)
      .sort((a, b) => direction * (a.timestamp - b.timestamp)).slice(0, query.size).map(row => ({ _source: row })) } };
  }
} }));
process.env.ELASTICSEARCH_URL = "http://localhost:9200";
const { getSyncLogs, writeSyncLog, deleteSyncLogs } = await import("../../elasticsearch");
const logs = await getSyncLogs("org-a", "repo-a", 500);
assert.equal(logs.length, 500);
assert.deepEqual(logs.map(row => row.timestamp), Array.from({ length: 500 }, (_, i) => i + 100));
assert.ok(logs.every(row => row.orgId === "org-a" && row.repoId === "repo-a"));

assert.equal(logs.at(-2)?.message, "Saved indexing message withheld for privacy.");
assert.doesNotMatch(JSON.stringify(logs.at(-2)), /synthetic-secret|synthetic-private-path/);
assert.equal(logs.at(-1)?.message, "Processing local batch 1/2");
await writeSyncLog({ orgId: "org-a", repoId: "repo-a", timestamp: 1, level: "error", message: "synthetic-private-path synthetic-secret" });
await writeSyncLog({ orgId: "org-a", repoId: "repo-a", timestamp: 2, level: "info", message: "Processing local batch 1/2" });
assert.equal(stored[0].message, "Saved indexing message withheld for privacy.");
assert.equal(stored[1].message, "Processing local batch 1/2");
const output: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { output.push(args); };
try {
  failRead = true; await getSyncLogs("org-a", "repo-a");
  failWrite = true; await writeSyncLog({ orgId: "org-a", repoId: "repo-a", timestamp: 1, level: "error", message: "x" });
  failDelete = true; await deleteSyncLogs("org-a", "repo-a");
  assert.doesNotMatch(JSON.stringify(output), /synthetic-secret/);
  assert.equal(output.length, 3);
} finally { console.error = originalError; }
