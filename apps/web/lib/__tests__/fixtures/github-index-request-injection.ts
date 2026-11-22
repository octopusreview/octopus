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
  if (count === 2) return Response.json({ default_branch: "main" });
  const fileUrl = new URL(url);
  assert.equal(fileUrl.pathname, "/repos/synthetic/repo/contents/docs/%2342%3F%2520.md");
  assert.deepEqual([...fileUrl.searchParams], [["ref", "release/v1&v2"]]);
  assert.equal(fileUrl.hash, "");
  return new Response("file contents");
};
const repo = await getRepositoryDetails(1, "synthetic", "repo", "synthetic-token", controller.signal, request);
assert.equal(repo?.default_branch, "main");
assert.equal(await getFileContent(1, "synthetic", "repo", "release/v1&v2", "docs/#42?%20.md", "synthetic-token", controller.signal, request), "file contents");
assert.equal(count, 3);
