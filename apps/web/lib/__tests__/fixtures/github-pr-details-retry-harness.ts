import { mock } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

mock.module("server-only", () => ({}));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ appId: "123", privateKey }) }));
mock.module("@octopus/db", () => ({ prisma: {} }));
const { getPullRequestDetails, updatePullRequestComment } = await import("../../github");
let abortDuringDelay: AbortController | undefined;
let statuses: number[] = [];
let calls: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/access_tokens")) return Response.json({ token: "synthetic-token" });
  calls.push(`${init?.method ?? "GET"} ${url}`);
  const status = statuses.shift() ?? 500;
  if (status === 500 && abortDuringDelay) setTimeout(() => abortDuringDelay?.abort(), 50);
  return Response.json(status === 200 ? { number: 1, title: "title", html_url: "https://example.test", user: { login: "user" }, head: { sha: "head" }, base: { sha: "base" } } : {}, { status });
}) as typeof fetch;
try {
  statuses = [500, 200];
  assert.equal((await getPullRequestDetails(1, "owner", "repo", 1)).headSha, "head");
  assert.equal(calls.length, 2);
  calls = []; statuses = [500, 500];
  await assert.rejects(() => getPullRequestDetails(1, "owner", "repo", 1), /Failed to get PR details: 500/);
  assert.equal(calls.length, 2, "500 retries must be bounded");
  calls = []; statuses = [403];
  await assert.rejects(() => getPullRequestDetails(1, "owner", "repo", 1), /403/);
  assert.equal(calls.length, 1, "permission failures must not retry");
  calls = []; statuses = [500, 200];
  const controller = new AbortController();
  abortDuringDelay = controller;
  await assert.rejects(() => getPullRequestDetails(1, "owner", "repo", 1, controller.signal), { name: "AbortError" });
  assert.equal(calls.length, 1, "cancellation must prevent redispatch");
  abortDuringDelay = undefined;
  calls = []; statuses = [500];
  await assert.rejects(() => updatePullRequestComment(1, "owner", "repo", 1, "text", "synthetic-token"), /500/);
  assert.equal(calls.length, 1, "a write must not gain 500 retries");
} finally { abortDuringDelay = undefined; }
