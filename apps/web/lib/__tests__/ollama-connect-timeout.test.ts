import { expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));

it("preserves Ollama connect timeouts through the SDK without classifying later timeouts", async () => {
  const { ollamaProvider } = await import("../providers/ollama");
  const { AiProviderFailure } = await import("../provider-failure");
  const originalFetch = globalThis.fetch;
  try {
    for (const [code, expected] of [["ETIMEDOUT", "local"], ["UND_ERR_CONNECT_TIMEOUT", "local"], ["UND_ERR_HEADERS_TIMEOUT", undefined]] as const) {
      let attempts = 0;
      globalThis.fetch = (async () => {
        attempts++;
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("Connect Timeout Error"), { code }),
        });
      }) as typeof fetch;
      let failure: unknown;
      try {
        await ollamaProvider.create({ model: "ollama:test", maxTokens: 10, messages: [{ role: "user", content: "test" }] });
      } catch (error) { failure = error; }
      expect(failure).toBeDefined();
      expect(new AiProviderFailure(failure, "ollama", "ollama:test", "unknown").reviewCategory).toBe(expected);
      expect(attempts).toBe(3);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 15000);
