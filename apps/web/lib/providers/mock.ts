import "server-only";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * Test-only provider. Returns a canned response so tests can exercise the
 * review pipeline end-to-end without an actual LLM call.
 *
 * Selecting a response:
 *   1. If `MOCK_AI_FIXTURE` is set, read it as a JSON file path; return the
 *      file's contents as the response text.
 *   2. Otherwise return a generic OK payload that satisfies the review
 *      output schema (zero findings, all-5 score) so the reviewer treats
 *      the PR as clean.
 *
 * Zero cost — ai-usage.ts treats mock as zero-priced.
 */
const GENERIC_OK_RESPONSE = JSON.stringify({
  overallScore: 5,
  categoryScores: {
    security: 5,
    codeQuality: 5,
    performance: 5,
    errorHandling: 5,
    consistency: 5,
  },
  summary: "Mock provider response — no findings.",
  findings: [],
});

export const mockProvider: Provider = {
  name: "mock",
  supportsJsonSchema: true, // pretends to honor schemas; the fixture is the user's responsibility
  async create(params: AiCreateParams, _apiKey?: string | null): Promise<AiResponse> {
    let text = GENERIC_OK_RESPONSE;
    const fixturePath = process.env.MOCK_AI_FIXTURE;
    if (fixturePath) {
      const fs = await import("node:fs/promises");
      text = await fs.readFile(fixturePath, "utf8");
    }
    // Approximate input token count: 4 chars/token rule of thumb.
    const inputChars =
      (params.system?.length ?? 0) +
      params.messages.reduce((acc, m) => acc + m.content.length, 0);
    return {
      text,
      provider: "mock",
      model: params.model,
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
