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

  it("replaces EVERY occurrence of a repeated placeholder", () => {
    const out = substitutePromptVars("{{X}} and {{X}} again", { X: "Y" });
    expect(out).toBe("Y and Y again");
  });

  it("leaves placeholders for unprovided vars intact", () => {
    expect(substitutePromptVars("got={{A}} missing={{B}}", { A: "ok" })).toBe(
      "got=ok missing={{B}}",
    );
  });

  it("treats $& in the replacement literally (the original bug)", () => {
    // String.replace(string, string) expands $& to the matched text. Function
    // form keeps it literal — the value is passed through unchanged.
    const out = substitutePromptVars("code: {{CODE}}", { CODE: "if ($& > 0)" });
    expect(out).toBe("code: if ($& > 0)");
  });

  it("treats $`, $', $1, $<name> in replacement literally", () => {
    const out = substitutePromptVars("v={{V}}", {
      V: "before:$` after:$' group:$1 named:$<x>",
    });
    expect(out).toBe("v=before:$` after:$' group:$1 named:$<x>");
  });

  it("does not treat regex specials in the value as regex", () => {
    const out = substitutePromptVars("re: {{R}}", { R: ".*[a-z]+(foo)?" });
    expect(out).toBe("re: .*[a-z]+(foo)?");
  });

  it("handles empty replacement values", () => {
    expect(substitutePromptVars("[{{X}}]", { X: "" })).toBe("[]");
  });

  it("returns the template unchanged when vars is empty", () => {
    expect(substitutePromptVars("hello {{NAME}}", {})).toBe("hello {{NAME}}");
  });

  it("single-pass: a value containing another placeholder is NOT re-expanded", () => {
    // The whole point of the rewrite. With sequential per-key replace, the
    // {{Y}} byte sequence injected by replacing {{X}} would be picked up on
    // the next iteration and replaced with "second". Single-pass preserves
    // it. This protects against repo content / user instructions that
    // happen to contain `{{PROVIDER}}`-shaped strings being expanded as if
    // the prompt author had written them.
    const out = substitutePromptVars("{{X}} {{Y}}", { X: "{{Y}}", Y: "second" });
    expect(out).toBe("{{Y}} second");
  });

  it("single-pass: untrusted content can't inject a `{{TEMPLATE}}` lookalike", () => {
    // Realistic shape — USER_INSTRUCTION from an @octopus mention containing
    // a literal `{{CODEBASE_CONTEXT}}` byte sequence must NOT get expanded
    // with the actual codebase context.
    const out = substitutePromptVars(
      "instr={{USER_INSTRUCTION}}\ncode={{CODEBASE_CONTEXT}}",
      {
        USER_INSTRUCTION: "please review {{CODEBASE_CONTEXT}}",
        CODEBASE_CONTEXT: "<<<actual repo code>>>",
      },
    );
    expect(out).toBe(
      "instr=please review {{CODEBASE_CONTEXT}}\ncode=<<<actual repo code>>>",
    );
  });

  it("longer placeholder names match before shorter prefixes", () => {
    // Without the length-desc sort, `{{USER_ID}}` could match `USER` first
    // and leave `_ID}}` dangling. The sort guarantees longest-wins behaviour.
    const out = substitutePromptVars("u={{USER}} id={{USER_ID}}", {
      USER: "alice",
      USER_ID: "u_42",
    });
    expect(out).toBe("u=alice id=u_42");
  });

  it("is safe on placeholder names with special regex chars (defensive)", () => {
    const out = substitutePromptVars("dot {{A.B}} done", { "A.B": "ok" });
    expect(out).toBe("dot ok done");
  });
});
