
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
mock.module("server-only", () => ({}));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ appId: "123", privateKey }) }));
const { createCheckRun, updateCheckRun } = await import("../../github");
const checkRuns: { id: number; status: string; external_id?: string; app?: { id: number } }[] = [];
let lookupBroken = false;
const checkCalls: string[] = [];
let controller = new AbortController();
let remaining = 10000;
let mode = "cancel-auth";
let sends = 0;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).endsWith("/access_tokens")) {
    await Promise.resolve();
    if (mode === "cancel-auth") controller.abort();
    if (mode === "expire-auth") remaining = 0;
    return Response.json({ token: "synthetic" });
  }
  if (String(url).includes("/commits/")) {
    checkCalls.push("GET");
    if (lookupBroken) return new Response("not json", { status: 200 });
    assert.ok(String(url).includes(`/commits/${"a".repeat(40)}/check-runs?check_name=Octopus%20Review`));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return Response.json({ check_runs: checkRuns.slice((page - 1) * 100, page * 100) });
  }
  if (String(url).endsWith("/check-runs")) {
    const run = { id: 50 + checkRuns.length, status: "in_progress", external_id: JSON.parse(String(init?.body)).external_id, app: { id: 123 } };
    checkRuns.push(run);
    checkCalls.push(`POST ${run.id}`);
    return Response.json(run);
  }
  if (mode === "reuse") {
    const run = checkRuns.find(run => String(url).endsWith(`/check-runs/${run.id}`));
    assert.ok(run);
    run.status = JSON.parse(String(init?.body)).status;
    checkCalls.push(`PATCH ${run.id}`);
    return Response.json({});
  }
  assert.ok(String(url).includes("/check-runs/"));
  sends++;
  if (mode === "cancel-send") {
    assert.ok(init?.signal);
    controller.abort();
    assert.equal(init.signal.aborted, true);
    init.signal.throwIfAborted();
  }
  return Response.json({});
}) as typeof fetch;
for (mode of ["cancel-auth", "expire-auth", "cancel-send"]) {
  controller = new AbortController(); remaining = 10000; sends = 0;
  await assert.rejects(updateCheckRun(1, "owner", "repo", 1, "success", { title: "Passed", summary: "5/5" },
    { jobId: "job", signal: controller.signal, deadlineEpochMs: Date.now() + 10000, remainingMs: () => remaining }));
  assert.equal(sends, mode === "cancel-send" ? 1 : 0);
}
mode = "cancel-auth"; sends = 0;
await updateCheckRun(1, "owner", "repo", 1, "failure", { title: "Failed", summary: "Unscored" });
assert.equal(sends, 1);

// A redelivered review continues the unfinished check run of its own request instead of adding a second one.
mode = "reuse";
const head = "a".repeat(40);
const firstRun = await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:1");
assert.equal(await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:1"), firstRun);
await updateCheckRun(1, "owner", "repo", firstRun, "success", { title: "Passed", summary: "5/5" });
assert.deepEqual(checkCalls, ["GET", `POST ${firstRun}`, "GET", `PATCH ${firstRun}`]);
// A completed check run is left alone, and another request never takes over this one's.
const afterCompletion = await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:1");
assert.notEqual(afterCompletion, firstRun);
assert.notEqual(await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:2"), afterCompletion);
assert.equal(checkRuns.find(run => run.id === firstRun)?.status, "completed");
// Callers that pass no request identity create a check run without a lookup, as before.
checkCalls.length = 0;
await createCheckRun(1, "owner", "repo", head, "Octopus Review");
assert.equal(checkCalls.length, 1);
assert.ok(checkCalls[0].startsWith("POST"));
checkRuns.length = 0;
checkRuns.push(...Array.from({ length: 100 }, (_, id) => ({ id, status: "completed" })));
checkRuns.push({ id: 100, status: "in_progress", external_id: "pr:later", app: { id: 123 } });
assert.equal(await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:later"), 100);
checkRuns.length = 0;
checkRuns.push({ id: 1, status: "in_progress", external_id: "pr:foreign", app: { id: 456 } });
checkRuns.push({ id: 2, status: "in_progress", external_id: "pr:foreign" });
const ownedRun = await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:foreign");
assert.notEqual(ownedRun, 1);
assert.notEqual(ownedRun, 2);
assert.equal(await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:foreign"), ownedRun);
// A lookup that cannot be read still creates the check run.
lookupBroken = true; checkCalls.length = 0;
await createCheckRun(1, "owner", "repo", head, "Octopus Review", undefined, "pr:unreadable");
assert.ok(checkCalls.some(call => call.startsWith("POST")));
lookupBroken = false;
