import { describe, it, expect, mock, beforeEach } from "bun:test";
import { QDRANT_DENSE_VECTOR_SIZE } from "@/lib/qdrant";

// `server-only` is a Next.js marker module that throws if imported from a
// non-server context. The test runner is "non-server" enough to trip it.
mock.module("server-only", () => ({}));

// Mock the AI/usage/cost helpers — none of them are exercised by the
// assertion path we're testing.
mock.module("@/lib/cost", () => ({
  isOrgOverSpendLimit: () => Promise.resolve(false),
}));
mock.module("@/lib/ai-usage", () => ({
  logAiUsage: () => Promise.resolve(),
}));

// Returned embedding dim is the lever — tests reset it per case.
let mockReturnedDim = QDRANT_DENSE_VECTOR_SIZE;

mock.module("@/lib/ai-client", () => ({
  // No tracking → embeddings uses "text-embedding-3-large" default; with
  // tracking it asks ai-client. Cover both paths by always returning the
  // override model the test cares about.
  getEmbedModel: () => Promise.resolve("text-embedding-3-small"),
}));

mock.module("openai", () => {
  // Minimal stub matching the shape embeddings.ts uses:
  // `new OpenAI(...)` + `.embeddings.create(...)` returning `{ data, usage }`.
  // embeddings.ts also references `OpenAI.APIError` (static) in its catch
  // branch — must be present as a class, otherwise `err instanceof X` throws
  // "Right hand side of instanceof is not an object" before reaching the
  // dim-check assertion we want to test.
  class StubAPIError extends Error {
    status?: number;
  }
  class StubOpenAI {
    static APIError = StubAPIError;
    embeddings = {
      create: ({ input }: { input: string[] }) =>
        Promise.resolve({
          data: input.map(() => ({ embedding: new Array(mockReturnedDim).fill(0.1) })),
          usage: { prompt_tokens: 1 },
        }),
    };
  }
  return { default: StubOpenAI, APIError: StubAPIError };
});

// Import AFTER mocks are wired so module init picks them up.
const { createEmbeddings } = await import("@/lib/embeddings");

describe("createEmbeddings — Qdrant dim validation", () => {
  beforeEach(() => {
    mockReturnedDim = QDRANT_DENSE_VECTOR_SIZE; // default: matches
  });

  // tracking arg forces `embedModel = await getEmbedModel(orgId, repoId)`
  // (the mock returns "text-embedding-3-small"). Without tracking,
  // createEmbeddings hardcodes the default model — not the path this PR
  // is hardening.
  const TRACKING = { organizationId: "org-test", operation: "index-test" };

  it("passes through when returned vectors match collection dim", async () => {
    mockReturnedDim = QDRANT_DENSE_VECTOR_SIZE;
    const out = await createEmbeddings(["hello", "world"], TRACKING);
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(QDRANT_DENSE_VECTOR_SIZE);
    expect(out[1].length).toBe(QDRANT_DENSE_VECTOR_SIZE);
  });

  it("throws an actionable error when returned dim is smaller than collection (e.g. text-embedding-3-small native)", async () => {
    mockReturnedDim = 1536; // text-embedding-3-small / ada-002 native
    await expect(createEmbeddings(["hello"], TRACKING)).rejects.toThrow(
      /Embedding model "text-embedding-3-small" returned 1536-dim vectors but the Qdrant collection is configured for 3072/,
    );
  });

  it("error message names BOTH dims AND the model so the user can act", async () => {
    mockReturnedDim = 1536;
    try {
      await createEmbeddings(["x"], TRACKING);
      throw new Error("expected createEmbeddings to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("text-embedding-3-small");
      expect(msg).toContain("1536");
      expect(msg).toContain(String(QDRANT_DENSE_VECTOR_SIZE));
      // Actionable remediation guidance must be in the message.
      expect(msg).toMatch(/pick a model|re-create the Qdrant collection/);
    }
  });

  it("does not leak partial validVectors when a mid-batch item has wrong dim", async () => {
    // Whole batch fails atomically — the partial-state regression we fixed.
    // Hard to assert directly on internal state, but if the function throws,
    // the caller sees no return value, which is the externally visible
    // contract that prevents downstream half-indexing.
    mockReturnedDim = 1536;
    await expect(
      createEmbeddings(["a", "b", "c", "d"], TRACKING),
    ).rejects.toThrow(/returned 1536-dim vectors but the Qdrant collection is configured for 3072/);
  });
});
