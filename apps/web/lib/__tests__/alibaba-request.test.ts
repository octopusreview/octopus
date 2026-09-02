import { describe, it, expect } from "bun:test";
import {
  ALIBABA_DEFAULT_BASE_URL,
  ALIBABA_THINKING_MAX_TOKENS_FLOOR,
  alibabaBaseUrl,
  alibabaRequestShape,
} from "@/lib/providers/alibaba-request";

describe("alibabaBaseUrl", () => {
  it("defaults to the international endpoint", () => {
    expect(alibabaBaseUrl({})).toBe(ALIBABA_DEFAULT_BASE_URL);
    expect(alibabaBaseUrl({ DASHSCOPE_BASE_URL: "   " })).toBe(ALIBABA_DEFAULT_BASE_URL);
  });

  it("honours DASHSCOPE_BASE_URL (China endpoint) and trims trailing slashes", () => {
    expect(alibabaBaseUrl({ DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1/" })).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  });
});

describe("alibabaRequestShape", () => {
  it("keeps thinking on by default and raises the completion cap to the floor", () => {
    expect(alibabaRequestShape({ model: "qwen3.8-max-0902", maxTokens: 8192 })).toEqual({
      maxCompletionTokens: ALIBABA_THINKING_MAX_TOKENS_FLOOR,
      enableThinking: true,
    });
    expect(alibabaRequestShape({ model: "qwen3.8-max", maxTokens: 65_536 })).toEqual({ maxCompletionTokens: 65_536, enableThinking: true });
  });

  it("turns thinking off and uses the exact cap when the caller asks", () => {
    expect(alibabaRequestShape({ model: "qwen3.8-max-0902", maxTokens: 256, thinking: "disabled" })).toEqual({
      maxCompletionTokens: 256,
      enableThinking: false,
    });
  });

  it("turns thinking off for structured-output calls", () => {
    expect(alibabaRequestShape({ model: "qwen3.8-max-0902", maxTokens: 4096, responseSchema: { name: "x", schema: {} } })).toEqual({
      maxCompletionTokens: 4096,
      enableThinking: false,
    });
  });

  it("leaves models outside the hybrid-thinking family untouched (no vendor field, exact cap)", () => {
    expect(alibabaRequestShape({ model: "qwen-plus", maxTokens: 8192 })).toEqual({
      maxCompletionTokens: 8192,
      enableThinking: undefined,
    });
    expect(alibabaRequestShape({ model: "qwen2.5-coder-32b-instruct", maxTokens: 4096, thinking: "disabled" })).toEqual({
      maxCompletionTokens: 4096,
      enableThinking: undefined,
    });
  });
});
