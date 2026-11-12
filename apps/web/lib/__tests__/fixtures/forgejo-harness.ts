import { mock, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import * as dns from "node:dns/promises";
import * as https from "node:https";

mock.module("server-only", () => ({}));
const previousRuntimeSelfHosted = process.env.OCTOPUS_SELF_HOSTED;
process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = "false";
process.env.OCTOPUS_SELF_HOSTED = "false";
delete process.env.FORGEJO_ALLOWED_PRIVATE_ORIGINS;
let addresses = [{ address: "8.8.8.8", family: 4 }];
let dnsCalls = 0;
spyOn(dns, "lookup").mockImplementation((async () => { dnsCalls++; return addresses; }) as typeof dns.lookup);

type Reply = { status?: number; headers?: Record<string, string>; body: unknown };
let replies: Reply[] = [];
let failConnection = false;
let lookupAll = true;
const requests: { url: URL; options: RequestOptions; body?: string; pins?: unknown }[] = [];
spyOn(https, "request").mockImplementation(((url: URL, options: RequestOptions, callback: (response: EventEmitter & Record<string, unknown>) => void) => {
  const recorded: typeof requests[number] = { url, options };
  requests.push(recorded);
  const req = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
  let constructing = true;
  options.lookup!(url.hostname, { all: lookupAll }, (_error, pins) => {
    assert.equal(constructing, false, "DNS must complete after Node attaches socket listeners");
    recorded.pins = pins;
    if (failConnection) req.emit("error", Object.assign(new Error("fixture-token unreachable"), { code: "ENETUNREACH" }));
  });
  constructing = false;
  req.end = body => {
    recorded.body = body;
    if (failConnection) return;
    queueMicrotask(() => {
      const reply = replies.shift();
      assert.ok(reply, `Unexpected request ${url.pathname}`);
      let destroyed = false;
      const res = Object.assign(new EventEmitter(), {
        statusCode: reply.status ?? 200, headers: reply.headers ?? {}, destroy: () => { destroyed = true; },
      });
      callback(res);
      if (!destroyed) res.emit("data", Buffer.from(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)));
      if (!destroyed) res.emit("end");
    });
  };
  return req;
}) as unknown as typeof https.request);

const http = await import("../../forgejo-http");
for (const address of ["127.0.0.1", "0.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "198.18.0.1", "192.0.2.1", "224.1.1.1", "240.0.0.1", "::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::", "2001:db8::1", "fe80::1", "fd00::1", "3fff::1"]) {
  assert.equal(http.isPublicForgejoAddress(address), false, address);
}
assert.equal(http.isPublicForgejoAddress("8.8.8.8"), true);
assert.equal(http.isPublicForgejoAddress("2606:4700:4700::1111"), true);
for (const host of ["http://forge.example", "https://user:token@forge.example", "https://forge.example/subpath", "https://forge.example/?token=1", "https://127.1", "https://2130706433", "https://[::ffff:127.0.0.1]"]) {
  assert.throws(() => http.normalizeForgejoHost(host), undefined, host);
}
assert.equal(http.normalizeForgejoHost(" https://FORGE.example:443/ "), "https://forge.example");
addresses = [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }];
await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user"), /public/);
assert.equal(requests.length, 0);
addresses = [{ address: "8.8.8.8", family: 4 }];
replies = [{ body: { login: "bot" } }];
await http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user");
assert.deepEqual(requests.at(-1)!.pins, addresses);
assert.equal(dnsCalls, 2);
assert.equal(requests.at(-1)!.options.agent, false);
assert.equal((requests.at(-1)!.options.headers as Record<string, string>).Authorization, "token fixture-token");
// Immediate IPv4/IPv6 failures reject safely for both Node lookup callback forms.
failConnection = true;
for (const address of [{ address: "8.8.8.8", family: 4 }, { address: "2000::1", family: 6 }]) {
  addresses = [address];
  for (lookupAll of [true, false]) {
    await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user"),
      error => error instanceof Error && error.message === "Forgejo request failed or timed out");
    assert.deepEqual(requests.at(-1)!.pins, lookupAll ? addresses : address.address);
    assert.equal(requests.at(-1)!.options.rejectUnauthorized, true);
  }
}
failConnection = false;
lookupAll = true;
addresses = [{ address: "8.8.8.8", family: 4 }];
const count = requests.length;
replies = [{ status: 302, headers: { location: "https://127.0.0.1/secret" }, body: "fixture-token" }];
await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user"), error => error instanceof http.ForgejoHttpError && !error.message.includes("fixture-token"));
assert.equal(requests.length, count + 1);
replies = [{ body: "12345" }];
await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user", { maxBytes: 4 }), http.ForgejoResponseTooLargeError);
await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "https://other.example/api/v1/user"), /path/);
await assert.rejects(http.forgejoRequest("https://forge.example", "fixture-token", "/api/v1/user", { signal: AbortSignal.abort() }));

process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = "true";
process.env.FORGEJO_ALLOWED_PRIVATE_ORIGINS = "https://forge.internal:444,https://10.1.2.3,https://[fd00::1],https://127.0.0.1";
assert.equal(http.normalizeForgejoHost("https://10.1.2.3"), "https://10.1.2.3");
assert.equal(http.normalizeForgejoHost("https://[fd00::1]"), "https://[fd00::1]");
assert.throws(() => http.normalizeForgejoHost("https://127.0.0.1"), /Loopback/);
assert.throws(() => http.normalizeForgejoHost("https://10.1.2.3:444"), /explicitly allowed/);
assert.throws(() => http.normalizeForgejoHost("https://10.1.2.3/path"), /without credentials/);
addresses = [{ address: "10.1.2.3", family: 4 }];
replies = [{ body: { login: "private-bot" } }];
await http.forgejoRequest("https://forge.internal:444", "fixture-token", "/api/v1/user");
assert.deepEqual(requests.at(-1)!.pins, addresses);
await assert.rejects(http.forgejoRequest("https://forge.internal", "fixture-token", "/api/v1/user"), /explicitly allowed/);
await assert.rejects(http.forgejoRequest("https://other.internal:444", "fixture-token", "/api/v1/user"), /explicitly allowed/);
for (const address of ["127.0.0.1", "169.254.169.254", "100.100.100.200", "fd00:ec2::254", "192.0.2.1", "2001:db8::1", "64:ff9b::a9fe:a9fe", "fe80::1", "224.0.0.1"]) {
  addresses = [{ address, family: address.includes(":") ? 6 : 4 }];
  await assert.rejects(http.forgejoRequest("https://forge.internal:444", "fixture-token", "/api/v1/user"), /Loopback/);
}
addresses = [{ address: "10.1.2.3", family: 4 }];
process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = "false";
assert.throws(() => http.normalizeForgejoHost("https://10.1.2.3"), /explicitly allowed/);
await assert.rejects(http.forgejoRequest("https://forge.internal:444", "fixture-token", "/api/v1/user"), /explicitly allowed/);
process.env.OCTOPUS_SELF_HOSTED = "true";
assert.equal(http.normalizeForgejoHost("https://10.1.2.3"), "https://10.1.2.3");
replies = [{ body: { login: "runtime-private-bot" } }];
await http.forgejoRequest("https://forge.internal:444", "fixture-token", "/api/v1/user");
assert.deepEqual(requests.at(-1)!.pins, addresses);
delete process.env.FORGEJO_ALLOWED_PRIVATE_ORIGINS;
assert.throws(() => http.normalizeForgejoHost("https://10.1.2.3"), /explicitly allowed/);
await assert.rejects(http.forgejoRequest("https://forge.internal:444", "fixture-token", "/api/v1/user"), /explicitly allowed/);
process.env.OCTOPUS_SELF_HOSTED = "false";
addresses = [{ address: "8.8.8.8", family: 4 }];

process.env.OCTOPUS_DATA_KEY = "1".repeat(64);
const { encryptString } = await import("../../crypto");
const standing = { bannedAt: null as Date | null, deletedAt: null as Date | null };
const row = { id: "integration-fixture", username: "bot", forgejoHost: "https://forge.example", accessTokenEnc: encryptString("fixture-token"), organization: standing };
const repo = { provider: "forgejo", organizationId: "org-fixture", isActive: true, dismissedAt: null,
  externalId: "https://forge.example:42", organization: Object.assign(standing, { forgejoIntegration: row }) };
mock.module("@octopus/db", () => ({ prisma: { forgejoIntegration: { findUnique: async ({ where }: { where: { organizationId: string } }) => {
  assert.equal(where.organizationId, "org-fixture"); return row;
} }, repository: { findUnique: async () => repo } } }));
const api = await import("../../forgejo");
await api.runWithForgejoRepository("repo-fixture", async () => {
  row.id = "replacement-integration";
  await assert.rejects(api.getBranchHead("org-fixture", "team/repo", "main"), /integration changed/);
  await assert.rejects(api.runWithForgejoRepository("repo-fixture", async () => assert.fail("Nested context must not adopt the replacement integration")), /integration changed/);
});
row.id = "integration-fixture";
standing.bannedAt = new Date();
await assert.rejects(api.runWithForgejoRepository("repo-fixture", async () => assert.fail("Banned org must not enter")), /no longer connected/);
standing.bannedAt = null;
await api.runWithForgejoRepository("repo-fixture", async () => {
  standing.deletedAt = new Date();
  await assert.rejects(api.getBranchHead("org-fixture", "team/repo", "main"), /no longer active/);
});
standing.deletedAt = null;
row.forgejoHost = "https://other.example";
await assert.rejects(api.runWithForgejoRepository("repo-fixture", async () => {}), /no longer connected/);
row.forgejoHost = "https://forge.example";
const head = "1".repeat(40), base = "2".repeat(40), target = "3".repeat(40);
const pr = { number: 7, title: "Fixture PR", user: { login: "alice" }, head: { sha: head }, base: { sha: target }, merge_base: base, changed_files: 2, state: "open" };
const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-before\n+after\n";
const page = (filename: string, more: boolean): Reply => ({ body: [{ filename, status: "changed", additions: 1, deletions: 1 }], headers: { "x-hasmore": String(more) } });
replies = [{ body: pr }, page("a.ts", true), page("b.ts", false), { body: diff }, { body: pr }];
const result = await api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head);
assert.equal(result.input.inventoryComplete, true);
assert.equal(result.input.baseSha, base);
assert.equal(result.input.files.length, 2);
assert.equal(result.input.files[0].change, "modified");
assert.match(result.input.files[1].patch!, /\+after/);
assert.ok(requests.some(request => request.url.search === "?limit=50&page=2"));

const emptyPr = { ...pr, changed_files: 0 };
replies = [{ body: emptyPr }, { body: null }, { body: "" }, { body: emptyPr }];
const empty = await api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head);
assert.equal(empty.input.inventoryComplete, true);
assert.deepEqual(empty.input.files, []);
assert.equal(empty.rawDiff, "");
replies = [{ body: pr }, { body: null }];
await assert.rejects(api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head), /Invalid Forgejo changed-file response/);
replies = [{ body: emptyPr }, { body: null }, { body: "" }, { body: { ...emptyPr, head: { sha: target } } }];
await assert.rejects(api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head), /revision changed/);

replies = [{ body: pr }, page("a.ts", false), { body: diff }, { body: pr }];
assert.equal((await api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head)).input.inventoryComplete, false);
replies = [{ body: pr }, page("a.ts", true), page("a.ts", false)];
await assert.rejects(api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head), /repeated/);
replies = [{ body: pr }, page("a.ts", false), { body: diff }, { body: { ...pr, head: { sha: target } } }];
await assert.rejects(api.getPullRequestReviewInput("org-fixture", "team/repo", 7, head), /revision changed/);
replies = [{ body: pr }];
await assert.rejects(api.getPullRequestReviewInput("org-fixture", "team/repo", 7, target), /revision changed/);

replies = [{ body: { ...pr, html_url: "https://attacker.example", draft: true } }];
const details = await api.getPullRequestDetails("org-fixture", "team/repo", 7);
assert.equal(details.url, "https://forge.example/team/repo/pulls/7");
assert.equal(details.state, "open");
assert.equal(details.draft, true);
replies = [{ body: { ...pr, number: 8 } }];
await assert.rejects(api.getPullRequestDetails("org-fixture", "team/repo", 7), /Invalid/);

replies = [{ body: { id: 12 } }];
assert.equal(await api.createPullRequestComment("org-fixture", "team/repo", 7, "review"), 12);
assert.equal(requests.at(-1)!.url.pathname, "/api/v1/repos/team/repo/issues/7/comments");
assert.deepEqual(JSON.parse(requests.at(-1)!.body!), { body: "review" });
replies = [{ status: 204, body: "" }];
await api.updatePullRequestComment("org-fixture", "team/repo", 7, 12, "updated");
assert.equal(requests.at(-1)!.options.method, "PATCH");
assert.equal(requests.at(-1)!.url.pathname, "/api/v1/repos/team/repo/issues/comments/12");
replies = [{ body: pr }, { body: { id: 33 } }];
await api.createPullRequestReview("org-fixture", "team/repo", 7, "review", [{ path: "a.ts", line: 3, side: "RIGHT", body: "finding" }]);
assert.deepEqual(JSON.parse(requests.at(-1)!.body!), { body: "review", event: "COMMENT", commit_id: head, comments: [{ path: "a.ts", body: "finding", new_position: 3, old_position: 0 }] });
replies = [{ body: { ...pr, head: { sha: target } } }];
const beforeStalePublication = requests.length;
await api.runWithForgejoRepository("repo-fixture", async () => {
  await api.runWithForgejoRepository("repo-fixture", async () => {
    await assert.rejects(api.createInlineComment("org-fixture", "team/repo", 7, "a.ts", 3, "stale finding"), /revision changed before review publication/);
  }); // A nested operation without expectedHead keeps the parent's reviewed SHA.
}, head);
assert.equal(requests.length, beforeStalePublication + 1); // Metadata only; no POST on the new revision.
replies = [{ body: { id: 1 } }];
await api.setCommitStatus("org-fixture", "team/repo", head, "failed", "octopus", "review failed");
assert.equal(JSON.parse(requests.at(-1)!.body!).state, "failure");

replies = [{ body: { tree: [{ path: "a.ts", type: "blob" }], total_count: 2, truncated: true } }, { body: { tree: [{ path: "b.ts", type: "blob" }], total_count: 2, truncated: true } }];
assert.deepEqual(await api.getRepositoryTree("org-fixture", "team/repo", head), ["a.ts", "b.ts"]);
replies = [{ body: { tree: null, total_count: 0, truncated: false } }];
assert.deepEqual(await api.getRepositoryTree("org-fixture", "team/repo", head), []);
replies = [{ body: { type: "file", encoding: "base64", content: Buffer.from("source").toString("base64") } }];
assert.equal(await api.getFileContent("org-fixture", "team/repo", head, "src/a.ts"), "source");
await assert.rejects(api.getFileContent("org-fixture", "team/repo", head, "../outside"), /Invalid/);
replies = [{ body: [{ id: 1, name: "repo", full_name: "team/repo" }] }, { body: [] }];
assert.equal((await api.listUserRepos("org-fixture")).length, 1);
assert.equal(replies.length, 0);
for (const strict of [false, true]) {
  replies = [{ body: { type: "file", encoding: "base64", content: "" } }];
  assert.equal(await api.getFileContent("org-fixture", "team/repo", head, "empty.ts", { strict }), "");
  replies = [{ status: 404, body: { message: "Not Found" } }];
  const missing = api.getFileContent("org-fixture", "team/repo", head, "missing.ts", { strict });
  if (strict) await assert.rejects(missing, error => error instanceof http.ForgejoHttpError && error.status === 404);
  else assert.equal(await missing, "");
}
let vectorWrites = 0;
mock.module("@/lib/qdrant", () => ({
  ensureCollection: async () => {},
  upsertChunks: async () => { vectorWrites++; }, deleteRepoFileChunks: async () => {},
}));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
const { indexRepository } = await import("@/lib/indexer");
for (const missingPath of ["missing.ts", ".octopusignore"]) {
  const paths = missingPath === ".octopusignore" ? [".octopusignore", "good.ts"] : ["good.ts", "missing.ts"];
  replies = [
    { body: { commit: { id: head } } },
    { body: { tree: paths.map(path => ({ path, type: "blob" })), total_count: paths.length, truncated: false } },
    ...(missingPath === "missing.ts" ? [{ body: { type: "file", encoding: "base64", content: Buffer.from("export const good = 1;").toString("base64") } }] : []),
    { status: 404, body: { message: "Not Found" } },
  ];
  await assert.rejects(() => indexRepository({ repoId: "repo-fixture", indexAttemptId: "attempt-fixture" }, "team/repo", "main", 0, undefined, undefined, "forgejo", "org-fixture"), http.ForgejoHttpError);
  assert.equal(replies.length, 0);
  assert.equal(vectorWrites, 0);
}
if (previousRuntimeSelfHosted === undefined) delete process.env.OCTOPUS_SELF_HOSTED;
else process.env.OCTOPUS_SELF_HOSTED = previousRuntimeSelfHosted;
console.log("Forgejo transport and adapter checks passed");
