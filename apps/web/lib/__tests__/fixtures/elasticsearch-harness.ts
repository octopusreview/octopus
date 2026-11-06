import { mock } from "bun:test";
import assert from "node:assert/strict";

type Entry = { orgId: string; repoId: string; timestamp: number; message: string; level: "info" | "error"; indexAttemptId?: string };
const legacy: Entry[] = Array.from({ length: 600 }, (_, i) => ({ orgId: "org-a", repoId: "repo-a", timestamp: i, message: `event ${i}`, level: "info" }));
legacy.push({ orgId: "org-b", repoId: "repo-a", timestamp: 1000, message: "other org", level: "error" });
legacy.push({ orgId: "org-a", repoId: "repo-b", timestamp: 1001, message: "other repo", level: "error" });
const tagged: Entry[] = [
  { orgId: "org-a", repoId: "repo-a", indexAttemptId: "current", timestamp: 1, message: "current", level: "info" },
  { orgId: "org-a", repoId: "repo-a", indexAttemptId: "previous", timestamp: 2, message: "old", level: "info" },
  { orgId: "org-b", repoId: "repo-a", indexAttemptId: "current", timestamp: 3, message: "other org", level: "info" },
];
const writes: Array<{ index: string; body: Entry }> = [];
mock.module("@elastic/elasticsearch", () => ({ Client: class {
  indices = { exists: async () => true };
  async index(request: { index: string; body: Entry }) { writes.push(request); }
  async search(query: { index: string; size: number; query: { bool: { filter: Array<{ term: Record<string, string> }> } }; sort: Array<{ timestamp: { order: string } }> }) {
    const terms = Object.assign({}, ...query.query.bool.filter.map(filter => filter.term));
    const scoped = query.index === "octopus_repo_sync_attempts";
    assert.equal(query.index, scoped ? "octopus_repo_sync_attempts" : "octopus_repo_sync");
    const direction = query.sort[0].timestamp.order === "desc" ? -1 : 1;
    return { hits: { hits: (scoped ? tagged : legacy).filter(row => row.orgId === terms[scoped ? "orgId.keyword" : "orgId"] && row.repoId === terms[scoped ? "repoId.keyword" : "repoId"] && (!scoped || row.indexAttemptId === terms["indexAttemptId.keyword"]))
      .sort((a, b) => direction * (a.timestamp - b.timestamp)).slice(0, query.size).map(row => ({ _source: row })) } };
  }
} }));
process.env.ELASTICSEARCH_URL = "http://localhost:9200";
const { getSyncLogs, writeSyncLog } = await import("../../elasticsearch");
const logs = await getSyncLogs("org-a", "repo-a", 500);
assert.equal(logs.length, 500);
assert.deepEqual(logs.map(row => row.timestamp), Array.from({ length: 500 }, (_, i) => i + 100));
assert.ok(logs.every(row => row.orgId === "org-a" && row.repoId === "repo-a"));
assert.deepEqual((await getSyncLogs("org-a", "repo-a", 500, "current")).map(row => row.message), ["current"]);
await writeSyncLog({ orgId: "org-a", repoId: "repo-a", timestamp: 0, message: "legacy write", level: "info" });
assert.equal(writes[0].index, "octopus_repo_sync");
assert.equal(writes[0].body.indexAttemptId, undefined);
