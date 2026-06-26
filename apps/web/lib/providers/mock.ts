import "server-only";
import { resolve, sep } from "node:path";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * Test-only provider. Returns a canned response so tests can exercise the
 * review pipeline end-to-end without an actual LLM call.
 *
 * Selecting a response:
 *   1. If `MOCK_AI_FIXTURE` is set, read it as a *relative path inside
 *      `<cwd>/test/fixtures/ai`* and return the file's contents as the
 *      response text. Absolute paths and traversal escapes are rejected.
 *   2. Otherwise return a generic OK payload that satisfies the review
 *      output schema (zero findings, all-5 score) so the reviewer treats
 *      the PR as clean.
 *
 * Hardening: even when an operator sets `ENABLE_MOCK_PROVIDERS=true` to
 * expose this in a hosted environment (e.g. for staging smoke tests),
 * the fixture-file read refuses to run when `NODE_ENV === "production"`.
 * Otherwise a misconfigured env var becomes a local-file disclosure
 * primitive (`/etc/passwd`, mounted secrets, `.env`).
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

const FIXTURE_ROOT = resolve(process.cwd(), "test/fixtures/ai");

async function loadFixture(): Promise<string> {
  const raw = process.env.MOCK_AI_FIXTURE;
  if (!raw) return GENERIC_OK_RESPONSE;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MOCK_AI_FIXTURE is not honoured in production");
  }
  const resolved = resolve(FIXTURE_ROOT, raw);
  if (resolved !== FIXTURE_ROOT && !resolved.startsWith(FIXTURE_ROOT + sep)) {
    throw new Error(`MOCK_AI_FIXTURE escapes fixture root: ${raw}`);
  }
  const fs = await import("node:fs/promises");
  return fs.readFile(resolved, "utf8");
}

export const mockProvider: Provider = {
  name: "mock",
  supportsJsonSchema: true, // pretends to honor schemas; the fixture is the user's responsibility
  async create(params: AiCreateParams): Promise<AiResponse> {
    const text = await loadFixture();
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
