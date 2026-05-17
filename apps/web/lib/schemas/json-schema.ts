import { z } from "zod";

/**
 * JSON Schema keywords that some providers' structured-output endpoints reject.
 * Notably: OpenAI's Codex models reject `$schema`, and numeric constraint keywords
 * are inconsistently supported across providers.
 */
const PROVIDER_UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "minimum",
  "multipleOf",
]);

/**
 * Convert a Zod schema to a JSON Schema that's safe to send to provider
 * structured-output APIs. Strips keywords that some providers reject.
 */
export function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema);
  return stripUnsupportedKeywords(raw) as Record<string, unknown>;
}

function stripUnsupportedKeywords(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnsupportedKeywords);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (PROVIDER_UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = stripUnsupportedKeywords(val);
  }
  return out;
}
