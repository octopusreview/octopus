import { describe, it, expect } from "bun:test";
import { generateSparseVector, generateSparseVectors } from "@/lib/sparse-vector";

describe("generateSparseVector", () => {
  it("returns empty vectors for empty string", () => {
    const result = generateSparseVector("");
    expect(result.indices).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it("returns empty vectors for stop-words-only input", () => {
    const result = generateSparseVector("the is a an");
    expect(result.indices).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it("returns empty vectors for code-noise-only input", () => {
    const result = generateSparseVector("const let var function return import");
    expect(result.indices).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it("produces non-empty vectors for meaningful text", () => {
    const result = generateSparseVector("authentication middleware handler");
    expect(result.indices.length).toBeGreaterThan(0);
    expect(result.values.length).toBeGreaterThan(0);
    expect(result.indices.length).toBe(result.values.length);
  });

  it("returns sorted indices", () => {
    const result = generateSparseVector("vector database search qdrant similarity cosine embedding");
    for (let i = 1; i < result.indices.length; i++) {
      expect(result.indices[i]).toBeGreaterThan(result.indices[i - 1]);
    }
  });

  it("indices are within hash space (0 to 262143)", () => {
    const result = generateSparseVector("pullrequest review webhook handler authentication");
    for (const idx of result.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(1 << 18);
    }
  });

  it("uses log-normalized TF values (>= 1.0 for any occurrence)", () => {
    const result = generateSparseVector("authentication");
    for (const val of result.values) {
      expect(val).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("repeated tokens produce higher values than single occurrence", () => {
    const single = generateSparseVector("authentication");
    const repeated = generateSparseVector("authentication authentication authentication");
    // Same indices (same token), but repeated should have higher value
    expect(single.indices).toEqual(repeated.indices);
    expect(repeated.values[0]).toBeGreaterThan(single.values[0]);
  });

  it("splits camelCase tokens", () => {
    const result1 = generateSparseVector("handleWebhookEvent");
    const result2 = generateSparseVector("handle Webhook Event");
    // Should produce the same tokens after camelCase splitting
    expect(result1.indices).toEqual(result2.indices);
  });

  it("splits snake_case tokens", () => {
    const snakeCase = generateSparseVector("handle_webhook_event");
    const spaced = generateSparseVector("handle webhook event");
    // Should produce the same tokens after snake_case splitting
    expect(snakeCase.indices).toEqual(spaced.indices);
  });

  it("filters out single-character tokens", () => {
    const result = generateSparseVector("a b c d x y z authentication");
    // Only "authentication" should survive (a-z are single chars or stop words)
    expect(result.indices.length).toBe(1);
  });

  it("is case-insensitive", () => {
    const lower = generateSparseVector("authentication");
    const upper = generateSparseVector("AUTHENTICATION");
    const mixed = generateSparseVector("Authentication");
    expect(lower.indices).toEqual(upper.indices);
    expect(lower.indices).toEqual(mixed.indices);
  });

  it("deterministic — same input produces same output", () => {
    const a = generateSparseVector("review pull request code");
    const b = generateSparseVector("review pull request code");
    expect(a.indices).toEqual(b.indices);
    expect(a.values).toEqual(b.values);
  });
});

describe("generateSparseVectors", () => {
  it("returns empty array for empty input", () => {
    const result = generateSparseVectors([]);
    expect(result).toEqual([]);
  });

  it("returns one vector per input text", () => {
    const texts = ["authentication handler", "database query", "vector search"];
    const result = generateSparseVectors(texts);
    expect(result.length).toBe(3);
  });

  it("each vector has matching indices and values lengths", () => {
    const texts = ["code review", "pull request", "webhook handler"];
    const result = generateSparseVectors(texts);
    for (const vec of result) {
      expect(vec.indices.length).toBe(vec.values.length);
    }
  });

  it("produces same result as individual calls", () => {
    const texts = ["auth middleware", "api route"];
    const batch = generateSparseVectors(texts);
    const individual = texts.map(generateSparseVector);
    expect(batch).toEqual(individual);
  });
});
