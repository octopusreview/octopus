import { mock } from "bun:test";
import assert from "node:assert/strict";

let failure = "";
let calls: string[] = [];
const secret = "synthetic-private-provider-response";
const fail = (stage: string) => {
  calls.push(stage);
  if (failure === stage) throw { message: secret, cause: { message: secret, status: 503, code: "ECONNRESET", response: { body: secret } } };
};
mock.module("server-only", () => ({}));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async () => { fail("embedding"); return [[1, 0, 0]]; } }));
mock.module("@/lib/qdrant", () => ({
  ensureFeedbackCollection: async () => { fail("collection"); },
  searchFeedbackPatterns: async () => { fail("search"); return [{ feedback: "down", cosineSimilarity: 0.95 }]; },
}));

const { suppressFindingsFromFeedback } = await import("@/lib/feedback-suppression");
const findings = [{ title: "Finding", description: "Description" }];
const scope = { repoId: "repo", orgId: "org" };
const warnings: unknown[][] = [];
console.warn = (...args) => { warnings.push(args); };
console.log = () => {};
for (const stage of ["collection", "embedding", "search"]) {
  failure = stage;
  assert.equal(await suppressFindingsFromFeedback(findings, scope), findings);
}
assert.equal(warnings.length, 3);
for (const warning of warnings) {
  assert.equal(JSON.stringify(warning).includes(secret), false);
  assert.deepEqual(warning[1], { name: "Error", status: 503, code: "ECONNRESET" });
}
failure = "";
assert.deepEqual(await suppressFindingsFromFeedback(findings, scope), []);
calls = [];
assert.deepEqual(await suppressFindingsFromFeedback([], scope), []);
assert.deepEqual(calls, []);
