import { describe, it, expect, mock } from "bun:test";

// `server-only` is a Next.js marker module that throws if imported from a
// non-server context. ai-router.ts and every provider import it, so it must be
// stubbed before the module graph loads.
mock.module("server-only", () => ({}));

// ai-router resolves providers from the AvailableModel DB cache first, then
// falls back to prefix inference. Point the cache at a single custom model so
// we can exercise the DB-hit path; everything else falls through to prefixes.
// getOrgKeys() looks up the org — returning null yields all-null keys, which is
// exactly what the mock/mock-fail doubles want (they take no key).
mock.module("@octopus/db", () => ({
  prisma: {
    availableModel: {
      findMany: () =>
        Promise.resolve([{ modelId: "db-routed-model", provider: "mock" }]),
    },
    organization: {
      findUnique: () => Promise.resolve(null),
    },
  },
}));

// Static `import` statements are hoisted above the `mock.module` calls above,
// which would evaluate ai-router (and its "server-only" / prisma imports) before
// the mocks are registered. A dynamic import after the mocks fixes the ordering.
const { createAiMessage, resolveProvider } = await import("@/lib/ai-router");

const baseParams = {
  maxTokens: 256,
  system: "You are a reviewer.",
  messages: [{ role: "user" as const, content: "review this diff" }],
};

describe("resolveProvider", () => {
  it("routes via the AvailableModel DB cache when the model is registered", async () => {
    expect(await resolveProvider("db-routed-model")).toBe("mock");
  });

  it("falls back to prefix inference for the mock double", async () => {
    expect(await resolveProvider("mock-anything")).toBe("mock");
  });

  it("resolves mock-fail before mock (longer prefix wins)", async () => {
    // "mock-fail-…" also matches the "mock-" prefix; ordering must pick mock-fail.
    expect(await resolveProvider("mock-fail-boom")).toBe("mock-fail");
  });

  it("infers real providers from model-name prefixes", async () => {
    expect(await resolveProvider("claude-sonnet-4-20250514")).toBe("anthropic");
    expect(await resolveProvider("gpt-4o")).toBe("openai");
    expect(await resolveProvider("gemini-2.0-flash")).toBe("google");
    expect(await resolveProvider("claude-code:sonnet")).toBe("claude-code");
  });

  it("defaults to anthropic for an unknown model id", async () => {
    expect(await resolveProvider("something-totally-unknown")).toBe("anthropic");
  });
});

describe("createAiMessage", () => {
  it("routes to the mock provider and returns its canned response", async () => {
    const res = await createAiMessage({ ...baseParams, model: "mock-1" }, "org_1");

    expect(res.provider).toBe("mock");
    expect(res.model).toBe("mock-1");

    const parsed = JSON.parse(res.text) as { overallScore: number; findings: unknown[] };
    expect(parsed.overallScore).toBe(5);
    expect(parsed.findings).toEqual([]);

    // Token usage is approximated from prompt/response length — must be > 0.
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it("routes through the DB-cache mapping end-to-end", async () => {
    const res = await createAiMessage(
      { ...baseParams, model: "db-routed-model" },
      "org_1",
    );
    expect(res.provider).toBe("mock");
    expect(res.model).toBe("db-routed-model");
  });

  it("wraps provider errors with the provider name (error path)", async () => {
    await expect(
      createAiMessage({ ...baseParams, model: "mock-fail-1" }, "org_1"),
    ).rejects.toThrow(/AI provider mock-fail failed: .*deliberate failure/);
  });

  it("surfaces the model id from the failing provider in the error", async () => {
    await expect(
      createAiMessage({ ...baseParams, model: "mock-fail-xyz" }, "org_1"),
    ).rejects.toThrow(/mock-fail-xyz/);
  });
});
