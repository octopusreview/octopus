import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const { ForgejoResponseTooLargeError } = await import("@/lib/forgejo-http");
let details: { default_branch: string } | null = { default_branch: "main" };
let writes = 0;
const embedded: string[][] = [];
let afterUpsert: (() => void) | undefined;
let beforeEmbedding: (() => void) | undefined;
let afterEmbedding: (() => void) | undefined;
let invalidEmbeddings = false;
let suppliedToken: string | undefined = undefined;
let ignoreContent: string | null = null;
mock.module("@/lib/github", () => ({
  getInstallationToken: async () => { assert.equal(suppliedToken, undefined); return "test-token"; },
  getRepositoryDetails: async () => details,
  getFileContent: async (_id: number, _owner: string, _repo: string, _ref: string, path: string, token?: string) => {
    assert.equal(path, ".octopusignore");
    assert.equal(token, suppliedToken ?? "test-token");
    return ignoreContent;
  },
}));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
let forgejoFailure = false;
const forgejoSha = "f".repeat(40);
mock.module("@/lib/forgejo", () => ({
  runWithForgejoRepository: async (_id: string, callback: () => Promise<unknown>) => callback(),
  getBranchHead: async () => forgejoSha,
  getRepositoryTree: async (_org: string, _name: string, ref: string) => {
    assert.equal(ref, forgejoSha);
    return [".octopusignore", "index.ts", "ignored.ts", "oversized.ts"];
  },
  getFileContent: async (_org: string, _name: string, ref: string, file: string, options?: { strict?: boolean }) => {
    assert.equal(options?.strict, true);
    assert.equal(ref, forgejoSha);
    if (forgejoFailure) throw new Error("Forgejo unavailable");
    if (file === ".octopusignore") return "ignored.ts";
    if (file === "oversized.ts") throw new ForgejoResponseTooLargeError();
    assert.equal(file, "index.ts");
    return "export const greeting = 'hello';\n";
  },
}));
mock.module("@/lib/qdrant", () => ({
  ensureCollection: async () => { beforeEmbedding?.(); },
  deleteRepoFileChunks: async () => {},
  upsertChunks: async (_points: unknown[], owner: { repoId: string; indexAttemptId: string }) => { assert.equal(owner.indexAttemptId, "attempt-1"); writes++; afterUpsert?.(); },
}));
mock.module("@/lib/embeddings", () => ({
  createEmbeddings: async (texts: string[]) => {
    embedded.push(texts);
    afterEmbedding?.();
    return invalidEmbeddings ? [] : texts.map(() => [0.1]);
  },
}));
const { indexRepository } = await import("@/lib/indexer");
const emptySha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const responses = new Map<string, [number, unknown]>();
const requests: string[] = [];
globalThis.fetch = mock(async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  const suffix = url.replace("https://api.github.com/repos/acme/new", "");
  const [status, body] = responses.get(suffix) ?? [500, { message: `Unexpected URL: ${url}` }];
  return Response.json(body, { status });
}) as typeof fetch;

async function run(branch = "main") {
  return indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", branch, 123);
}
function reset() {
  responses.clear(); requests.length = 0; writes = 0; embedded.length = 0;
  details = { default_branch: "main" };
  responses.set("/contributors?per_page=30", [200, []]);
}

// Empty commit: GitHub's tree 404 must be verified against the existing commit.
reset();
responses.set("/git/trees/main?recursive=1", [404, { message: "Git Repository is empty." }]);
responses.set("/commits/main", [200, { commit: { tree: { sha: emptySha } } }]);
assert.equal((await run()).totalFiles, 0);
assert.equal(writes, 0, "empty snapshots need no staged vectors");
assert.equal(embedded.length, 0, "empty trees must not be embedded");

reset();
responses.set("/git/trees/main?recursive=1", [409, { message: "Git Repository is empty." }]);
assert.equal((await run()).totalVectors, 0);

reset();
responses.set("/git/trees/main?recursive=1", [200, { tree: [] }]);
assert.equal((await run()).indexedFiles, 0);

reset();
responses.set("/git/trees/main?recursive=1", [200, {}]);
await assert.rejects(run, /Invalid repository tree response/);
assert.equal(writes, 0);

reset();
responses.set("/git/trees/main?recursive=1", [404, { message: "Not Found" }]);
responses.set("/commits/main", [404, { message: "Not Found" }]);
await assert.rejects(run, /Branch 'main' not found/);
assert.equal(writes, 0);

reset();
responses.set("/git/trees/main?recursive=1", [404, {}]);
responses.set("/commits/main", [200, { commit: { tree: { sha: "nonempty-tree" } } }]);
await assert.rejects(run, /no tree for existing branch/);
assert.equal(writes, 0);

reset(); details = null;
responses.set("/git/trees/main?recursive=1", [404, {}]);
await assert.rejects(run, /does not have access/);
assert.equal(writes, 0);

for (const status of [403, 429, 451, 500, 409]) {
  reset(); responses.set("/git/trees/main?recursive=1", [status, { message: "Failure" }]);
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, status === 429 ? /GitHub indexing is temporarily rate limited/ : new RegExp(`Failed to fetch tree: ${status}`));
    assert.equal((error as Error & { status?: number }).status, status);
    return true;
  });
  assert.equal(writes, 0);
}

reset();
responses.set("/git/trees/main?recursive=1", [404, {}]);
responses.set("/commits/main", [429, {}]);
await assert.rejects(run, /GitHub indexing is temporarily rate limited/);

// Keep branch correction and branch names containing slashes working.
reset(); details = { default_branch: "release/main" };
responses.set("/git/trees/main?recursive=1", [404, {}]);
responses.set("/git/trees/release%2Fmain?recursive=1", [404, {}]);
responses.set("/commits/release%2Fmain", [200, { commit: { tree: { sha: emptySha } } }]);
assert.equal((await run()).resolvedDefaultBranch, "release/main");

// The same repository is indexable after its first push.
reset();
responses.set("/git/trees/main?recursive=1", [200, {
  tree: [{ path: "index.ts", type: "blob", sha: "blob-1", size: 35 }],
}]);
responses.set("/git/blobs/blob-1", [200, {
  encoding: "base64", content: Buffer.from("export const greeting = 'hello';\n").toString("base64"),
}]);
const populated = await run();
assert.equal(populated.indexedFiles, 1);
assert.ok(populated.totalVectors > 0);
assert.equal(embedded.length, 1);
console.log("14 indexing regressions passed");

reset();
const forgejoResult = await indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 0, undefined, undefined, "forgejo", "org-1");
assert.equal(forgejoResult.indexedFiles, 1);
assert.equal(forgejoResult.totalFiles, 4, "inventory includes files skipped by indexing limits and ignore rules");
assert.equal(requests.length, 0, "Forgejo must use its validated transport instead of GitHub or git clone");
reset(); forgejoFailure = true;
await assert.rejects(indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 0, undefined, undefined, "forgejo", "org-1"), /Forgejo unavailable/);
assert.equal(writes, 0, "failed fetch must preserve the prior index");

// Incomplete snapshots must fail before replacing the previous searchable data.
reset();
responses.set("/git/trees/main?recursive=1", [200, { tree: [
  { path: "index.ts", type: "blob", sha: "good", size: 35 },
  { path: "missing.ts", type: "blob", sha: "bad", size: 35 },
] }]);
responses.set("/git/blobs/good", [200, { encoding: "base64", content: Buffer.from("export const good = 1;").toString("base64") }]);
responses.set("/git/blobs/bad", [500, {}]);
await assert.rejects(run, /Indexing incomplete/);
assert.equal(writes, 0, "a partially fetched tree must preserve the previous index");
assert.equal(embedded.length, 0);

reset();
responses.set("/git/trees/main?recursive=1", [200, { tree: [], truncated: true }]);
await assert.rejects(run, /partial repository tree/);
assert.equal(writes, 0);

reset();
responses.set("/git/trees/main?recursive=1", [200, { tree: [
  { path: "index.ts", type: "blob", sha: "good", size: 35 },
] }]);
responses.set("/git/blobs/good", [200, { encoding: "base64", content: Buffer.from("export const good = 1;").toString("base64") }]);
invalidEmbeddings = true;
await assert.rejects(run, /embedding results/);
invalidEmbeddings = false;
const controller = new AbortController();
afterUpsert = () => controller.abort(new Error("Indexing cancelled"));
await assert.rejects(() => indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 123, undefined, controller.signal), /Indexing cancelled/);
afterUpsert = undefined;
console.log("Incomplete tree, file failure, embedding failure and late cancellation regressions passed");

reset();
suppliedToken = "actions-fixture-token";
ignoreContent = "ignored.ts";
responses.set("/git/trees/main?recursive=1", [200, { tree: [
  { path: ".octopusignore", type: "blob", sha: "ignore" },
  { path: "index.ts", type: "blob", sha: "good" },
  { path: "ignored.ts", type: "blob", sha: "ignored" },
] }]);
responses.set("/git/blobs/good", [200, { encoding: "base64", content: Buffer.from("export const good = 1;").toString("base64") }]);
const tokenResult = await indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 0, undefined, undefined, "github", "org-1", suppliedToken);
assert.equal(tokenResult.indexedFiles, 1);
assert.ok(tokenResult.totalVectors > 0);
assert.ok(!requests.some(url => url.endsWith("/git/blobs/ignored")));
ignoreContent = null;
await assert.rejects(() => indexRepository({ repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 0, undefined, undefined, "github", "org-1", suppliedToken), /could not read .octopusignore/);

const sentryEvents: unknown[] = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: unknown) => { sentryEvents.push(event); return "e".repeat(32); } }));
const indexRow = { indexStatus: "indexing", indexAttemptId: "attempt-1" };
mock.module("@octopus/db", () => ({ prisma: { repository: {
  findUniqueOrThrow: async () => ({ ...indexRow }),
  updateMany: async ({ data }: { data: { indexStatus: string } }) => { Object.assign(indexRow, data); return { count: 1 }; },
} } }));
const { runRepositoryIndex, isIndexingCancelled } = await import("../../repository-index-completion");
const { reportBackgroundFailure } = await import("../../background-failure");
reset();
suppliedToken = undefined;
responses.set("/git/trees/main?recursive=1", [451, { message: "private upstream details" }]);
try {
  await run();
  assert.fail("Expected the upstream refusal to fail indexing");
} catch (error) {
  reportBackgroundFailure(error, { stage: "indexing", retry: { retryCount: 2, retryLimit: 2 } });
}
assert.equal((sentryEvents.at(-1) as { tags: { failure_code: string } }).tags.failure_code, "http_451");
assert.ok(!JSON.stringify(sentryEvents.at(-1)).includes("private upstream details"));
for (const boundary of ["before-embedding", "after-embedding"]) {
  for (const timeout of [false, true]) {
    reset(); suppliedToken = undefined; indexRow.indexStatus = "indexing";
    responses.set("/git/trees/main?recursive=1", [200, { tree: [{ path: "index.ts", type: "blob", sha: "good", size: 35 }] }]);
    responses.set("/git/blobs/good", [200, { encoding: "base64", content: Buffer.from("export const good = 1;").toString("base64") }]);
    const controller = new AbortController();
    const abort = () => timeout ? controller.abort(new DOMException("Deadline", "TimeoutError")) : controller.abort();
    beforeEmbedding = boundary === "before-embedding" ? abort : undefined;
    afterEmbedding = boundary === "after-embedding" ? abort : undefined;
    let rawError: unknown;
    let failure: unknown;
    try {
      await runRepositoryIndex("repo-1", "attempt-1", () => indexRepository(
        { repoId: "repo-1", indexAttemptId: "attempt-1" }, "acme/new", "main", 123, undefined, controller.signal,
      ).catch(error => { rawError = error; throw error; }), controller.signal);
    } catch (error) { failure = error; }
    assert.equal(rawError, controller.signal.reason);
    assert.equal(failure, controller.signal.reason);
    assert.equal(indexRow.indexStatus, timeout ? "failed" : "pending");
    assert.equal(writes, 0);
    const before = sentryEvents.length;
    const context = { stage: "indexing" as const, attemptId: "attempt-1", cancelled: isIndexingCancelled(controller.signal) };
    reportBackgroundFailure(failure, { ...context, retry: { retryCount: 1, retryLimit: 2 } });
    assert.equal(sentryEvents.length, before);
    reportBackgroundFailure(failure, { ...context, retry: { retryCount: 2, retryLimit: 2 } });
    assert.equal(sentryEvents.length, before + Number(timeout));
    reportBackgroundFailure(failure, context);
    assert.equal(sentryEvents.length, before + Number(timeout));
  }
}
beforeEmbedding = afterEmbedding = undefined;
console.log("PASS actual indexer cancellation messages preserve timeout and terminal reporting");
