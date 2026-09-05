import { describe, expect, it } from "bun:test";
import { buildSequence } from "../lib/sequence";

const ALL = ["welcome", "auth", "org", "provider", "model", "byok", "ollama-setup", "validate", "repo", "done"] as const;

describe("buildSequence", () => {
  it("hides only the Ollama tab before the provider step is passed", () => {
    expect(buildSequence(ALL, { provider: "ollama", providerConfirmed: false })).toEqual(
      ["welcome", "auth", "org", "provider", "model", "byok", "validate", "repo", "done"],
    );
  });

  it("Cloud org default (no provider) goes straight to repo", () => {
    expect(buildSequence(ALL, { provider: "", providerConfirmed: true })).toEqual(
      ["welcome", "auth", "org", "provider", "repo", "done"],
    );
  });

  it("Ollama replaces model, key and validate with its own setup", () => {
    expect(buildSequence(ALL, { provider: "ollama", providerConfirmed: true })).toEqual(
      ["welcome", "auth", "org", "provider", "ollama-setup", "repo", "done"],
    );
  });

  it("recommended pair skips the model picker but keeps key and validate", () => {
    expect(buildSequence(ALL, { provider: "anthropic", model: "claude-opus-5", providerConfirmed: true })).toEqual(
      ["welcome", "auth", "org", "provider", "byok", "validate", "repo", "done"],
    );
  });

  it("a provider without a model keeps the model picker", () => {
    expect(buildSequence(ALL, { provider: "openai", providerConfirmed: true })).toEqual(
      ["welcome", "auth", "org", "provider", "model", "byok", "validate", "repo", "done"],
    );
  });
});
