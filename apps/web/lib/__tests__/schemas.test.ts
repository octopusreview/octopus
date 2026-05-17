import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { findingSchema, reviewOutputSchema, type Finding } from "@/lib/schemas/review";
import { providerJsonSchema } from "@/lib/schemas/json-schema";

describe("findingSchema", () => {
  const validFinding: Finding = {
    severity: "🔴",
    category: "Security",
    title: "SQL injection in query builder",
    filePath: "src/db/queries.ts",
    startLine: 42,
    endLine: 42,
    description: "User input is concatenated into SQL string.",
    suggestion: "db.query('SELECT * FROM users WHERE id = $1', [id])",
    confidence: 95,
  };

  it("accepts a well-formed finding", () => {
    const parsed = findingSchema.parse(validFinding);
    expect(parsed).toEqual(validFinding);
  });

  it("rejects unknown severity emoji", () => {
    expect(() =>
      findingSchema.parse({ ...validFinding, severity: "🦑" }),
    ).toThrow();
  });

  it("rejects confidence outside 0-100", () => {
    expect(() =>
      findingSchema.parse({ ...validFinding, confidence: 150 }),
    ).toThrow();
    expect(() =>
      findingSchema.parse({ ...validFinding, confidence: -1 }),
    ).toThrow();
  });

  it("rejects non-integer line numbers", () => {
    expect(() =>
      findingSchema.parse({ ...validFinding, startLine: 1.5 }),
    ).toThrow();
  });

  it("requires all fields — missing description fails", () => {
    const { description: _description, ...missing } = validFinding;
    expect(() => findingSchema.parse(missing)).toThrow();
  });
});

describe("reviewOutputSchema", () => {
  it("accepts a valid review with zero findings", () => {
    const out = reviewOutputSchema.parse({
      overallScore: 5,
      categoryScores: {
        security: 5,
        codeQuality: 5,
        performance: 5,
        errorHandling: 5,
        consistency: 5,
      },
      summary: "Clean PR.",
      findings: [],
    });
    expect(out.findings).toHaveLength(0);
  });

  it("rejects overall score 0 or 6", () => {
    const base = {
      categoryScores: { security: 3, codeQuality: 3, performance: 3, errorHandling: 3, consistency: 3 },
      summary: "x",
      findings: [],
    };
    expect(() => reviewOutputSchema.parse({ ...base, overallScore: 0 })).toThrow();
    expect(() => reviewOutputSchema.parse({ ...base, overallScore: 6 })).toThrow();
  });
});

describe("providerJsonSchema", () => {
  it("strips $schema, minimum, maximum, etc. from the generated schema", () => {
    const schema = z.object({
      confidence: z.number().min(0).max(100),
    });
    const json = providerJsonSchema(schema);
    const dump = JSON.stringify(json);
    expect(dump).not.toContain("$schema");
    expect(dump).not.toContain("minimum");
    expect(dump).not.toContain("maximum");
    expect(dump).not.toContain("exclusiveMinimum");
    expect(dump).not.toContain("exclusiveMaximum");
    expect(dump).not.toContain("multipleOf");
  });

  it("preserves required fields, types, and properties", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int(),
    });
    const json = providerJsonSchema(schema) as {
      type: string;
      required?: string[];
      properties?: Record<string, { type: string }>;
    };
    expect(json.type).toBe("object");
    expect(json.required).toEqual(expect.arrayContaining(["name", "age"]));
    expect(json.properties?.name?.type).toBe("string");
    expect(json.properties?.age?.type).toBe("integer");
  });

  it("recurses into nested arrays and objects", () => {
    const schema = z.object({
      tags: z.array(z.object({ label: z.string(), weight: z.number().min(0) })),
    });
    const json = providerJsonSchema(schema);
    const dump = JSON.stringify(json);
    expect(dump).not.toContain("minimum");
    expect(dump).toContain("label");
    expect(dump).toContain("weight");
  });

  it("converts the review output schema without forbidden keywords", () => {
    const json = providerJsonSchema(reviewOutputSchema);
    const dump = JSON.stringify(json);
    expect(dump).not.toContain("minimum");
    expect(dump).not.toContain("maximum");
    expect(dump).toContain("findings");
    expect(dump).toContain("overallScore");
    expect(dump).toContain("severity");
  });
});
