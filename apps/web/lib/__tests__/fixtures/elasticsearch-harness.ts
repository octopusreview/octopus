import { mock } from "bun:test";
import assert from "node:assert/strict";

type Entry = { orgId: string; repoId: string; timestamp: number; message: string; level: "info" | "error"; indexAttemptId?: string; createdAt?: string };
const legacy: Entry[] = Array.from({ length: 600 }, (_, i) => ({ orgId: "org-a", repoId: "repo-a", timestamp: i, message: `event ${i}`, level: "info" }));
legacy.push({ orgId: "org-b", repoId: "repo-a", timestamp: 1000, message: "other org", level: "error" });
legacy.push({ orgId: "org-a", repoId: "repo-b", timestamp: 1001, message: "other repo", level: "error" });
const tagged: Entry[] = [
  { orgId: "org-a", repoId: "repo-a", indexAttemptId: "current", timestamp: 1, message: "current", level: "info" },
  { orgId: "org-a", repoId: "repo-a", indexAttemptId: "previous", timestamp: 2, message: "old", level: "info" },
  { orgId: "org-b", repoId: "repo-a", indexAttemptId: "current", timestamp: 3, message: "other org", level: "info" },
];
const writes: Array<{ index: string; body: Entry }> = [];
let fail: "write" | "read" | "delete" | null = null;
class SyntheticElasticsearch {
  indices = { exists: async () => true };
  async index(request: { index: string; body: Entry }) {
    if (fail === "write") throw new Error("synthetic-private-exception");
    writes.push(request);
    if (request.index === "octopus_repo_sync") legacy.push(request.body);
    if (request.index === "octopus_repo_sync_attempts") tagged.push(request.body);
  }
  async search(query: { index: string; size: number; query: { bool: { filter: Array<{ term: Record<string, string> }> } }; sort: Array<{ timestamp: { order: string } }> }) {
    if (fail === "read") throw new Error("synthetic-private-exception");
    const terms = Object.assign({}, ...query.query.bool.filter.map(filter => filter.term));
    const scoped = query.index === "octopus_repo_sync_attempts";
    assert.equal(query.index, scoped ? "octopus_repo_sync_attempts" : "octopus_repo_sync");
    const direction = query.sort[0].timestamp.order === "desc" ? -1 : 1;
    return { hits: { hits: (scoped ? tagged : legacy).filter(row => row.orgId === terms[scoped ? "orgId.keyword" : "orgId"] && row.repoId === terms[scoped ? "repoId.keyword" : "repoId"] && (!scoped || row.indexAttemptId === terms["indexAttemptId.keyword"]))
      .sort((a, b) => direction * (a.timestamp - b.timestamp)).slice(0, query.size).map(row => ({ _source: row })) } };
  }
  async deleteByQuery() { if (fail === "delete") throw new Error("synthetic-private-exception"); }
}
mock.module("@elastic/elasticsearch", () => ({ Client: SyntheticElasticsearch }));
process.env.ELASTICSEARCH_URL = "http://localhost:9200";
const { getSyncLogs, writeSyncLog, deleteSyncLogs } = await import("../../elasticsearch");
const logs = await getSyncLogs("org-a", "repo-a", 500);
assert.equal(logs.length, 500);
assert.deepEqual(logs.map(row => row.timestamp), Array.from({ length: 500 }, (_, i) => i + 100));
assert.ok(logs.every(row => row.orgId === "org-a" && row.repoId === "repo-a"));
assert.deepEqual((await getSyncLogs("org-a", "repo-a", 500, "current")).map(row => row.message), ["current"]);
await writeSyncLog({ orgId: "org-a", repoId: "repo-a", timestamp: 0, message: "legacy write", level: "info" });
assert.equal(writes[0].index, "octopus_repo_sync");
assert.equal(writes[0].body.indexAttemptId, undefined);
assert.equal(writes[0].body.message, "Indexing message withheld for privacy.");
for (const indexAttemptId of [undefined, "synthetic-attempt"]) {
  await writeSyncLog({ orgId: "privacy-org", repoId: "privacy-repo", indexAttemptId, timestamp: 1, message: "Failed /private/path: synthetic-token", level: "error" });
  assert.equal(writes.at(-1)?.body.message, "Indexing message withheld for privacy.");
  await writeSyncLog({ orgId: "privacy-org", repoId: "privacy-repo", indexAttemptId, timestamp: 2, message: "Processed 5 files, skipped 0", level: "info" });
  assert.equal(writes.at(-1)?.body.message, "Processed 5 files, skipped 0");
}


const es = new SyntheticElasticsearch();
const oldWriter = async (entry: Entry) => es.index({
  index: "octopus_repo_sync",
  body: { ...entry, createdAt: new Date(entry.timestamp).toISOString() },
});
const oldReader = async (orgId: string, repoId: string) => {
  const result = await es.search({
    index: "octopus_repo_sync", size: 500,
    query: { bool: { filter: [{ term: { orgId } }, { term: { repoId } }] } },
    sort: [{ timestamp: { order: "desc" } }],
  });
  return result.hits.hits.map(hit => hit._source).reverse();
};
const oldEntry: Entry = { orgId: "compat-org", repoId: "compat-repo", timestamp: 100, message: "old writer", level: "info" };
const currentEntry: Entry = { orgId: "compat-org", repoId: "compat-repo", timestamp: 200, message: "Processed 5 files, skipped 0", level: "info" };
await oldWriter(oldEntry);
await oldWriter({ ...oldEntry, orgId: "other-org", message: "other tenant" });
await oldWriter({ ...oldEntry, repoId: "other-repo", message: "other repository" });
await writeSyncLog(currentEntry);
const expected = [
  { ...oldEntry, createdAt: "1970-01-01T00:00:00.100Z" },
  { ...currentEntry, createdAt: "1970-01-01T00:00:00.200Z" },
];
assert.deepEqual(await oldReader("compat-org", "compat-repo"), expected);
assert.deepEqual(await getSyncLogs("compat-org", "compat-repo"), expected);
assert.deepEqual((await oldReader("other-org", "compat-repo")).map(row => row.message), ["other tenant"]);
assert.deepEqual((await getSyncLogs("other-org", "compat-repo")).map(row => row.message), ["other tenant"]);
const errors: unknown[][] = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args); };
try {
  fail = "write";
  await writeSyncLog(currentEntry);
  fail = "read";
  assert.deepEqual(await getSyncLogs("org-a", "repo-a"), []);
  fail = "delete";
  await deleteSyncLogs("org-a", "repo-a");
  assert.deepEqual(errors, [["Failed to write sync log to ES"], ["Failed to read sync logs from ES"], ["Failed to delete sync logs from ES"]]);
} finally { console.error = originalError; }
