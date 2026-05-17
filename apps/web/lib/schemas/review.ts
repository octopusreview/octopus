import { z } from "zod";

export const findingSeverity = z.enum(["🔴", "🟠", "🟡", "🔵", "💡"]);

export const findingSchema = z.object({
  severity: findingSeverity,
  category: z.string().describe("Free-text category, e.g. 'Security', 'Logic Error', 'Race Condition'"),
  title: z.string().describe("Short, specific summary of the issue"),
  filePath: z.string().describe("Relative file path. No backticks, no ':L42' suffix"),
  startLine: z.number().int().describe("First line of the finding. MUST be a line marked '+' in the diff"),
  endLine: z.number().int().describe("Last line of the finding. Equals startLine for single-line findings"),
  description: z.string().describe("What the issue is and why it matters"),
  suggestion: z.string().describe("Plain code string for the suggested fix. Empty string if no concrete fix"),
  confidence: z.number().min(0).max(100).describe("Reviewer confidence 0-100"),
  // Anti-hallucination fields — force the reviewer to articulate test coverage,
  // a concrete regression, and the minimum fix before emitting a finding. If
  // the model cannot fill these honestly the finding is usually speculative.
  whyTestsDoNotAlreadyCoverThis: z.string().describe(
    "Specific tests inspected and why they fail to exercise this case. Required.",
  ),
  suggestedRegressionTest: z.string().describe(
    "Concrete test (code or pseudocode) that fails today and passes after the suggestion. Empty string only for style nits.",
  ),
  minimumFixScope: z.string().describe(
    "Smallest change that resolves this finding. Required.",
  ),
});

export type Finding = z.infer<typeof findingSchema>;

export const categoryScores = z.object({
  security: z.number().int().min(1).max(5),
  codeQuality: z.number().int().min(1).max(5),
  performance: z.number().int().min(1).max(5),
  errorHandling: z.number().int().min(1).max(5),
  consistency: z.number().int().min(1).max(5),
});

export const reviewOutputSchema = z.object({
  overallScore: z.number().int().min(1).max(5).describe("Overall PR quality 1-5"),
  categoryScores: categoryScores,
  summary: z.string().describe("One-paragraph overall assessment"),
  findings: z.array(findingSchema),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
