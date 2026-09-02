import { describe, expect, it } from "bun:test";
import {
  resolveThinking,
  resolveThinkingOverride,
  resolveEffort,
  asThinkingEffort,
  ALWAYS_THINKING_MAX_TOKENS_FLOOR,
  DEFAULT_THINKING_EFFORT,
} from "@/lib/providers/thinking";

const FLOOR = ALWAYS_THINKING_MAX_TOKENS_FLOOR;

describe("resolveThinking", () => {
  it("non-thinking models keep their requested budget (no floor → no cap 400)", () => {
    const r = resolveThinking("claude-sonnet-4-6", 8192, false);
    expect(r.maxTokens).toBe(8192);
    expect(r.thinking).toBeUndefined();
    expect(r.outputConfig).toBeUndefined();
  });

  it("a lower-cap model is not forced above its budget (no 64k floor)", () => {
    const r = resolveThinking("claude-3-5-haiku", 4096, false);
    expect(r.maxTokens).toBe(4096);
    expect(r.thinking).toBeUndefined();
  });

  it("Fable text path: floor + adaptive thinking + effort", () => {
    const r = resolveThinking("claude-fable-5", 8192, false);
    expect(r.maxTokens).toBe(FLOOR);
    expect(r.thinking).toEqual({ type: "adaptive" });
    expect(r.outputConfig).toEqual({ effort: DEFAULT_THINKING_EFFORT });
  });

  it("Opus 5 text path: also gets adaptive thinking (same Claude-5 thinking API)", () => {
    for (const m of ["claude-opus-5", "claude-opus-5-20260115"]) {
      const r = resolveThinking(m, 8192, false);
      expect(r.maxTokens).toBe(FLOOR);
      expect(r.thinking).toEqual({ type: "adaptive" });
      expect(r.outputConfig).toEqual({ effort: DEFAULT_THINKING_EFFORT });
    }
  });

  it("opus-5 match is bounded — a different id like claude-opus-50 is NOT treated as Opus 5", () => {
    const r = resolveThinking("claude-opus-50", 8192, false);
    expect(r.maxTokens).toBe(8192); // no floor, no thinking config
    expect(r.thinking).toBeUndefined();
  });

  it("always-thinking tool path: floor only, no thinking/output config", () => {
    const r = resolveThinking("claude-opus-5", 8192, true);
    expect(r.maxTokens).toBe(FLOOR);
    expect(r.thinking).toBeUndefined();
    expect(r.outputConfig).toBeUndefined();
  });

  it("honors a caller max_tokens above the floor", () => {
    const r = resolveThinking("claude-mythos-1", 100000, false);
    expect(r.maxTokens).toBe(100000);
    expect(r.thinking).toEqual({ type: "adaptive" });
  });

  it("an explicit effort overrides the default", () => {
    const r = resolveThinking("claude-fable-5", 8192, false, "high");
    expect(r.outputConfig).toEqual({ effort: "high" });
  });

  it("explicit effort is ignored on the tool path and by non-thinking models", () => {
    expect(resolveThinking("claude-fable-5", 8192, true, "high").outputConfig).toBeUndefined();
    expect(resolveThinking("claude-sonnet-4-6", 8192, false, "high").outputConfig).toBeUndefined();
  });
});

describe("asThinkingEffort", () => {
  it("passes valid efforts through and rejects everything else", () => {
    expect(asThinkingEffort("xhigh")).toBe("xhigh");
    expect(asThinkingEffort("bogus")).toBeUndefined();
    expect(asThinkingEffort("")).toBeUndefined();
    expect(asThinkingEffort(null)).toBeUndefined();
    expect(asThinkingEffort(undefined)).toBeUndefined();
  });
});

describe("resolveEffort", () => {
  it("defaults to a valid effort and accepts env overrides", () => {
    delete process.env.FABLE_THINKING_EFFORT;
    expect(resolveEffort()).toBe(DEFAULT_THINKING_EFFORT);
    process.env.FABLE_THINKING_EFFORT = "medium";
    expect(resolveEffort()).toBe("medium");
    process.env.FABLE_THINKING_EFFORT = "bogus";
    expect(resolveEffort()).toBe(DEFAULT_THINKING_EFFORT);
    delete process.env.FABLE_THINKING_EFFORT;
  });
});

describe("resolveThinkingOverride", () => {
  it("turns thinking off when a caller asks and the model allows it", () => {
    expect(resolveThinkingOverride("claude-sonnet-5", "disabled", undefined)).toEqual({ type: "disabled" });
  });

  it("keeps adaptive thinking on always-thinking models even if asked to disable", () => {
    expect(resolveThinkingOverride("claude-fable-5-1", "disabled", { type: "adaptive" })).toEqual({ type: "adaptive" });
    expect(resolveThinkingOverride("claude-opus-5", "disabled", { type: "adaptive" })).toEqual({ type: "adaptive" });
  });

  it("passes the resolved value through when nothing was requested", () => {
    expect(resolveThinkingOverride("claude-sonnet-5", undefined, undefined)).toBeUndefined();
    expect(resolveThinkingOverride("claude-fable-5-1", undefined, { type: "adaptive" })).toEqual({ type: "adaptive" });
  });
});
