import { mock } from "bun:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiCreateParams } from "../../providers";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));
const incidents: Array<{ tags: Record<string, unknown> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof incidents[number]) => { incidents.push(event); return "event"; } }));
process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const { anthropicProvider } = await import("../../providers/anthropic");
const { AiProviderFailure, safeErrorDetails } = await import("../../provider-failure");
const { reportBackgroundFailure } = await import("../../background-failure");

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const params: AiCreateParams = {
  model: "claude-opus-5-5", maxTokens: 1000, thinking: "disabled", effort: "medium",
  messages: [{ role: "user", content: "Return JSON" }], responseSchema: { name: "result", schema },
};
const legacy = { ...params, model: "claude-sonnet-4-6" };
const usage = { input_tokens: 41, output_tokens: 17, cache_read_input_tokens: 23, cache_creation_input_tokens: 7 };
const tool: Anthropic.ToolUseBlock = { type: "tool_use", id: "tool_fixture", name: "result", input: { ok: true } };
const native: Anthropic.ContentBlock[] = [
  { type: "thinking", thinking: "Synthetic reasoning", signature: "fixture" },
  { type: "text", text: '{"ok":', citations: null }, { type: "text", text: "true}", citations: null },
];
const requests: Record<string, unknown>[] = [];
let nextResponse: Response;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  assert.equal(String(input), "https://api.anthropic.com/v1/messages");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("x-api-key"), "synthetic-only");
  assert.ok(init?.signal);
  requests.push(JSON.parse(String(init.body)));
  return nextResponse;
}) as typeof fetch;

function response(blocks: Anthropic.ContentBlock[], stopReason: Anthropic.Message["stop_reason"] = "end_turn", cache = true): Response {
  const events: Record<string, unknown>[] = [{ type: "message_start", message: {
    id: "msg_fixture", type: "message", role: "assistant", model: params.model, content: [], stop_reason: null, stop_sequence: null,
    usage: cache ? { ...usage, output_tokens: 0 } : { input_tokens: 41, output_tokens: 0 },
  } }];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { ...block, text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else if (block.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { ...block, thinking: "", signature: "" } },
        { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } },
        { type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { ...block, input: {} } },
        { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      throw new Error("Unsupported fixture block");
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 17 } }, { type: "message_stop" });
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

nextResponse = response(native);
assert.deepEqual(await anthropicProvider.create(params, "synthetic-only"), {
  text: '{"ok":true}', provider: "anthropic", model: params.model,
  completion: { state: "completed", reason: "end_turn" },
  usage: { inputTokens: 41, outputTokens: 17, cacheReadTokens: 23, cacheWriteTokens: 7 },
});
assert.deepEqual(requests.at(-1), {
  model: params.model, max_tokens: 64000, stream: true, thinking: { type: "adaptive" },
  output_config: { effort: "medium", format: { type: "json_schema", schema } }, messages: params.messages,
});

const sonnet = { ...params, model: "claude-sonnet-5-5" };
for (const thinking of [undefined, "disabled"] as const) {
  nextResponse = response(native);
  const result = await anthropicProvider.create({ ...sonnet, thinking }, "synthetic-only");
  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.model, sonnet.model);
  assert.deepEqual(result.completion, { state: "completed", reason: "end_turn" });
  assert.deepEqual(requests.at(-1), {
    model: sonnet.model, max_tokens: 64000, stream: true,
    thinking: { type: thinking === "disabled" ? "between_tools" : "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema } }, messages: params.messages,
  });
}

nextResponse = response([tool], "tool_use");
assert.deepEqual(await anthropicProvider.create(legacy, "synthetic-only"), {
  text: '{"ok":true}', provider: "anthropic", model: legacy.model,
  completion: { state: "completed", reason: "tool_use" },
  usage: { inputTokens: 41, outputTokens: 17, cacheReadTokens: 23, cacheWriteTokens: 7 },
});
assert.deepEqual(requests.at(-1), {
  model: legacy.model, max_tokens: 1000, stream: true, thinking: { type: "disabled" }, messages: params.messages,
  tools: [{ name: "result", description: "Return the response as a result object.", input_schema: schema }],
  tool_choice: { type: "tool", name: "result" },
});

nextResponse = response([{ type: "text", text: "Ordinary review", citations: null }], "end_turn", false);
const ordinary = await anthropicProvider.create({ ...params, responseSchema: undefined }, "synthetic-only");
assert.equal(ordinary.text, "Ordinary review");
assert.deepEqual(ordinary.usage, { inputTokens: 41, outputTokens: 17, cacheReadTokens: 0, cacheWriteTokens: 0 });
assert.deepEqual(ordinary.completion, { state: "completed", reason: "end_turn" });
assert.deepEqual(requests.at(-1)?.output_config, { effort: "medium" });
assert.equal(requests.at(-1)?.tool_choice, undefined);
assert.equal(requests.at(-1)?.tools, undefined);

for (const [request, blocks] of [[params, native], [sonnet, native], [legacy, [tool]]] as const) {
  nextResponse = response([...blocks], "max_tokens");
  const truncated = await anthropicProvider.create(request, "synthetic-only");
  assert.equal(truncated.text, '{"ok":true}');
  assert.deepEqual(truncated.completion, { state: "incomplete", reason: "max_tokens" });
  assert.deepEqual(truncated.usage, { inputTokens: 41, outputTokens: 17, cacheReadTokens: 23, cacheWriteTokens: 7 });
}

nextResponse = response(native, null);
assert.deepEqual((await anthropicProvider.create(params, "synthetic-only")).completion, { state: "unknown", reason: null });
for (const request of [params, legacy]) {
  nextResponse = response([], "refusal");
  await assert.rejects(() => anthropicProvider.create(request, "synthetic-only"), (error: unknown) => {
    assert.equal(safeErrorDetails(error).code, "PROVIDER_REFUSAL");
    const failure = new AiProviderFailure(error, "anthropic", request.model, "platform");
    reportBackgroundFailure(failure, { stage: "generation" });
    assert.equal(incidents.at(-1)?.tags.failure_code, "PROVIDER_REFUSAL");
    assert.ok(!JSON.stringify(incidents.at(-1)).includes("synthetic-only"));
    return true;
  });
}
nextResponse = response([native[0]], "max_tokens");
await assert.rejects(() => anthropicProvider.create(params, "synthetic-only"), /returned no text/);
nextResponse = response(native);
await assert.rejects(() => anthropicProvider.create(legacy, "synthetic-only"), /returned no tool_use/);
nextResponse = response([{ ...tool, input: {} }], "tool_use");
await assert.rejects(() => anthropicProvider.create(legacy, "synthetic-only"), /returned empty structured output/);
nextResponse = Response.json({ type: "error", error: { type: "invalid_request_error", message: "synthetic rejection" } }, { status: 400 });
const before = requests.length;
await assert.rejects(() => anthropicProvider.create(params, "synthetic-only"), /synthetic rejection/);
assert.equal(requests.length, before + 1);
console.log("PASS native JSON, legacy tools, completion, usage and failures");
