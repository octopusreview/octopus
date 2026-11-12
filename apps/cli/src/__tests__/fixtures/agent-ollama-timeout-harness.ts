import { mock } from "bun:test";
import assert from "node:assert/strict";

const scenario = process.argv[2];
const complete = scenario === "success";
let delivered: Record<string, unknown> | undefined;
let claims = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  if (new URL(request.url).pathname === "/api/tags") return Response.json({ models: [] });
  if (scenario === "error-complete") return new Response("synthetic failure", { status: 500 });
  if (complete) return Response.json({ choices: [{ message: { content: "fixture result" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); } }), {
    status: scenario === "error-body" ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
} });
process.env.OLLAMA_BASE_URL = server.url.origin;
process.env.OCTP_OLLAMA_TIMEOUT_MS = "150";
mock.module("../../lib/credentials.js", () => ({ loadCredentials: async () => ({ baseUrl: "http://fixture.invalid", token: "synthetic", orgName: "fixture" }) }));
mock.module("../../lib/config.js", () => ({ loadConfig: async () => ({}), DEFAULT_OLLAMA_BASE_URL: server.url.origin }));
mock.module("../../lib/agent-watch.js", () => ({ resolveWatchedRepos: async () => ({ repos: new Map(), warnings: [] }) }));
mock.module("../../lib/api.js", () => ({
  getJson: async () => claims++ === 0 ? { ok: true, data: { tasks: [{ id: "task", modelId: "ollama:fixture", system: null, messages: [], maxTokens: 8, createdAt: new Date().toISOString() }] } } : { ok: false, status: 401, error: "fixture stop" },
  postJson: async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith("/register")) return { ok: true, data: { agentId: "agent" } };
    if (url.endsWith("/complete")) delivered = body;
    return { ok: true, data: {} };
  },
}));
const { agentServeCommand } = await import("../../commands/agent-serve.js");
let guard: ReturnType<typeof setTimeout>;
try {
  await Promise.race([
    agentServeCommand(["--name", "fixture"]),
    new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("agent did not finish the response body within its timeout")), 5000); }),
  ]);
  assert.ok(delivered, "completion must be delivered");
  if (complete) {
    assert.equal(delivered.text, "fixture result");
    assert.deepEqual(delivered.usage, { inputTokens: 3, outputTokens: 2 });
  } else if (scenario === "error-complete") {
    assert.equal(delivered.error, "Ollama returned 500: synthetic failure");
  } else {
    assert.match(String(delivered.error), /timed out/i);
  }
} finally {
  clearTimeout(guard!);
  server.stop(true);
}
