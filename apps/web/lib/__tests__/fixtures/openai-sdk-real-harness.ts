import { mock } from "bun:test";
import assert from "node:assert/strict";

// Real provider adapters through the REAL openai SDK over loopback HTTP. Run as a
// child process so mock.module("openai") in other tests cannot leak in.
mock.module("server-only", () => ({}));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => null }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));

const SECRET = "synthetic-provider-body-secret";
const KEYS = {
  openai: "synthetic-openai-platform-key", byok: "synthetic-openai-byok-key", grok: "synthetic-grok-key",
  openrouter: "synthetic-openrouter-key", alibaba: "synthetic-dashscope-key", gateway: "synthetic-gateway-key",
};
process.env.OPENAI_API_KEY = KEYS.openai;
process.env.GROK_API_KEY = KEYS.grok;
process.env.OPENROUTER_API_KEY = KEYS.openrouter;
process.env.DASHSCOPE_API_KEY = KEYS.alibaba;
process.env.OCTOPUS_EMBED_PROVIDER = "openai";
process.env.OCTOPUS_EMBED_MODEL = "text-embedding-3-large";
process.env.OCTOPUS_EMBED_DIM = "3";
for (const key of ["OPENAI_BASE_URL", "DASHSCOPE_BASE_URL", "XAI_API_KEY"]) delete process.env[key];

type Body = { input?: string[]; encoding_format?: string; dimensions?: number };
type Hit = { path: string; authorization: string | null; body: Body };
let hits: Hit[] = [];
let urls: string[] = [];
let respond: (hit: Hit) => Response = () => new Response(null, { status: 599 });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const hit = { path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), body: await request.json() as Body };
  hits.push(hit);
  return respond(hit);
} });
// The adapters hard-code provider hosts; keep the requested URL and send the bytes to loopback.
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  urls.push(url.href);
  return nativeFetch(`http://127.0.0.1:${server.port}${url.pathname}${url.search}`, init);
}) as typeof fetch;
const reset = (next: typeof respond) => { hits = []; urls = []; respond = next; };

const { openaiProvider } = await import("@/lib/providers/openai");
const { grokProvider } = await import("@/lib/providers/grok");
const { openrouterProvider } = await import("@/lib/providers/openrouter");
const { alibabaProvider } = await import("@/lib/providers/alibaba");
const { callOpenAiGateway } = await import("@/lib/providers/openai-gateway");
const { AiProviderFailure } = await import("@/lib/provider-failure");
const { createEmbeddings } = await import("@/lib/embeddings");
type Provider = ConstructorParameters<typeof AiProviderFailure>[1];

const params = { model: "synthetic-model", maxTokens: 16, system: "system", messages: [{ role: "user" as const, content: "hello" }] };
const success = (hit: Hit) => hit.path.endsWith("/responses")
  ? Response.json({ object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
      usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: { cached_tokens: 5 } } })
  : Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } } });
const failure = (status: number, message = SECRET) => () =>
  Response.json({ error: { message, type: SECRET, code: SECRET } }, { status, headers: { "retry-after-ms": "0", "x-request-id": SECRET } });
const assertSafe = (error: unknown, provider: Provider, status: number, key: string) => {
  const wrapped = new AiProviderFailure(error, provider, params.model, "platform");
  assert.equal(wrapped.details.status, status);
  assert.equal(wrapped.reviewCategory, status === 401 || status === 403 ? "auth" : undefined);
  const visible = JSON.stringify([wrapped.message, wrapped.details]);
  assert.ok(!visible.includes(SECRET) && !visible.includes(key), `${provider} ${status} leaked provider data`);
};

const adapters: { provider: Provider; url: string; key: string; call: () => Promise<{ text: string; usage: unknown }> }[] = [
  { provider: "openai", url: "https://api.openai.com/v1/chat/completions", key: KEYS.byok, call: () => openaiProvider.create(params, KEYS.byok, "synthetic-org") },
  { provider: "openai", url: "https://api.openai.com/v1/responses", key: KEYS.openai, call: () => openaiProvider.create({ ...params, model: "synthetic-codex" }, null, "synthetic-org") },
  { provider: "grok", url: "https://api.x.ai/v1/chat/completions", key: KEYS.grok, call: () => grokProvider.create(params, null) },
  { provider: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", key: KEYS.openrouter, call: () => openrouterProvider.create(params, null) },
  { provider: "alibaba", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", key: KEYS.alibaba, call: () => alibabaProvider.create(params, null) },
  { provider: "acp", url: "http://gateway.invalid/v1/chat/completions", key: KEYS.gateway,
    call: () => callOpenAiGateway({ ...params, model: "acp:synthetic-model" }, { name: "acp", modelPrefix: "acp:", baseUrl: "http://gateway.invalid", apiKey: KEYS.gateway }) },
];

try {
  for (const { provider, url, key, call } of adapters) {
    reset(success);
    const result = await call();
    assert.deepEqual(urls, [url]);
    assert.equal(hits[0].authorization, `Bearer ${key}`);
    assert.equal(result.text, "ok");
    assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 });
    for (const [status, attempts] of [[401, 1], [403, 1], [429, 3], [500, 3]]) {
      reset(failure(status));
      let error: unknown;
      try { await call(); } catch (caught) { error = caught; }
      assert.ok(error, `${url} ${status} must fail`);
      assert.equal(hits.length, attempts, `${url} ${status} attempts`);
      assertSafe(error, provider, status, key);
    }
  }

  const vector = [0.25, -0.5, 1];
  const base64 = Buffer.from(new Float32Array(vector).buffer).toString("base64");
  const embedded = (hit: Hit) => Response.json({
    data: hit.body.input!.map((_, index) => ({ index, embedding: hit.body.encoding_format === "base64" ? base64 : vector })),
    usage: { prompt_tokens: hit.body.input!.length, total_tokens: hit.body.input!.length },
  });
  reset(embedded);
  assert.deepEqual(await createEmbeddings(["a", "", "b"]), [vector, [], vector]);
  assert.deepEqual(urls, ["https://api.openai.com/v1/embeddings"]);
  assert.deepEqual([hits[0].authorization, hits[0].body.encoding_format, hits[0].body.dimensions], [`Bearer ${KEYS.openai}`, "base64", 3]);

  reset(hit => hit.body.input!.length > 1 ? failure(400, "Requested 400000 tokens, max 300000 tokens per request")() : embedded(hit));
  assert.deepEqual(await createEmbeddings(["a", "b", "c", "d"]), [vector, vector, vector, vector]);
  assert.deepEqual(hits.map(hit => hit.body.input!.length), [4, 2, 1, 1, 2, 1, 1]);

  reset(failure(401));
  let error: unknown;
  try { await createEmbeddings(["a", "b"]); } catch (caught) { error = caught; }
  assert.ok(error);
  assert.equal(hits.length, 1);
  assertSafe(error, "openai", 401, KEYS.openai);
  console.log("PASS real OpenAI SDK adapters, failures and embeddings");
} finally {
  globalThis.fetch = nativeFetch;
  server.stop(true);
}
