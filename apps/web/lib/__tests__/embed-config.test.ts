import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getEmbedConfig } from "@/lib/embed-config";

const KEYS = [
  "OCTOPUS_EMBED_PROVIDER",
  "OCTOPUS_EMBED_MODEL",
  "OCTOPUS_EMBED_DIM",
  "OCTOPUS_OLLAMA_BASE_URL",
] as const;

describe("getEmbedConfig", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to OpenAI text-embedding-3-large @ 3072", () => {
    const c = getEmbedConfig();
    expect(c.provider).toBe("openai");
    expect(c.model).toBe("text-embedding-3-large");
    expect(c.dim).toBe(3072);
    expect(c.ollamaBaseUrl).toBeUndefined();
  });

  it("switches to Ollama defaults", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    const c = getEmbedConfig();
    expect(c.provider).toBe("ollama");
    expect(c.model).toBe("nomic-embed-text");
    expect(c.dim).toBe(768);
    expect(c.ollamaBaseUrl).toBe("http://localhost:11434");
  });

  it("respects per-model OpenAI dim defaults", () => {
    process.env.OCTOPUS_EMBED_MODEL = "text-embedding-3-small";
    expect(getEmbedConfig().dim).toBe(1536);
  });

  it("respects per-model Ollama dim defaults", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_EMBED_MODEL = "mxbai-embed-large";
    expect(getEmbedConfig().dim).toBe(1024);
  });

  it("explicit OCTOPUS_EMBED_DIM overrides per-model default", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_EMBED_MODEL = "nomic-embed-text";
    process.env.OCTOPUS_EMBED_DIM = "1024";
    expect(getEmbedConfig().dim).toBe(1024);
  });

  it("treats unknown provider as openai", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "huggingface";
    expect(getEmbedConfig().provider).toBe("openai");
  });

  it("strips trailing slashes from OCTOPUS_OLLAMA_BASE_URL", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_OLLAMA_BASE_URL = "http://my-box:11434///";
    expect(getEmbedConfig().ollamaBaseUrl).toBe("http://my-box:11434");
  });

  it("ignores non-numeric OCTOPUS_EMBED_DIM", () => {
    process.env.OCTOPUS_EMBED_DIM = "garbage";
    expect(getEmbedConfig().dim).toBe(3072);
  });
});
