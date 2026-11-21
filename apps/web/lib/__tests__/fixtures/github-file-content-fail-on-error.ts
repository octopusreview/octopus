import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => null }));
const { getFileContent } = await import("../../github");

const file = [1, "synthetic", "repo", "main", ".octopusignore", "synthetic-token", undefined] as const;
const respond = (status: number, body?: string) => async () => new Response(body, { status });
const readStrict = (status: number, body?: string) =>
  getFileContent(...file, respond(status, body), { failOnError: true });

// Present: the content comes back as is.
assert.equal(await readStrict(200, "secret/\n"), "secret/\n");
// GitHub says the file does not exist: that, and only that, is "absent".
assert.equal(await readStrict(404), null);
// Any other answer is a failed read, never an absent file.
await assert.rejects(() => readStrict(500), /500/);
await assert.rejects(() => readStrict(403), /403/);
// Without the option, callers keep the old contract: any failed read is null.
assert.equal(await getFileContent(...file, respond(500)), null);
