import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const models = {
  anthropic: "claude-fixture", openai: "gpt-fixture", google: "gemini-fixture", grok: "grok-fixture",
  openrouter: "openrouter/fixture", alibaba: "qwen3.8-max-fixture", ollama: "ollama:fixture", local: "local:fixture",
  acp: "acp:fixture", opencode: "opencode:fixture", "claude-code": "claude-code:fixture", mock: "mock-fixture", "mock-fail": "mock-fail-fixture",
} as const;
const columns: Record<string, string> = {
  anthropic: "anthropicApiKey", openai: "openaiApiKey", google: "googleApiKey", grok: "grokApiKey",
  openrouter: "openrouterApiKey", alibaba: "alibabaApiKey",
};
const stored: Record<string, string | null> = Object.fromEntries(Object.values(columns).map(name => [name, `fake:${name}`]));
let absent = false;
let databaseUnavailable = false;
const selections: Array<{ orgId: string; fields: string[] }> = [];
const decrypted: string[] = [];
let received: { provider: string; key: string | null | undefined; orgId: string | null | undefined } | undefined;
let beforeProvider: (() => void) | undefined;
let admissionResult: unknown;
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => [...Object.entries(models).map(([provider, modelId]) => ({ provider, modelId })), { provider: "__proto__", modelId: "invalid-provider-fixture" }] },
  organization: { findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
    selections.push({ orgId: where.id, fields: Object.keys(select).sort() });
    if (databaseUnavailable) throw new Error("synthetic database unavailable");
    if (absent) return null;
    return Object.fromEntries(Object.keys(select).map(key => [key, key === "id" ? where.id : stored[key] ?? null]));
  } },
} }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => {
  decrypted.push(value);
  if (!value.startsWith("fake:")) throw new Error("unexpected synthetic ciphertext");
  return value.slice(5);
} }));
mock.module("@/lib/providers", () => ({ getProvider: (provider: string) => {
  if (!Object.hasOwn(models, provider)) throw new Error("unsupported synthetic provider");
  return {
  create: async (params: { model: string; completeReviewAdmission?: { beforeGeneration: (signal: AbortSignal) => Promise<unknown> } }, key: string | null | undefined, orgId: string | null | undefined) => {
    received = { provider, key, orgId };
    beforeProvider?.();
    if (params.completeReviewAdmission) admissionResult = await params.completeReviewAdmission.beforeGeneration(new AbortController().signal);
    return { provider, model: params.model, text: "fixture", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
  };
} }));
const { createAiMessage } = await import("../../ai-router");
const params = { maxTokens: 8, effort: "medium" as const, messages: [{ role: "user" as const, content: "fixture" }] };

for (const [provider, model] of Object.entries(models)) {
  selections.length = 0;
  decrypted.length = 0;
  const response = await createAiMessage({ ...params, model }, "synthetic-org");
  const column = columns[provider];
  assert.deepEqual(selections, [{ orgId: "synthetic-org", fields: [column ?? "id"] }]);
  assert.deepEqual(decrypted, column ? [`fake:${column}`] : []);
  assert.deepEqual(received, { provider, key: column ?? null, orgId: "synthetic-org" });
  assert.equal(response.usedOwnKey, undefined, "ordinary-call payer handling is unchanged");
}

selections.length = 0;
received = undefined;
const originalError = console.error;
console.error = () => {};
try {
  await assert.rejects(() => createAiMessage({ ...params, model: "invalid-provider-fixture" }, "synthetic-org"));
} finally {
  console.error = originalError;
}
assert.deepEqual(selections, [{ orgId: "synthetic-org", fields: ["id"] }]);
assert.equal(received, undefined, "an invalid provider must not dispatch");

absent = true;
await createAiMessage({ ...params, model: models.openai }, "missing-org");
assert.equal(received?.key, null);
absent = false;
stored.googleApiKey = "invalid-unrelated-ciphertext";
await createAiMessage({ ...params, model: models.openai }, "synthetic-org");
assert.equal(received?.key, "openaiApiKey");
stored.googleApiKey = "fake:googleApiKey";
stored.openaiApiKey = "invalid-selected-ciphertext";
received = undefined;
await assert.rejects(() => createAiMessage({ ...params, model: models.openai }, "synthetic-org"), /unexpected synthetic ciphertext/);
assert.equal(received, undefined, "a selected-key decryption failure must not fall back to platform billing");
stored.openaiApiKey = "fake:openaiApiKey";
stored.openaiApiKey = null;
await createAiMessage({ ...params, model: models.openai }, "synthetic-org");
assert.equal(received?.key, null);
stored.openaiApiKey = "fake:openaiApiKey";
databaseUnavailable = true;
received = undefined;
await assert.rejects(() => createAiMessage({ ...params, model: models.ollama }, "synthetic-org"), /synthetic database unavailable/);
assert.equal(received, undefined, "a provider without a key must still fail closed on a database error");
databaseUnavailable = false;
const cancelled = new AbortController();
const cancellation = new Error("synthetic cancellation");
cancelled.abort(cancellation);
selections.length = 0;
await assert.rejects(() => createAiMessage({ ...params, model: models.openai }, "synthetic-org", cancelled.signal), error => error === cancellation);
assert.equal(selections.length, 0);

// A fake provider invokes the existing pre-generation fence after key rotation.
const signal = new AbortController().signal;
const window = { signal, remainingMs: () => 2_000_000 };
const admission = { window, beforeGeneration: async () => null };
const policyModel = "claude-fable-5-1";
beforeProvider = () => { stored.anthropicApiKey = "fake:rotated"; };
const response = await createAiMessage({ ...params, model: policyModel, completeReviewAdmission: admission } as never, "synthetic-org");
assert.equal(admissionResult, "credential-route-changed");
assert.equal(response.usedOwnKey, true);
assert.deepEqual(received, { provider: "anthropic", key: "anthropicApiKey", orgId: "synthetic-org" });
stored.anthropicApiKey = "fake:anthropicApiKey";
beforeProvider = () => { stored.googleApiKey = "fake:other-rotation"; };
await createAiMessage({ ...params, model: policyModel, completeReviewAdmission: admission } as never, "synthetic-org");
assert.equal(admissionResult, null, "an unrelated provider key change must not invalidate this route");
stored.anthropicApiKey = null;
beforeProvider = () => { stored.anthropicApiKey = "fake:added"; };
const platformResponse = await createAiMessage({ ...params, model: policyModel, completeReviewAdmission: admission } as never, "synthetic-org");
assert.equal(admissionResult, "credential-route-changed");
assert.equal(platformResponse.usedOwnKey, false);
assert.equal(received?.key, null);
