import { afterAll, describe, expect, it, mock } from "bun:test";
import { encryptString } from "@/lib/crypto";

mock.module("server-only", () => ({}));

// Synthetic keys only: a short key that the settings page now fully masks, stored
// encrypted and as legacy plaintext. The provider must still receive the plaintext.
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
afterAll(() => server.stop(true));

const params = { model: "gpt-4o", maxTokens: 16, messages: [{ role: "user" as const, content: "hi" }] };

describe("createAiMessage with a stored short BYOK key", () => {
  it("sends the decrypted key, not the ciphertext, to the provider", async () => {
    storedKey = encryptString(SHORT_KEY);
    const res = await createAiMessage(params, "org_1");
    expect(res.text).toBe("emulated");
    expect(seenAuth.at(-1)).toBe(`Bearer ${SHORT_KEY}`);
  });

  it("sends a legacy plaintext key unchanged", async () => {
    storedKey = SHORT_KEY;
    await createAiMessage(params, "org_1");
    expect(seenAuth.at(-1)).toBe(`Bearer ${SHORT_KEY}`);
  });
});
