import { describe, it, expect, mock, beforeEach } from "bun:test";

// `server-only` throws outside a Next.js server context; neutralise it.
mock.module("server-only", () => ({}));

// Capture the exact wire body the adapter hands to the OpenAI SDK.
let captured: Record<string, unknown> | null = null;
let canned: Record<string, unknown> = {};
mock.module("openai", () => {
  class StubOpenAI {
    chat = {
      completions: {
        create: (body: Record<string, unknown>) => {
          captured = body;
          return Promise.resolve(canned);
        },
      },
    };
  }
  return { default: StubOpenAI };
});

const { alibabaProvider } = await import("@/lib/providers/alibaba");
const { ALIBABA_THINKING_MAX_TOKENS_FLOOR } = await import("@/lib/providers/alibaba-request");

const ok = (content: string | null, finish_reason = "stop") => ({
  choices: [{ message: { content }, finish_reason }],
  usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } },
});

describe("alibabaProvider.create — wire contract", () => {
  beforeEach(() => {
    captured = null;
    canned = ok("answer");
  });

  it("sends max_completion_tokens (never max_tokens) and the system message first", async () => {
    await alibabaProvider.create(
      { model: "qwen3.8-max-0902", maxTokens: 8192, system: "sys", messages: [{ role: "user", content: "hi" }] },
      "sk-byok",
    );
    expect(captured).not.toBeNull();
    expect(captured!.max_completion_tokens).toBe(ALIBABA_THINKING_MAX_TOKENS_FLOOR);
    expect("max_tokens" in captured!).toBe(false);
    expect(captured!.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(captured!.enable_thinking).toBe(true);
  });

  it("turns thinking off with the exact cap when the caller disables it", async () => {
    await alibabaProvider.create(
      { model: "qwen3.8-max-0902", maxTokens: 256, thinking: "disabled", messages: [{ role: "user", content: "x" }] },
      "sk-byok",
    );
    expect(captured!.enable_thinking).toBe(false);
    expect(captured!.max_completion_tokens).toBe(256);
  });

  it("runs structured output thinking-off with a strict json_schema response_format", async () => {
    canned = ok('{"a":1}');
    await alibabaProvider.create(
      {
        model: "qwen3.8-max-0902",
        maxTokens: 4096,
        messages: [{ role: "user", content: "x" }],
        responseSchema: { name: "Out", schema: { type: "object", properties: { a: { type: "number" } } } },
      },
      "sk-byok",
    );
    expect(captured!.enable_thinking).toBe(false);
    expect(captured!.max_completion_tokens).toBe(4096);
    expect(captured!.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "Out", schema: { type: "object", properties: { a: { type: "number" } } }, strict: true },
    });
  });

  it("omits the vendor field for models outside the hybrid-thinking family", async () => {
    await alibabaProvider.create(
      { model: "qwen-plus", maxTokens: 2048, messages: [{ role: "user", content: "x" }] },
      "sk-byok",
    );
    expect("enable_thinking" in captured!).toBe(false);
    expect(captured!.max_completion_tokens).toBe(2048);
  });

  it("maps usage: completion_tokens as output, cached_tokens as cache reads, no cache writes", async () => {
    const res = await alibabaProvider.create(
      { model: "qwen3.8-max-0902", maxTokens: 8192, messages: [{ role: "user", content: "x" }] },
      "sk-byok",
    );
    expect(res.provider).toBe("alibaba");
    expect(res.text).toBe("answer");
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 0 });
  });

  it("fails loudly when thinking consumed the whole completion budget", async () => {
    canned = ok(null, "length");
    await expect(
      alibabaProvider.create({ model: "qwen3.8-max-0902", maxTokens: 8192, messages: [{ role: "user", content: "x" }] }, "sk-byok"),
    ).rejects.toThrow(/max_completion_tokens/);
  });

  it("does not treat a plain empty stop as a thinking failure", async () => {
    canned = ok("", "stop");
    const res = await alibabaProvider.create(
      { model: "qwen3.8-max-0902", maxTokens: 8192, messages: [{ role: "user", content: "x" }] },
      "sk-byok",
    );
    expect(res.text).toBe("");
  });
});
