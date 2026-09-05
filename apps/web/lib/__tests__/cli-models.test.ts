import { describe, expect, it } from "bun:test";
import { buildCliModelsResponse, byokProvidersFrom } from "@/lib/cli-models";

describe("cli-models", () => {
  it("reports only providers with a key, never the key itself", () => {
    const res = buildCliModelsResponse({
      model: "claude-opus-5",
      pinned: false,
      provider: "anthropic",
      displayName: "Claude Opus 5",
      keys: { anthropicApiKey: "sk-ant-secret", openaiApiKey: null, grokApiKey: "" },
    });
    expect(res).toEqual({
      provider: "anthropic",
      model: "claude-opus-5",
      displayName: "Claude Opus 5",
      isPlatformDefault: true,
      byokProviders: ["anthropic"],
    });
    expect(JSON.stringify(res)).not.toContain("sk-ant");
  });

  it("marks a pinned org/repo model as not the platform default", () => {
    expect(buildCliModelsResponse({ model: "gpt-6-astra", pinned: true, provider: "openai", displayName: null, keys: {} }).isPlatformDefault).toBe(false);
    expect(byokProvidersFrom({ openaiApiKey: "x", alibabaApiKey: "y" })).toEqual(["openai", "alibaba"]);
  });
});
