import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
mock.module("server-only", () => ({}));
const { githubIndexRateScopes } = await import("../../github-index-rate-scope");

const token = "synthetic-token-private";
const input = { installationId: 0, providedToken: token };
const current = githubIndexRateScopes(input);
assert.equal(current.length, 2, "primary and legacy keys each supply a token scope");
assert.equal(new Set(current).size, current.length);
assert.ok(current.every(scope => !scope.includes(token) && !scope.includes("org-a") && !scope.includes("repo-a")));
assert.deepEqual(githubIndexRateScopes(input), current);

const otherInstallationContext = githubIndexRateScopes({ ...input, installationId: 99 });
assert.deepEqual(otherInstallationContext, current, "the provided token's quota is independent of an unrelated installation argument");
const otherToken = githubIndexRateScopes({ ...input, providedToken: "synthetic-other-token" });
assert.equal(current.some(scope => otherToken.includes(scope)), false, "different opaque tokens are not assumed to share quota");
const installation = githubIndexRateScopes({ installationId: 42 });
assert.deepEqual(installation, githubIndexRateScopes({ installationId: 42 }));
assert.notDeepEqual(installation, githubIndexRateScopes({ installationId: 43 }));
assert.equal(installation.some(scope => current.includes(scope)), false, "provided tokens are not assumed to share an app installation's quota");

const primary = process.env.OCTOPUS_DATA_KEY;
process.env.OCTOPUS_DATA_KEY = createHash("sha256").update("synthetic-legacy-key").digest("hex");
const legacyOnly = githubIndexRateScopes(input);
assert.equal(legacyOnly.length, 1, "equivalent transition keys are deduplicated");
assert.ok(current.includes(legacyOnly[0]), "old and transitioning workers share the legacy scope");
process.env.OCTOPUS_DATA_KEY = primary;
assert.throws(() => githubIndexRateScopes({ ...input, providedToken: "" }), /scope/i);
assert.throws(() => githubIndexRateScopes({ installationId: 0 }), /scope/i);
