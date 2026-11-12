import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => null }));
const { getRepositoryDetails, getFileContent } = await import("../../github");
const controller = new AbortController();
let count = 0;
const request = async (url: string, init?: RequestInit): Promise<Response> => {
  count++;
  assert.ok(url.startsWith("https://api.github.com/repos/synthetic/repo"));
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-token");
  assert.equal(init?.signal, controller.signal);
  if (count === 1) return new Response(null, { status: 503 });
  return count === 2 ? Response.json({ default_branch: "main" }) : new Response("synthetic ignore");
};
const repo = await getRepositoryDetails(1, "synthetic", "repo", "synthetic-token", controller.signal, request);
assert.equal(repo?.default_branch, "main");
assert.equal(await getFileContent(1, "synthetic", "repo", "main", ".octopusignore", "synthetic-token", controller.signal, request), "synthetic ignore");
assert.equal(count, 3);
