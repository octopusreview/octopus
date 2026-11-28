import { mock } from "bun:test";
import { SQL } from "bun";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

mock.module("server-only", () => ({}));
const secret = "fixture-secret";
const integration = { connectorTokenHash: null as string | null, organizationId: "org-a", forgejoHost: "https://forge.example", username: "review-bot", webhookSecret: secret };
let active = true, dismissed = false, draft = false, state = "open", merged = false;
let deliveries = new Set<string>();
let reviews: Record<string, unknown>[] = [];
let reads = 0, mergedWrites = 0;
let admissionPending = false;
let reviewedHead: string | null = null;
let metadataDelay: (() => Promise<void>) | undefined;
let admissionDelay: (() => Promise<void>) | undefined;
let admissionFailure = false;
const locks = new Set<string>();
const databaseUrl = process.env.FORGEJO_EMAIL_TEST_DATABASE_URL;
if (databaseUrl) assert.match(new URL(databaseUrl).pathname, /test/i);
const sql = databaseUrl ? new SQL(databaseUrl) : null;
const sha = "a".repeat(40);
const db = {
  forgejoIntegration: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "integration-a" ? integration : null },
  repository: {
    findUnique: async ({ where }: { where: { provider_externalId_organizationId: { provider: string; externalId: string; organizationId: string } } }) => {
      const key = where.provider_externalId_organizationId;
      assert.equal(key.provider, "forgejo");
      assert.equal(key.organizationId, "org-a");
      if (key.externalId !== "https://forge.example:42") return null;
      return { id: "repo-a", fullName: "team/repo", isActive: active, autoReview: true, dismissedAt: dismissed ? new Date() : null };
    },
    updateMany: async () => ({ count: 1 }),
  },
  pullRequest: { updateMany: async () => { mergedWrites++; return { count: 1 }; } },
  webhookDelivery: {
    findUnique: async ({ where }: { where: { provider_deliveryId: { deliveryId: string } } }) => deliveries.has(where.provider_deliveryId.deliveryId) ? { id: "seen" } : null,
    upsert: async ({ create }: { create: { deliveryId: string; resolvedOrganizationId: string } }) => { assert.equal(create.resolvedOrganizationId, "org-a"); deliveries.add(create.deliveryId); },
  },
  reviewAttempt: { findFirst: async ({ where }: { where: { headSha: string; pullRequest: { repositoryId: string; number: number } } }) => {
    assert.equal(where.pullRequest.repositoryId, "repo-a");
    assert.equal(where.pullRequest.number, 7);
    return where.headSha === reviewedHead ? { id: "attempt" } : null;
  } },
  $transaction: async (work: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> => {
    if (Array.isArray(work)) return Promise.all(work);
    if (sql) return sql.begin(tx => work({ ...db, $queryRaw: (strings: TemplateStringsArray, key: string) => tx(strings, key) }));
    let owned: string | undefined;
    try {
      return await work({ ...db, $queryRaw: async (_sql: TemplateStringsArray, key: string) => {
        if (locks.has(key)) return [{ acquired: false }];
        locks.add(key); owned = key; return [{ acquired: true }];
      } });
    } finally { if (owned) locks.delete(owned); }
  },
};
mock.module("@octopus/db", () => ({ prisma: db }));
mock.module("@/lib/forgejo", () => ({ runWithForgejoRepository: async (_id: string, callback: () => Promise<unknown>) => callback(), getPullRequestDetails: async (org: string, name: string, number: number) => {
  assert.equal(org, "org-a"); assert.equal(name, "team/repo"); assert.equal(number, 7); reads++;
  await metadataDelay?.();
  return { number, title: "Authoritative title", author: "author", url: "https://forge.example/team/repo/pulls/7", headSha: sha, baseSha: "b".repeat(40), state, draft, merged };
} }));
mock.module("@/lib/webhook-shared", () => ({ startReviewFlow: async (params: Record<string, unknown>) => {
  if (params.automatic && reviewedHead === params.headSha) return { started: false, reason: "already_reviewed" };
  if (admissionPending) return { started: false, reason: "already_in_progress", message: "Admission pending" };
  await admissionDelay?.();
  if (admissionFailure) throw new Error("enqueue failed");
  reviews.push(params); return { started: true, pullRequestId: "pr-a" };
} }));
mock.module("@/lib/review-attempt-outcome", () => ({ recordReviewAdmissionAfterCommit: () => {} }));
const { POST } = await import("../../../app/api/forgejo/webhook/[integrationId]/route");
const payload = { action: "opened", repository: { id: 42, full_name: "team/repo" }, pull_request: { number: 7, head: { sha } } };
async function deliver(body: unknown = payload, options: { event?: string; signature?: string; integrationId?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const signature = options.signature ?? createHmac("sha256", secret).update(raw).digest("hex");
  return POST(new Request("https://octopus.example/api/forgejo/webhook/integration-a", {
    method: "POST", body: raw, headers: { "x-forgejo-signature": signature, "x-forgejo-event": options.event ?? "pull_request" },
  }), { params: Promise.resolve({ integrationId: options.integrationId ?? "integration-a" }) });
}
assert.equal((await deliver(payload, { signature: "bad" })).status, 401);
assert.equal((await deliver(payload, { signature: "0".repeat(64) })).status, 401);
assert.equal((await deliver(payload, { integrationId: "other-org" })).status, 401);
assert.equal((await deliver("{" )).status, 400);
assert.equal((await deliver("x".repeat(1024 * 1024 + 1))).status, 413);
assert.equal(reviews.length + reads, 0);
await deliver({ ...payload, repository: { id: 43, full_name: "team/repo" } });
await deliver({ ...payload, repository: { id: 42, full_name: "other/repo" } });
active = false; await deliver(); active = true;
dismissed = true; await deliver(); dismissed = false;
assert.equal(reviews.length + reads, 0);
assert.equal((await deliver()).status, 200);
assert.equal(reviews.length, 1);
assert.equal(reviews[0].provider, "forgejo");
assert.equal(reviews[0].orgId, "org-a");
assert.equal(reviews[0].prTitle, "Authoritative title");
await deliver();
assert.equal(reviews.length, 1);
assert.equal(reads, 1);
deliveries = new Set(); reviews = []; draft = true;
await deliver(); assert.equal(reviews.length, 0);
draft = false; deliveries.clear(); state = "closed";
await deliver(); assert.equal(reviews.length, 0);
merged = true;
await deliver({ ...payload, action: "closed" });
assert.equal(mergedWrites, 1);
state = "open"; merged = false;
const comment = { action: "created", repository: payload.repository, issue: { number: 7, pull_request: {} }, comment: { id: 3, body: "/octopus review", user: { login: "review-bot" } } };
await deliver(comment, { event: "issue_comment" }); assert.equal(reviews.length, 0);
comment.comment.user.login = "member";
await deliver(comment, { event: "issue_comment" }); assert.equal(reviews.length, 1);
assert.equal(reviews[0].triggerCommentId, 3);
assert.equal(reviews[0].prAuthor, "author");
console.log("Forgejo webhook checks passed");

deliveries.clear(); reviews = []; admissionPending = true;
assert.equal((await deliver()).status, 503);
assert.equal(deliveries.size, 0, "a pending admission without durable enqueue evidence must stay retryable");
admissionPending = false;
assert.equal((await deliver()).status, 200);
assert.equal(reviews.length, 1);


deliveries.clear(); reviews = [];
let releaseFirst!: () => void;
let firstAdmitted!: () => void;
const entered = new Promise<void>(resolve => { firstAdmitted = resolve; });
admissionDelay = async () => { firstAdmitted(); await new Promise<void>(resolve => { releaseFirst = resolve; }); };
const first = deliver(comment, { event: "issue_comment" });
await entered;
assert.equal((await deliver(comment, { event: "issue_comment" })).status, 503);
let releaseMetadata!: () => void;
let metadataEntered!: () => void;
const delayed = new Promise<void>(resolve => { metadataEntered = resolve; });
metadataDelay = async () => { metadataEntered(); await new Promise<void>(resolve => { releaseMetadata = resolve; }); };
const duplicate = deliver(comment, { event: "issue_comment" });
await delayed;
releaseFirst();
assert.equal((await first).status, 200);
assert.equal(reviews.length, 1);
reviewedHead = sha;
releaseMetadata();
assert.equal((await duplicate).status, 200);
assert.equal(reviews.length, 1, "a duplicate delayed until review completion cannot readmit");
metadataDelay = undefined; admissionDelay = undefined; reviewedHead = null;

deliveries.clear(); reviews = []; admissionFailure = true;
await assert.rejects(deliver(), /enqueue failed/);
assert.equal(deliveries.size, 0);
assert.equal(locks.size, 0);
admissionFailure = false;
await deliver();
assert.equal(reviews.length, 1, "failed deliveries can retry after lock release");

const ready = { ...payload, action: "edited", changes: { title: { from: "WIP: work" } } };
for (const body of [{ ...payload, action: "edited" }, { ...payload, action: "edited", changes: { body: { from: "old body" } } }]) {
  deliveries.clear(); reviews = []; const before = reads;
  await deliver(body); assert.equal(reviews.length, 0); assert.equal(reads, before);
}
deliveries.clear(); reviews = []; draft = true;
await deliver(ready); assert.equal(reviews.length, 0);
deliveries.clear(); draft = false; state = "closed";
await deliver(ready); assert.equal(reviews.length, 0);
deliveries.clear(); state = "open";
await deliver(ready); assert.equal(reviews.length, 1);
deliveries.clear(); reviewedHead = sha;
await deliver({ ...ready, changes: { title: { from: "ordinary title" } } });
assert.equal(reviews.length, 1, "title edits must not repeat a reviewed head");
reviewedHead = null;
for (const body of ["@octopusreview", "@octopus-review", "email@octopus", "@octopus-other", "/octopus-other", "/octopus_extra", "/octopus/path", "@octopus.example"]) {
  deliveries.clear(); reviews = []; comment.comment.body = body;
  await deliver(comment, { event: "issue_comment" }); assert.equal(reviews.length, 0, body);
}
for (const body of ["@octopus", "please @octopus review", "/octopus review", "@octopus, please review"]) {
  deliveries.clear(); reviews = []; comment.comment.body = body;
  await deliver(comment, { event: "issue_comment" }); assert.equal(reviews.length, 1, body);
}

const previousHosted = process.env.OCTOPUS_SELF_HOSTED;
const previousBuildHosted = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED;
const previousOrigins = process.env.GITEA_COMPATIBLE_ORIGINS;
delete process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED;
async function giteaDelivery(body: unknown = payload, options: { event?: string; signature?: string; mixed?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const valid = createHmac("sha256", secret).update(raw).digest("hex");
  return POST(new Request("https://octopus.example/api/forgejo/webhook/integration-a", {
    method: "POST", body: raw, headers: {
      "x-gitea-signature": options.signature ?? valid,
      "x-gitea-event": options.event ?? "pull_request",
      ...(options.mixed ? { "x-forgejo-signature": valid } : {}),
    },
  }), { params: Promise.resolve({ integrationId: "integration-a" }) });
}
try {
  deliveries.clear(); reviews = [];
  const baselineReads = reads;
  const success = async (response: Response) => {
    assert.equal(response.status, 200);
    return await response.json();
  };
  process.env.GITEA_COMPATIBLE_ORIGINS = "https://forge.example";
  delete process.env.OCTOPUS_SELF_HOSTED;
  assert.equal((await giteaDelivery()).status, 401, "Gitea is self-hosted only");
  process.env.OCTOPUS_SELF_HOSTED = "true";
  process.env.GITEA_COMPATIBLE_ORIGINS = "https://forge.example.evil.example";
  assert.equal((await giteaDelivery()).status, 401, "origin matching is exact");
  assert.equal((await deliver(payload, { signature: "bad" })).status, 401);
  process.env.GITEA_COMPATIBLE_ORIGINS = "https://other.example, https://forge.example ";
  integration.connectorTokenHash = "fixture-connector";
  assert.equal((await giteaDelivery()).status, 401, "direct Gitea mode cannot claim a connector integration");
  integration.connectorTokenHash = null;
  assert.equal((await deliver()).status, 401, "Gitea mode does not accept Forgejo signatures");
  assert.equal((await giteaDelivery(payload, { mixed: true })).status, 401);
  assert.equal((await giteaDelivery(payload, { signature: "0".repeat(64) })).status, 401);
  assert.equal(reads, baselineReads, "rejected hooks never fetch PR metadata");
  assert.equal((await success(await giteaDelivery({ ...payload, repository: { id: 43, full_name: "team/repo" } }))).ignored, true);
  assert.equal((await success(await giteaDelivery(payload, { event: "push" }))).ignored, true);
  assert.equal(reviews.length, 0);
  assert.deepEqual(await success(await giteaDelivery()), { ok: true });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].headSha, sha);
  assert.equal((await success(await giteaDelivery())).duplicate, true);
  assert.equal(reviews.length, 1);
  assert.equal((await success(await giteaDelivery({ ...payload, action: "synchronized" }))).ok, true);
  assert.equal(reviews.length, 2);
  comment.comment.body = "/octopus review";
  assert.equal((await success(await giteaDelivery(comment, { event: "issue_comment" }))).ok, true);
  assert.equal(reviews.length, 3);
  assert.equal(reviews[2].triggerCommentId, 3);
  console.log("Gitea opt-in, authentication, sync, comments and replay checks passed");
} finally {
  for (const [key, value] of [
    ["OCTOPUS_SELF_HOSTED", previousHosted],
    ["NEXT_PUBLIC_OCTOPUS_SELF_HOSTED", previousBuildHosted],
    ["GITEA_COMPATIBLE_ORIGINS", previousOrigins],
  ]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  await sql?.close();
}
