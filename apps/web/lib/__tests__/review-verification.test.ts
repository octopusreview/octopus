import { describe, expect, it } from "bun:test";
import { generateVerificationQueries } from "@/lib/review-helpers";
import type { InlineFinding } from "@/lib/review-dedup";

function finding(overrides: Partial<InlineFinding>): InlineFinding {
  return {
    severity: "🟠",
    title: "Issue",
    filePath: "apps/web/app/api/foo/route.ts",
    startLine: 1,
    endLine: 1,
    category: "Bug",
    description: "",
    suggestion: "",
    confidence: 80,
    ...overrides,
  };
}

describe("generateVerificationQueries — existence claims", () => {
  it("marks 'missing X' findings as existence checks with the symbol", () => {
    const findings = [
      finding({
        title: "Webhook route not registered",
        description: "The route file is missing registerWebhook handler registration.",
      }),
    ];

    const queries = generateVerificationQueries(findings);
    const existence = queries.filter((q) => q.existence);

    // Every "missing" query is flagged for full-file verification and carries a symbol + filePath.
    expect(existence.length).toBeGreaterThan(0);
    for (const q of existence) {
      expect(q.symbol).toBeTruthy();
      expect(q.filePath).toBe("apps/web/app/api/foo/route.ts");
    }
  });

  it("does not produce an existence check when the captured symbol is a stop-word", () => {
    // "missing the handler" makes the lazy regex capture "the" — searching the
    // file for "the" always matches and would wrongly suppress the finding.
    const findings = [
      finding({
        title: "Handler not wired",
        description: "The route file is missing the handler registration.",
      }),
    ];

    const queries = generateVerificationQueries(findings);
    // No existence query should carry a stop-word symbol.
    expect(queries.some((q) => q.existence && q.symbol === "the")).toBe(false);
  });

  it("does not flag non-existence findings as existence checks", () => {
    const findings = [
      finding({
        title: "Magic number",
        description: "The timeout value 5000 should be configurable.",
      }),
    ];

    const queries = generateVerificationQueries(findings);
    expect(queries.every((q) => !q.existence)).toBe(true);
  });
});
