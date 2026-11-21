import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => null }));
const { getFileContent } = await import("../../github");

const read = (status: number, body: string | null = null, failOnError = true) =>
  getFileContent(1, "synthetic", "repo", "main", ".octopusignore", "synthetic-token", undefined, async () => new Response(body, { status }), { failOnError });

// Present: the content comes back as is.
assert.equal(await read(200, "secret/\n"), "secret/\n");
// GitHub says the file does not exist: that, and only that, is "absent".
assert.equal(await read(404), null);
// Any other answer is a failed read, never an absent file.
await assert.rejects(() => read(500), /500/);
await assert.rejects(() => read(403), /403/);
// Without the option, callers keep the old contract: any failed read is null.
assert.equal(await read(500, null, false), null);
