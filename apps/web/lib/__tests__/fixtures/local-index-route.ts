import { mock } from "bun:test";
import assert from "node:assert/strict";

let reason: "repository-changed" | "managed-by-platform" = "repository-changed";
mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ NextResponse: { json: Response.json } }));
mock.module("@octopus/db", () => ({ prisma: {} }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org: { id: "synthetic-org" } }) }));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/app/api/cli/repos/by-remote/route", () => ({ normaliseRemoteUrl: () => ({ provider: "github", fullName: "synthetic/repo" }) }));
mock.module("@/lib/index-local", () => ({
  IN_FLIGHT_WINDOW_MS: 300_000,
  LocalIndexConflict: class extends Error {},
  prepareRepoForLocalIndex: async () => reason === "repository-changed" ? { ok: false, reason } : { ok: false, reason, repoId: "synthetic-repo" },
  claimLocalIndexBatch: () => { throw new Error("unexpected batch"); },
  indexLocalBatch: () => { throw new Error("unexpected batch"); },
  markLocalIndexFailed: () => { throw new Error("unexpected batch"); },
  recordLocalIndexProgress: () => { throw new Error("unexpected batch"); },
}));
const { POST } = await import("@/app/api/cli/repos/index-local/route");
const request = () => new Request("https://example.invalid/api/cli/repos/index-local", { method: "POST", body: JSON.stringify({
  remoteUrl: "https://example.invalid/synthetic/repo", totalBatches: 1, totalFiles: 1, batchIndex: 0, files: [{ path: "file.ts", content: "synthetic" }],
}) });
const changed = await POST(request());
assert.equal(changed.status, 412);
const body = await changed.json();
assert.equal(body.reason, "repository-changed");
assert.equal("repoId" in body, false);
reason = "managed-by-platform";
const managed = await POST(request());
assert.equal(managed.status, 409);
assert.equal((await managed.json()).reason, "managed-by-platform");
