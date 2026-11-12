import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
process.env.OLLAMA_SERVER_URL = `http://127.0.0.1:${server.port}`;
server.stop(true);

const { ollamaProvider } = await import("../../providers/ollama");
const { AiProviderFailure } = await import("../../provider-failure");
let failure: unknown;
try {
  await ollamaProvider.create({ model: "ollama:test", maxTokens: 10, messages: [{ role: "user", content: "test" }] });
} catch (error) {
  failure = error;
}
assert.ok(failure);
assert.equal(new AiProviderFailure(failure, "ollama", "ollama:test", "unknown").reviewCategory, "local");
assert.equal(new AiProviderFailure(failure, "openai", "test", "platform").reviewCategory, undefined);
