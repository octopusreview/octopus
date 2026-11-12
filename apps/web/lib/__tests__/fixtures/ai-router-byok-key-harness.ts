import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { encryptString } from "@/lib/crypto";

mock.module("server-only", () => ({}));

// Synthetic keys only: a short key that the settings page now fully masks, stored
// encrypted and as legacy plaintext. The provider must still receive the plaintext.
const originalDataKey = process.env.OCTOPUS_DATA_KEY;
const originalBaseUrl = process.env.OPENAI_BASE_URL;
process.env.OCTOPUS_DATA_KEY = "ab".repeat(32);
const SHORT_KEY = "sk-123456";
let storedKey: string | null = null;

mock.module("@octopus/db", () => ({
  prisma: {
    availableModel: { findMany: () => Promise.resolve([]) },
    organization: { findUnique: () => Promise.resolve({ openaiApiKey: storedKey }) },
  },
}));

const { createAiMessage } = await import("@/lib/ai-router");

// Local OpenAI emulator: records the credential the provider actually sends.
const seenAuth: (string | null)[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    seenAuth.push(req.headers.get("authorization"));
    return Response.json({
      choices: [{ message: { content: "emulated" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  },
});
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
const params = { model: "gpt-4o", maxTokens: 16, messages: [{ role: "user" as const, content: "hi" }] };

try {
  storedKey = encryptString(SHORT_KEY);
  const res = await createAiMessage(params, "org_1");
  assert.equal(res.text, "emulated");
  assert.equal(seenAuth.at(-1), `Bearer ${SHORT_KEY}`);
  storedKey = SHORT_KEY;
  await createAiMessage(params, "org_1");
  assert.equal(seenAuth.at(-1), `Bearer ${SHORT_KEY}`);
} finally {
  server.stop(true);
  if (originalDataKey === undefined) delete process.env.OCTOPUS_DATA_KEY;
  else process.env.OCTOPUS_DATA_KEY = originalDataKey;
  if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = originalBaseUrl;
}
