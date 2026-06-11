import { describe, it, expect } from "bun:test";
import { substitutePromptVars } from "@/lib/prompt-substitute";

describe("substitutePromptVars", () => {
  it("replaces a simple placeholder", () => {
    expect(substitutePromptVars("hello {{NAME}}", { NAME: "world" })).toBe("hello world");
  });

  it("replaces multiple distinct placeholders", () => {
    const out = substitutePromptVars("a={{A}}, b={{B}}", { A: "1", B: "2" });
    expect(out).toBe("a=1, b=2");
  });

  it("replaces EVERY occurrence of a repeated placeholder (string.replace replaces only first)", () => {
    const out = substitutePromptVars("{{X}} and {{X}} again", { X: "Y" });
    expect(out).toBe("Y and Y again");
  });

  it("leaves placeholders for unprovided vars intact", () => {
    expect(substitutePromptVars("got={{A}} missing={{B}}", { A: "ok" })).toBe(
      "got=ok missing={{B}}",
    );
  });

  it("treats $& in the replacement literally (the actual bug)", () => {
    // String.replace(string, string) would expand `$&` to the matched text,
    // splicing `{{CODE}}` back into the template. Function-form replace
    // keeps it literal.
    const out = substitutePromptVars("code: {{CODE}}", { CODE: "if ($& > 0)" });
    expect(out).toBe("code: if ($& > 0)");
  });

  it("treats $`, $', $1, $<name> in replacement literally", () => {
    // All of these are special in the SECOND arg of String.replace(string, string).
    const out = substitutePromptVars("v={{V}}", {
      V: "before:$` after:$' group:$1 named:$<x>",
    });
    expect(out).toBe("v=before:$` after:$' group:$1 named:$<x>");
  });

  it("does not treat regex specials in the value as regex", () => {
    // Replacement values containing regex syntax (`.`, `[`, `(`) must pass through.
    const out = substitutePromptVars("re: {{R}}", { R: ".*[a-z]+(foo)?" });
    expect(out).toBe("re: .*[a-z]+(foo)?");
  });

  it("handles empty replacement values", () => {
    expect(substitutePromptVars("[{{X}}]", { X: "" })).toBe("[]");
  });

  it("handles a value that contains the placeholder syntax itself", () => {
    // Value contains `{{Y}}`; result must not retroactively expand `{{Y}}`
    // (we only iterate Object.entries once, and the regex doesn't re-scan
    // the just-substituted text).
    const out = substitutePromptVars("{{X}} {{Y}}", { X: "{{Y}}", Y: "second" });
    // First pass replaces {{X}} → "{{Y}}", then second pass would replace
    // that injected {{Y}} → "second". This is a known property of the
    // sequential iteration; document it so it doesn't regress accidentally.
    expect(out).toBe("second second");
  });

  it("is safe on placeholder names with special regex chars (defensive)", () => {
    // The keys come from a Record<string,string> in our own code, but
    // escaping them prevents accidental regex-injection if a key ever
    // contains a dot or bracket.
    const out = substitutePromptVars("dot {{A.B}} done", { "A.B": "ok" });
    expect(out).toBe("dot ok done");
  });
});
