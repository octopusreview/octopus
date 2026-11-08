import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

const marker = "synthetic-provider-secret";
let mode = "embedding";
let providerCalls = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
  providerCalls++;
  return mode === "embedding" ? new Response(marker, { status: 503 }) : Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
} });
process.env.SELF_HOSTED = "true";
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  askOctopusSession: { create: async () => ({ id: "synthetic-session" }) },
  askOctopusMessage: { create: async ({ data }: { data: { role: string } }) => {
    if (data.role === "assistant" && mode === "save") throw new Error(marker);
    return {};
  } },
} }));
mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ provider: "ollama", model: "synthetic", dim: 3, ollamaBaseUrl: server.url.origin }) }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => null }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/qdrant", () => ({ ensureDocsCollection: async () => {}, searchDocsChunks: async () => [] }));
mock.module("@anthropic-ai/sdk", () => ({ default: class {
  messages = { stream: async () => ({ async *[Symbol.asyncIterator]() {
    if (mode === "stream") throw new Error(marker);
    yield { type: "content_block_delta", delta: { type: "text_delta", text: "synthetic answer" } };
  } }) };
} }));

const logs: unknown[][] = [];
console.error = (...args: unknown[]) => { logs.push(args); };
try {
  const { POST } = await import("../../../app/api/ask-octopus/route");
  const call = (userAgent = "Mozilla/5.0") => POST(new Request("http://localhost/api/ask-octopus", {
    method: "POST", headers: { "user-agent": userAgent, "content-type": "application/json" },
    body: JSON.stringify({ message: "synthetic question" }),
  }));
  assert.equal((await call("not-a-browser")).status, 404);
  assert.equal(providerCalls, 0);
  for (const scenario of ["embedding", "stream", "save", "success"]) {
    mode = scenario;
    const previousLogCount = logs.length;
    const response = await call();
    const text = await response.text();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(response.status, scenario === "embedding" ? 500 : 200);
    assert.ok(!text.includes(marker));
    assert.ok(!inspect(logs, { depth: 10 }).includes(marker));
    if (scenario !== "success") assert.ok(logs.length > previousLogCount);
    if (scenario === "embedding") assert.ok(text.includes("Something went wrong"));
    if (scenario === "stream") assert.ok(text.includes("Stream interrupted"));
    if (scenario === "save" || scenario === "success") assert.ok(text.includes("synthetic answer") && text.includes("[DONE]"));
  }
  assert.equal(providerCalls, 4);
} finally {
  server.stop(true);
}
