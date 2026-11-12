import { mock } from "bun:test";
import assert from "node:assert/strict";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
assert.match(url.username, /^octopus_key_select_test_/);
assert.equal(url.search, "");
const orgA = process.env.TASK_SYNTHETIC_ORG_A ?? "";
const orgB = process.env.TASK_SYNTHETIC_ORG_B ?? "";
assert.match(orgA, /^fixture_[a-f0-9]+_a$/);
assert.match(orgB, /^fixture_[a-f0-9]+_b$/);
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
mock.module("@octopus/db", () => ({ prisma: new Proxy(prisma, {
  get(target, property, receiver) {
    if (property === "availableModel") return { findMany: async () => [] };
    return Reflect.get(target, property, receiver);
  },
}) }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => value.replace(/^fake:/, "") }));
let usedKey: string | null | undefined;
mock.module("@/lib/providers", () => ({ getProvider: () => ({
  create: async (params: { model: string }, key: string | null | undefined) => {
    usedKey = key;
    return { provider: "openai", model: params.model, text: "fixture", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
}) }));
try {
  await assert.rejects(
    () => prisma.$queryRaw`SELECT "anthropicApiKey" FROM organizations WHERE id = ${orgA}`,
    (error: Error) => /Code: `42501`/.test(error.message),
  );
  const { createAiMessage } = await import("../../ai-router");
  await createAiMessage({ model: "gpt-fixture", maxTokens: 8, messages: [{ role: "user", content: "fixture" }] }, orgA);
  assert.equal(usedKey, "openai");
  await createAiMessage({ model: "gpt-fixture", maxTokens: 8, messages: [{ role: "user", content: "fixture" }] }, orgB);
  assert.equal(usedKey, "other");
  await createAiMessage({ model: "gpt-fixture", maxTokens: 8, messages: [{ role: "user", content: "fixture" }] }, `${orgA}_missing`);
  assert.equal(usedKey, null);
} finally {
  await prisma.$disconnect();
}
