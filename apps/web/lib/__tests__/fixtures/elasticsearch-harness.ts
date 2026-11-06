import { mock } from "bun:test";
import assert from "node:assert/strict";

const entries = Array.from({ length: 600 }, (_, i) => ({ orgId: "org-a", repoId: "repo-a", timestamp: i, message: `event ${i}`, level: "info" }));
entries.push({ orgId: "org-b", repoId: "repo-a", timestamp: 1000, message: "other org", level: "error" });
entries.push({ orgId: "org-a", repoId: "repo-b", timestamp: 1001, message: "other repo", level: "error" });
mock.module("@elastic/elasticsearch", () => ({ Client: class {
  indices = { exists: async () => true };
  async search(query: { size: number; query: { bool: { filter: Array<{ term: Record<string, string> }> } }; sort: Array<{ timestamp: { order: string } }> }) {
    const terms = Object.assign({}, ...query.query.bool.filter.map(filter => filter.term));
    const direction = query.sort[0].timestamp.order === "desc" ? -1 : 1;
    return { hits: { hits: entries.filter(row => row.orgId === terms.orgId && row.repoId === terms.repoId)
      .sort((a, b) => direction * (a.timestamp - b.timestamp)).slice(0, query.size).map(row => ({ _source: row })) } };
  }
} }));
process.env.ELASTICSEARCH_URL = "http://localhost:9200";
const { getSyncLogs } = await import("../../elasticsearch");
const logs = await getSyncLogs("org-a", "repo-a", 500);
assert.equal(logs.length, 500);
assert.deepEqual(logs.map(row => row.timestamp), Array.from({ length: 500 }, (_, i) => i + 100));
assert.ok(logs.every(row => row.orgId === "org-a" && row.repoId === "repo-a"));
