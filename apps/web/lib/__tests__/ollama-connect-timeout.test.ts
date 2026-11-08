import { expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));

it("preserves Ollama connect timeouts through the SDK without classifying later timeouts", async () => {
  const { ollamaProvider } = await import("../providers/ollama");
  const { AiProviderFailure } = await import("../provider-failure");
  const originalFetch = globalThis.fetch;
  try {
    for (const [code, syscall, expected] of [["ETIMEDOUT", "connect", "local"], ["ETIMEDOUT", undefined, undefined], ["UND_ERR_CONNECT_TIMEOUT", undefined, "local"], ["UND_ERR_HEADERS_TIMEOUT", undefined, undefined], ["UND_ERR_BODY_TIMEOUT", undefined, undefined]] as const) {
      let attempts = 0;
      globalThis.fetch = (async () => {
        attempts++;
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("Connect Timeout Error"), { code, syscall }),
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
    globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } })) as typeof fetch;
    const success = await ollamaProvider.create({ model: "ollama:test", maxTokens: 10, messages: [{ role: "user", content: "test" }] });
    expect(success.text).toBe("ok");
    expect(success.usage.inputTokens).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 15000);
