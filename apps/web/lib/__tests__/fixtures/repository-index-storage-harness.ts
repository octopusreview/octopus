import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { prisma, type Repository } from "@octopus/db";

export async function exerciseStorageRace(scenario: string, repo: Repository) {
  type Point = { id: string; vector: unknown; payload: Record<string, unknown> };
  type Filter = { must?: Filter[]; should?: Filter[]; key?: string; match?: { value?: unknown; any?: unknown[] }; is_empty?: { key: string } };
  const matches = (point: Point, filter: Filter): boolean => {
    if (filter.must && !filter.must.every(item => matches(point, item))) return false;
    if (filter.should && !filter.should.some(item => matches(point, item))) return false;
    if (filter.is_empty) return point.payload[filter.is_empty.key] == null;
    if (filter.key) return filter.match?.any ? filter.match.any.includes(point.payload[filter.key]) : point.payload[filter.key] === filter.match?.value;
    return true;
  };
  const stored = new Map<string, Point>();
  const deferred = () => {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  };
  const ready = deferred();
  const gate = deferred();
  const applied = deferred();
  let delay: "upsert" | "delete" | undefined;
  let timeoutRequest = false;
  let requestController: AbortController | undefined;
  let transportFailed = false;
  let sparseFailure = false;
  let deleteCalls = 0;
  const liveStorageUrl = scenario === "storage-legacy-rollout" ? process.env.FIRST_INDEX_QDRANT_URL : undefined;
  if (liveStorageUrl) assert.equal(new URL(liveStorageUrl).hostname, "127.0.0.1", "Live fixture storage must be local and disposable");
  const service = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === "GET" ? {} : await request.json();
    const reply = (result: unknown) => Response.json({ result, status: "ok", time: 0 });
    if (path === "/") return Response.json({ version: "1.18.0" });
    if (path === "/collections") return reply({ collections: [{ name: "code_chunks" }] });
    if (path === "/collections/code_chunks") return reply(true);
    const operation = request.method === "PUT" && path.endsWith("/points") ? "upsert" : path.endsWith("/delete") ? "delete" : undefined;
    if (operation) {
      assert.equal(url.searchParams.get("wait"), "true");
      const paused = operation === delay;
      if (paused) { delay = undefined; ready.resolve(); await gate.promise; }
      if (operation === "upsert") for (const point of body.points as Point[]) stored.set(point.id, point);
      else {
        deleteCalls++;
        for (const [id, point] of stored) if (matches(point, body.filter)) stored.delete(id);
      }
      if (paused) applied.resolve();
      return reply({ operation_id: 1, status: "completed" });
    }
    if (path.endsWith("/query") && sparseFailure) return Response.json({ status: { error: "Not existing vector name" } }, { status: 400 });
    const filters: Filter[] = body.prefetch ? body.prefetch.map((item: { filter: Filter }) => item.filter) : [body.filter];
    const points = [...stored.values()].filter(point => filters.every(filter => matches(point, filter))).slice(0, body.limit).map(point => ({ ...point, score: 1 }));
    if (path.endsWith("/scroll")) return reply({ points, next_page_offset: null });
    if (path.endsWith("/query")) return reply({ points });
    if (path.endsWith("/search")) return reply(points);
    throw new Error(`Unexpected fixture storage request: ${path}`);
  } });
  const storageUrl = new URL(liveStorageUrl ?? service.url.toString());
  process.env.QDRANT_URL = storageUrl.toString();
  mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ dim: 1 }) }));
  mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
  let content = "baseline";
  let empty = false;
  const files = () => Array.from({ length: 101 }, (_, i) => ({ path: `file${i}.ts`, content: `export const value = '${content}-${i}';` }));
  mock.module("@/lib/github", () => ({
    getInstallationToken: async () => "fixture-token",
    getRepositoryDetails: async () => ({ default_branch: "main" }),
    getFileContent: async (_id: number, _owner: string, _name: string, _ref: string, path: string) => path === ".octopusignore" ? null : `export const value = '${content}-${path}';`,
    addCommentReaction: async () => {}, getPullRequestDetails: async () => null, createCheckRun: async () => 1, updateCheckRun: async () => {},
  }));
  const nativeFetch = globalThis.fetch;
  const timeoutError = new DOMException("Fixture client timeout", "TimeoutError");
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === storageUrl.origin) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const operation = url.pathname.endsWith("/delete") ? "delete" : url.pathname.endsWith("/points") && method === "PUT" ? "upsert" : undefined;
      if (operation && transportFailed) return Promise.reject(timeoutError);
      if (operation && operation === delay && timeoutRequest) {
        timeoutRequest = false;
        requestController = new AbortController();
        return nativeFetch(input, { ...init, signal: requestController.signal });
      }
      return nativeFetch(input, init);
    }
    if (url.pathname.includes("/git/trees/")) return Promise.resolve(Response.json({ tree: empty ? [] : files().map(file => ({ type: "blob", path: file.path, sha: file.path })) }));
    if (url.pathname.includes("/git/blobs/")) return Promise.resolve(Response.json({ encoding: "base64", content: Buffer.from(`export const value = '${content}';`).toString("base64") }));
    if (url.pathname.includes("/contributors")) return Promise.resolve(Response.json([]));
    if (url.pathname.includes("/pulls/")) return Promise.resolve(Response.json([{ filename: url.pathname.includes("/2/") ? "file2.ts" : "file1.ts", status: "modified" }]));
    throw new Error(`Unexpected provider request: ${url}`);
  }) as typeof fetch;
  try {
    const { indexRepository, incrementalIndex } = await import("@/lib/indexer");
    const { runRepositoryIndex } = await import("@/lib/repository-index-completion");
    const { prepareRepoForLocalIndex, claimLocalIndexBatch, indexLocalBatch, recordLocalIndexProgress, markLocalIndexFailed } = await import("@/lib/index-local");
    const { deleteRepoFileChunks, upsertChunks, getRepoChunks, searchSimilarChunks, searchCodeChunksAcrossRepos, getQdrantClient, ensureCollection } = await import("@/lib/qdrant");
    const { buildRepoGraph } = await import("@/lib/repo-graph");
    const snapshot = () => prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
    const claim = async () => {
      const indexAttemptId = randomUUID();
      await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "indexing", indexAttemptId } });
      return indexAttemptId;
    };
    const full = (indexAttemptId: string) => runRepositoryIndex(repo.id, indexAttemptId, () => indexRepository(
      { repoId: repo.id, indexAttemptId }, repo.fullName, "main", 1,
    ));
    const stats = { indexedFiles: 1, totalFiles: 1, totalChunks: 1, totalVectors: 1, contributors: [], contributorCount: 0, durationMs: 1 };
    if (scenario === "storage-legacy-rollout") {
      const sharedId = randomUUID();
      const legacyPoint = { id: sharedId, vector: [1], payload: { repoId: repo.id, filePath: "code.ts", text: "legacy" } };
      await ensureCollection();
      await getQdrantClient().upsert("code_chunks", { wait: true, points: [legacyPoint] });
      await upsertChunks([{ ...legacyPoint, payload: { ...legacyPoint.payload, text: "new generation" } }], {
        repoId: repo.id, indexAttemptId: repo.indexAttemptId!,
      });
      // These are the deployed legacy reader/deleter contracts, with no
      // awareness of generations or the new database field.
      const legacyFilter = { must: [{ key: "repoId", match: { value: repo.id } }] };
      const legacyRead = () => getQdrantClient().search("code_chunks", {
        vector: [1], filter: legacyFilter, limit: 20, with_payload: true,
      });
      assert.deepEqual((await legacyRead()).map(point => point.payload?.text), ["legacy"], "Legacy readers must not see staged generations");
      await runRepositoryIndex(repo.id, repo.indexAttemptId!, async () => stats);
      assert.deepEqual((await searchCodeChunksAcrossRepos([repo.id], [1])).map(point => ({ repoId: point.repoId, text: point.text })), [
        { repoId: repo.id, text: "new generation" },
      ], "API results must retain the logical repository ID");
      await getQdrantClient().delete("code_chunks", { wait: true, filter: legacyFilter });
      assert.deepEqual(await getRepoChunks(repo.id), ["new generation"], "A late legacy repo-wide delete must not remove the active generation");
      await getQdrantClient().upsert("code_chunks", { wait: true, points: [legacyPoint] });
      assert.deepEqual(await getRepoChunks(repo.id), ["new generation"], "Legacy point IDs must not overwrite generation points");
      assert.deepEqual((await legacyRead()).map(point => point.payload?.text), ["legacy"]);
      assert.deepEqual((await buildRepoGraph(repo.id)).nodes.map(node => node.path), ["code.ts"]);
      return;
    }
    if (scenario === "storage-reads") {
      const sharedId = randomUUID();
      stored.set(sharedId, { id: sharedId, vector: [1], payload: { repoId: repo.id, filePath: "legacy.ts", text: "legacy" } });
      const other = await prisma.repository.create({ data: { organizationId: repo.organizationId, name: "Other", fullName: `fixture/${randomUUID()}`, externalId: randomUUID(), indexStatus: "indexed" } });
      const otherId = randomUUID();
      stored.set(otherId, { id: otherId, vector: [1], payload: { repoId: other.id, indexGeneration: null, filePath: "other.ts", text: "other legacy" } });
      const point = (text: string) => ({ id: sharedId, vector: [1], payload: { repoId: repo.id, filePath: `${text}.ts`, text } });
      await upsertChunks([point("staged")], { repoId: repo.id, indexAttemptId: repo.indexAttemptId! });
      assert.deepEqual(await getRepoChunks(repo.id), ["legacy"]);
      const replacement = await claim();
      await upsertChunks([point("replacement")], { repoId: repo.id, indexAttemptId: replacement });
      assert.equal(stored.size, 4, "Equal input IDs must remain distinct across generations and legacy data");
      assert.equal(stored.get(sharedId)?.payload.text, "legacy");
      assert.deepEqual(await getRepoChunks(repo.id), ["legacy"]);
      await runRepositoryIndex(repo.id, replacement, async () => stats);
      assert.equal((await snapshot()).activeIndexGeneration, replacement);
      const stagedOther = await prisma.repository.update({ where: { id: other.id }, data: { indexStatus: "indexing", indexAttemptId: randomUUID() } });
      await upsertChunks([{ id: sharedId, vector: [1], payload: { repoId: other.id, filePath: "hidden.ts", text: "other staged" } }], { repoId: other.id, indexAttemptId: stagedOther.indexAttemptId! });
      for (const query of [undefined, "fixture"]) {
        for (const fallback of [false, true]) {
          sparseFailure = fallback;
          assert.deepEqual((await searchSimilarChunks(repo.id, [1], 20, query)).map(point => point.text), ["replacement"]);
          assert.deepEqual((await searchCodeChunksAcrossRepos([repo.id, other.id], [1], 20, query)).map(point => point.text).sort(), ["other legacy", "replacement"]);
        }
      }
      assert.deepEqual(await getRepoChunks(repo.id), ["replacement"]);
      assert.deepEqual((await buildRepoGraph(repo.id)).nodes.map(node => node.path), ["replacement.ts"]);
      assert.equal((await buildRepoGraph(repo.id)).totalFiles, 1);
      assert.deepEqual(await getRepoChunks("missing-repo"), []);
      assert.deepEqual(await searchCodeChunksAcrossRepos(["missing-repo"], [1]), []);
      const first = (await snapshot()).firstIndexedAt;
      empty = true;
      await full(await claim());
      assert.deepEqual(await getRepoChunks(repo.id), []);
      assert.deepEqual((await buildRepoGraph(repo.id)).nodes, []);
      assert.deepEqual((await searchCodeChunksAcrossRepos([repo.id, other.id], [1])).map(point => point.text), ["other legacy"]);
      assert.deepEqual((await snapshot()).firstIndexedAt, first);
      return;
    }
    await full(repo.indexAttemptId!);
    const baseline = await snapshot();
    const baselineGeneration = baseline.activeIndexGeneration;
    assert.equal(baselineGeneration, repo.indexAttemptId);
    const prepare = (count = 101, batches = 1) => prepareRepoForLocalIndex(repo.organizationId, "github", repo.fullName, "main", { totalBatches: batches, totalFiles: count });
    const localBatch = async (uploadId: string | undefined, batchIndex = 0, totalBatches = 1, batch = files()) => {
      const owned = await claimLocalIndexBatch(repo.id, repo.organizationId, batchIndex, totalBatches, batch, uploadId);
      try {
        const delta = await indexLocalBatch(repo.id, repo.fullName, repo.organizationId, batch, owned);
        await recordLocalIndexProgress(repo.id, null, {
          indexedFiles: delta.indexedInBatch, totalChunks: delta.chunksInBatch, totalVectors: delta.chunksInBatch,
        }, batchIndex === totalBatches - 1, owned);
      } catch (error) { await markLocalIndexFailed(repo.id, owned.attemptId); throw error; }
    };
    if (scenario === "storage-local-verified" || scenario === "storage-local-legacy") {
      await prisma.repository.update({ where: { id: repo.id }, data: { externalId: `cli:github:${repo.fullName}`, indexedAt: null, firstIndexedAt: null } });
      const prepared = await prepare(2, 2);
      assert.ok(prepared.ok);
      content = "local";
      await localBatch(prepared.uploadId, 0, 2, files().slice(0, 1));
      assert.ok((await getRepoChunks(repo.id)).every(text => text.includes("baseline")));
      assert.equal((await snapshot()).activeIndexGeneration, baselineGeneration);
      await localBatch(scenario === "storage-local-legacy" ? undefined : prepared.uploadId, 1, 2, files().slice(1, 2));
      const completed = await snapshot();
      assert.equal(completed.activeIndexGeneration, prepared.uploadId);
      assert.equal(completed.firstIndexedAt !== null, scenario === "storage-local-verified");
      assert.ok(completed.indexedAt);
      assert.equal((await getRepoChunks(repo.id)).length, 2);
      assert.ok((await getRepoChunks(repo.id)).every(text => text.includes("local")));
      return;
    }
    if (scenario === "storage-concurrent-incremental" || scenario === "storage-incremental-cleanup") {
      mock.module("next/server", () => ({ after: () => {}, NextRequest: Request, NextResponse: { json: Response.json } }));
      mock.module("next/cache", () => ({ revalidatePath: () => {} }));
      mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ webhookSecret: "fixture-secret" }) }));
      mock.module("@/lib/webhook-shared", () => ({ startReviewFlow: async () => {} }));
      mock.module("@/lib/repo-sync", () => ({ syncOrgRepos: async () => {}, applyRepositoryEvent: async () => {} }));
      mock.module("@/lib/webhook-tenant", () => ({
        resolveGithubWebhookTenant: async () => ({ status: "resolved", organizationId: repo.organizationId, repositoryId: repo.id }),
        observeGithubWebhookDeliveryBestEffort: async () => {},
      }));
      const { POST } = await import("@/app/api/github/webhook/route");
      const webhook = (number: number) => {
        const body = JSON.stringify({ action: "closed", installation: { id: 1 }, repository: { id: repo.externalId }, pull_request: { number, merged: true } });
        return POST(new Request("https://fixture.invalid/api/github/webhook", { method: "POST", body, headers: {
          "x-github-event": "pull_request", "x-hub-signature-256": "sha256=" + createHmac("sha256", "fixture-secret").update(body).digest("hex"),
        } }) as never);
      };
      content = "incremental";
      delay = "upsert";
      timeoutRequest = scenario === "storage-incremental-cleanup";
      const second = webhook(2);
      await ready.promise;
      await prisma.repository.update({ where: { id: repo.id }, data: { summary: "Edited while indexing", autoReview: false } });
      if (scenario === "storage-concurrent-incremental") {
        assert.equal((await webhook(1)).status, 200);
        assert.ok((await snapshot()).updatedAt > baseline.updatedAt);
      } else {
        assert.ok(requestController);
        transportFailed = true;
        requestController.abort(timeoutError);
        assert.equal((await second).status, 200);
        assert.equal((await snapshot()).indexStatus, "stale", "Metadata changes cannot suppress failure cleanup");
      }
      gate.resolve();
      await applied.promise;
      assert.equal((await second).status, 200);
      if (scenario === "storage-concurrent-incremental") {
        const results = await searchSimilarChunks(repo.id, [1], 200);
        for (const filePath of ["file1.ts", "file2.ts"]) assert.equal(results.filter(point => point.filePath === filePath && point.text.includes("incremental")).length, 1);
        assert.equal((await snapshot()).indexStatus, "indexed");
      }
      assert.equal((await snapshot()).activeIndexGeneration, baselineGeneration);
      assert.deepEqual((await snapshot()).firstIndexedAt, baseline.firstIndexedAt);
      return;
    }
    const local = ["storage-local", "storage-reset", "storage-local-timeout"].includes(scenario);
    const incremental = scenario === "storage-incremental" || scenario === "storage-late-delete";
    const timeout = ["storage-late-upsert", "storage-late-delete", "storage-local-timeout"].includes(scenario);
    const owner = incremental ? { repoId: repo.id, activeIndexGeneration: baselineGeneration } : { repoId: repo.id, indexAttemptId: await claim() };
    let old: Promise<unknown>;
    content = "obsolete";
    delay = scenario === "storage-late-delete" ? "delete" : "upsert";
    timeoutRequest = timeout;
    if (local) {
      await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending", externalId: `cli:github:${repo.fullName}` } });
      const prepared = await prepare();
      assert.ok(prepared.ok);
      old = localBatch(prepared.uploadId);
    } else if (incremental) {
      old = incrementalIndex({ repoId: repo.id, activeIndexGeneration: baselineGeneration }, repo.fullName, "main", 1, files().map(file => ({ filename: file.path, status: "modified" })));
    } else old = full((owner as { indexAttemptId: string }).indexAttemptId);
    const observed = old.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    await ready.promise;
    if (timeout) {
      assert.ok(requestController, "The actual Qdrant HTTP request must be accepted before the client times out");
      transportFailed = true;
      requestController.abort(timeoutError);
      assert.match(String((await observed).error), /timeout|abort/i);
      transportFailed = false;
      if (!incremental) assert.equal((await snapshot()).indexStatus, "failed");
    }
    assert.equal((await snapshot()).activeIndexGeneration, baselineGeneration);
    await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending" } });
    content = "replacement";
    if (local) {
      const prepared = await prepare();
      assert.ok(prepared.ok);
      await localBatch(prepared.uploadId);
      assert.equal((await snapshot()).activeIndexGeneration, prepared.uploadId);
      assert.equal(deleteCalls, 0, "Local resets must not delete active or other upload generations");
    } else await full(await claim());
    const completed = await snapshot();
    gate.resolve();
    await applied.promise;
    const stale = await observed;
    assert.match(String(stale.error), timeout ? /timeout|abort/i : /no longer current|cancelled or replaced/);
    await assert.rejects(() => deleteRepoFileChunks(owner, ["file0.ts"]), /no longer current/);
    const visible = await searchSimilarChunks(repo.id, [1], 200);
    assert.equal(visible.length, 101);
    assert.ok(visible.every(point => point.text.includes("replacement")), "Late remote mutations must not corrupt the active replacement");
    assert.deepEqual(await snapshot(), completed);
    assert.deepEqual(completed.firstIndexedAt, baseline.firstIndexedAt);
    assert.equal(completed.indexStatus, "indexed");
    assert.equal(completed.totalVectors, 101);
  } finally {
    gate.resolve();
    globalThis.fetch = nativeFetch;
    service.stop(true);
  }
}
