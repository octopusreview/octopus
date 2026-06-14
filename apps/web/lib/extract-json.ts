/**
 * Best-effort JSON extraction from LLM text output.
 *
 * Three-tier recovery, returning the first that parses successfully:
 *   1. Strict `JSON.parse` on the whole input.
 *   2. Strip a single triple-backtick code fence (` ```json ` or ` ``` `) and parse the inner content.
 *   3. Walk the input looking for balanced `{...}` or `[...]` blocks and parse each candidate.
 *
 * Returns `null` if nothing parses. Both object AND array roots are
 * supported in tier 3 — an unfenced top-level findings array
 * (`[{...}, {...}]`) is recovered as well as a single object literal.
 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();

  // Tier 1: strict
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // Tier 2: code-fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Tier 3: balanced scan. Try ARRAY roots FIRST — an unfenced findings
  // array (`[{...}, {...}]`) always starts with `[` containing inner
  // objects, so scanning for `{` first would match the first inner object
  // and return it standalone, losing the rest of the array. Object roots
  // are tried second for the case where the model emitted a single object
  // literal (no surrounding array).
  const arrayResult = scanForRoot(trimmed, "[", "]");
  if (arrayResult !== null) return arrayResult;
  const objectResult = scanForRoot(trimmed, "{", "}");
  if (objectResult !== null) return objectResult;

  return null;
}

/**
 * Walk the input looking for balanced `open`/`close` delimited blocks
 * and return the first that parses as JSON. String literals (and their
 * escape sequences) are tracked so braces / brackets inside strings
 * don't throw off the depth counter.
 */
function scanForRoot(text: string, open: string, close: string): unknown | null {
  let firstOpen = text.indexOf(open);
  while (firstOpen !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let consumedTo = -1;

    for (let i = firstOpen; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(firstOpen, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            consumedTo = i + 1;
            break;
          }
        }
      }
    }

    // Three exit paths from the for-loop above:
    //   (a) parse succeeded → early-returned the candidate
    //   (b) parse failed at depth=0 → break with consumedTo set, advance past it
    //   (c) loop exited via i === text.length without depth reaching 0 again
    //       — happens on an unterminated string literal inside the candidate
    //       (the toggling `"` count desyncs and the close delimiter is then
    //       treated as in-string and ignored). Advance firstOpen by ONE so a
    //       later valid candidate elsewhere in the text still has a chance.
    if (consumedTo === -1) {
      firstOpen = text.indexOf(open, firstOpen + 1);
    } else {
      firstOpen = text.indexOf(open, consumedTo);
    }
  }

  return null;
}

/**
 * Convenience: extract and assert the result is a JSON object (not array, not primitive).
 * Returns `null` if extraction fails or the root is not an object.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const parsed = extractJson(text);
  // `typeof null === "object"` and `Array.isArray(null) === false`, so without
  // the explicit `!== null` check, a null root would slip through and get
  // cast to Record. The `!== null` form is also clearer about intent than
  // the previous truthy-check (`parsed &&`), since in JS every non-null
  // object is truthy by definition.
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}
