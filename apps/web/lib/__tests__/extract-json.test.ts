import { describe, it, expect } from "bun:test";
import { extractJson, extractJsonObject } from "@/lib/extract-json";

describe("extractJson — tier 1 (strict)", () => {
  it("parses a clean JSON object", () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("parses a clean JSON array", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns null for non-JSON input", () => {
    expect(extractJson("this is not json at all")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractJson('   {"a":1}\n')).toEqual({ a: 1 });
  });
});

describe("extractJson — tier 2 (fenced code block)", () => {
  it("strips a ```json fence and parses the inner content", () => {
    const input = "preface\n```json\n{\"a\":1}\n```\nepilogue";
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("strips a fence with no language hint", () => {
    const input = "```\n[1,2,3]\n```";
    expect(extractJson(input)).toEqual([1, 2, 3]);
  });

  it("falls through tier 2 when the fenced content is unparseable", () => {
    // No tier-1 hit (the whole input isn't JSON), tier 2 sees garbage,
    // tier 3 has no candidates — should return null.
    const input = "```json\nnot really json\n```";
    expect(extractJson(input)).toBeNull();
  });
});

describe("extractJson — tier 3 (balanced scan)", () => {
  it("recovers an unfenced object embedded in prose", () => {
    const input = 'Here is the response: {"purpose":"x","summary":"y"} hope that helps.';
    expect(extractJson(input)).toEqual({ purpose: "x", summary: "y" });
  });

  it("recovers an unfenced ARRAY embedded in prose", () => {
    // The regression case: an unfenced array would have been dropped
    // by an object-first scan, since the first `{` matches the inner
    // object and returns it standalone.
    const input = 'Findings: [{"sev":"high"},{"sev":"low"}] — over.';
    expect(extractJson(input)).toEqual([{ sev: "high" }, { sev: "low" }]);
  });

  it("ignores braces inside string literals", () => {
    const input = 'noise {"msg":"has } in it","count":2} tail';
    expect(extractJson(input)).toEqual({ msg: "has } in it", count: 2 });
  });

  it("handles escaped quotes inside string literals", () => {
    const input = 'lead {"k":"he said \\"hi\\""} tail';
    expect(extractJson(input)).toEqual({ k: 'he said "hi"' });
  });

  it("skips a malformed first object and recovers the second", () => {
    // First candidate parses to a balanced block but its content is
    // invalid JSON; we should advance past it and try the next `{`.
    const input = "leading {bad json here} ok {\"a\":1}";
    expect(extractJson(input)).toEqual({ a: 1 });
  });

  it("returns null when no candidate parses", () => {
    expect(extractJson("definitely not json {nope nope}")).toBeNull();
  });

  it("recovers a valid candidate after an unterminated string desyncs an earlier one", () => {
    // A lone `"` inside the first candidate flips inString=true and is never
    // toggled back, so the matching close-brace is treated as in-string and
    // the candidate never balances. Scanner must advance to a later open
    // delimiter rather than bailing entirely.
    const input = 'first {"a": "unterminated string here ok ok ok    later {"b":1}';
    expect(extractJson(input)).toEqual({ b: 1 });
  });
});

describe("extractJsonObject", () => {
  it("returns the object when the root is an object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null when the root is an array", () => {
    expect(extractJsonObject('[{"a":1}]')).toBeNull();
  });

  it("returns null when the root is a primitive", () => {
    expect(extractJsonObject('"just a string"')).toBeNull();
    expect(extractJsonObject("42")).toBeNull();
    expect(extractJsonObject("true")).toBeNull();
  });

  it("returns null when extraction fails", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("recovers an object embedded in prose", () => {
    expect(extractJsonObject('reply: {"purpose":"x"}')).toEqual({ purpose: "x" });
  });
});
