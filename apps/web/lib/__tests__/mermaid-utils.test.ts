import { describe, it, expect } from "bun:test";
import {
  detectDiagramType,
  extractAllMermaidBlocks,
  extractMermaidCode,
  sanitizeMermaidCode,
  sanitizeMermaidInMarkdown,
  extractNodeLabels,
} from "@/lib/mermaid-utils";

describe("detectDiagramType", () => {
  it("detects flowchart as default", () => {
    expect(detectDiagramType("graph TD\n  A --> B")).toBe("flowchart");
  });

  it("detects flowchart for 'flowchart' keyword", () => {
    expect(detectDiagramType("flowchart LR\n  A --> B")).toBe("flowchart");
  });

  it("detects sequence diagram", () => {
    expect(detectDiagramType("sequenceDiagram\n  Alice->>Bob: Hello")).toBe("sequence");
  });

  it("detects ER diagram", () => {
    expect(detectDiagramType("erDiagram\n  CUSTOMER ||--o{ ORDER : places")).toBe("er");
  });

  it("detects state diagram", () => {
    expect(detectDiagramType("stateDiagram-v2\n  [*] --> Active")).toBe("state");
  });

  it("is case-insensitive", () => {
    expect(detectDiagramType("SEQUENCEDIAGRAM\n  A->>B: msg")).toBe("sequence");
    expect(detectDiagramType("ErDiagram\n  A ||--o{ B : rel")).toBe("er");
  });

  it("handles leading whitespace", () => {
    expect(detectDiagramType("  sequenceDiagram\n  Alice->>Bob: Hi")).toBe("sequence");
  });

  it("defaults to flowchart for unknown types", () => {
    expect(detectDiagramType("pie\n  title Pets\n  \"Dogs\" : 386")).toBe("flowchart");
  });
});

describe("extractAllMermaidBlocks", () => {
  it("returns empty array for null/undefined", () => {
    expect(extractAllMermaidBlocks(null)).toEqual([]);
    expect(extractAllMermaidBlocks(undefined)).toEqual([]);
    expect(extractAllMermaidBlocks("")).toEqual([]);
  });

  it("extracts single mermaid block", () => {
    const text = "Some text\n```mermaid\ngraph TD\n  A --> B\n```\nMore text";
    const blocks = extractAllMermaidBlocks(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("flowchart");
    expect(blocks[0].code).toContain("A --> B");
  });

  it("extracts multiple mermaid blocks", () => {
    const text = `
Here is a flowchart:
\`\`\`mermaid
graph TD
  A --> B
\`\`\`

And a sequence diagram:
\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello
\`\`\`
    `;
    const blocks = extractAllMermaidBlocks(text);
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("flowchart");
    expect(blocks[1].type).toBe("sequence");
  });

  it("returns empty for text without mermaid blocks", () => {
    const text = "Just regular text\n```typescript\nconst x = 1;\n```";
    expect(extractAllMermaidBlocks(text)).toEqual([]);
  });

  it("sanitizes extracted code", () => {
    const text = "```mermaid\ngraph TD\n  A[\"Hello\\nWorld\"] --> B\n```";
    const blocks = extractAllMermaidBlocks(text);
    expect(blocks[0].code).toContain("<br/>");
    expect(blocks[0].code).not.toContain("\\n");
  });

  it("skips empty mermaid blocks", () => {
    const text = "```mermaid\n\n```\n\n```mermaid\ngraph TD\n  A --> B\n```";
    const blocks = extractAllMermaidBlocks(text);
    expect(blocks.length).toBe(1);
  });
});

describe("extractMermaidCode", () => {
  it("returns null for null/undefined/empty", () => {
    expect(extractMermaidCode(null)).toBeNull();
    expect(extractMermaidCode(undefined)).toBeNull();
    expect(extractMermaidCode("")).toBeNull();
  });

  it("extracts first mermaid block only", () => {
    const text = `
\`\`\`mermaid
graph TD
  A --> B
\`\`\`

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hi
\`\`\`
    `;
    const code = extractMermaidCode(text);
    expect(code).toContain("graph TD");
    expect(code).not.toContain("sequenceDiagram");
  });

  it("returns null when no mermaid block exists", () => {
    expect(extractMermaidCode("just some text")).toBeNull();
    expect(extractMermaidCode("```js\nconst x = 1;\n```")).toBeNull();
  });
});

describe("sanitizeMermaidCode", () => {
  it("replaces escaped quotes with single quotes in double-quoted labels", () => {
    const result = sanitizeMermaidCode('FormInput["Form Input (empty string \\"\\")"]');
    expect(result).toBe("FormInput[\"Form Input (empty string '')\"]");
    expect(result).not.toContain('\\"');
  });

  it("does not replace escaped quotes outside node labels", () => {
    const result = sanitizeMermaidCode('%% Author: \\"Alice\\"');
    expect(result).toBe('%% Author: \\"Alice\\"');
  });

  it("replaces literal \\n with <br/>", () => {
    const result = sanitizeMermaidCode('A["Hello\\nWorld"]');
    expect(result).toBe('A["Hello<br/>World"]');
  });

  it("replaces multiple \\n occurrences", () => {
    const result = sanitizeMermaidCode('A["Line1\\nLine2\\nLine3"]');
    expect(result).toBe('A["Line1<br/>Line2<br/>Line3"]');
  });

  it("removes backticks inside node labels", () => {
    const result = sanitizeMermaidCode('A["Use `fetchData` here"]');
    expect(result).not.toContain("`");
    expect(result).toContain("'fetchData'");
  });

  it("splits multiple class statements on same line", () => {
    const result = sanitizeMermaidCode("    class A,B changed class C,D added");
    expect(result).toContain("class A,B changed");
    expect(result).toContain("class C,D added");
    // Should be on separate lines
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
  });

  it("removes trailing whitespace", () => {
    const result = sanitizeMermaidCode("graph TD  \n  A --> B   \n  B --> C");
    const lines = result.split("\n");
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("preserves valid mermaid code unchanged", () => {
    const code = "graph TD\n  A --> B\n  B --> C";
    expect(sanitizeMermaidCode(code)).toBe(code);
  });

  it("strips colons and parentheses from state diagram note text", () => {
    const code = 'stateDiagram-v2\n    [*] --> stale\n    note right of stale: Badge: yellow Stale (NEW)';
    const result = sanitizeMermaidCode(code);
    expect(result).not.toContain("(NEW)");
    expect(result).toContain("note right of stale:");
    expect(result).toContain("Badge - yellow Stale NEW");
  });

  it("strips colons from note text with quoted state IDs", () => {
    const code = 'stateDiagram-v2\n    note left of "My State": Info: details (extra)';
    const result = sanitizeMermaidCode(code);
    expect(result).toContain('note left of "My State":');
    expect(result).not.toContain("(extra)");
    expect(result).toContain("Info - details extra");
  });

  it("strips parentheses from state descriptions", () => {
    const code = "stateDiagram-v2\n    stale: Stale (needs reindex)";
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("stale: Stale needs reindex");
    expect(result).not.toContain("(");
  });

  it("does not modify transitions in state diagrams", () => {
    const code = "stateDiagram-v2\n    pending --> reviewing: Review starts";
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("pending --> reviewing: Review starts");
  });

  it("does not modify non-state diagrams", () => {
    const code = "graph TD\n    A[\"Note: important (yes)\"] --> B";
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("(yes)");
  });

  it("renames sequence participants that collide with reserved keywords", () => {
    const code = [
      "sequenceDiagram",
      "    participant User",
      "    participant CLI as ask.ts",
      "    participant Loop as runAsk()",
      "    User->>CLI: run",
      "    CLI->>Loop: runAsk(opts)",
      "    Loop-->>CLI: done",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant Loop_ as runAsk()");
    expect(result).toContain("CLI->>Loop_: runAsk(opts)");
    expect(result).toContain("Loop_-->>CLI: done");
    expect(result).not.toMatch(/->>Loop:/);
  });

  it("renames reserved-keyword participants declared with actor", () => {
    const code = [
      "sequenceDiagram",
      "    actor Note",
      "    participant Svc",
      "    Note->>Svc: ping",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("actor Note_");
    expect(result).toContain("Note_->>Svc: ping");
  });

  it("leaves non-reserved participant IDs unchanged", () => {
    const code = [
      "sequenceDiagram",
      "    participant Runner as runAsk()",
      "    participant Svc",
      "    Runner->>Svc: call",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant Runner as runAsk()");
    expect(result).toContain("Runner->>Svc: call");
    expect(result).not.toContain("Runner_");
  });

  it("does not mutate message text that happens to contain a reserved-id word", () => {
    const code = [
      "sequenceDiagram",
      "    participant End",
      "    participant Svc",
      "    Svc->>End: End-to-end encryption enabled",
      "    End-->>Svc: loop finished end of run",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant End_");
    expect(result).toContain("Svc->>End_: End-to-end encryption enabled");
    expect(result).toContain("End_-->>Svc: loop finished end of run");
    expect(result).not.toContain("End_-to-end");
    expect(result).not.toContain("End_ of run");
  });

  it("preserves `as` alias display text when renaming the ID", () => {
    const code = [
      "sequenceDiagram",
      "    participant End as End Point Service",
      "    participant Svc",
      "    End->>Svc: ping",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant End_ as End Point Service");
    expect(result).toContain("End_->>Svc: ping");
    expect(result).not.toContain("End_ Point Service");
  });

  it("rewrites activate/deactivate/destroy and note references", () => {
    const code = [
      "sequenceDiagram",
      "    participant Loop",
      "    participant Svc",
      "    activate Loop",
      "    note over Loop,Svc: context",
      "    note right of Loop: detail",
      "    deactivate Loop",
      "    destroy Loop",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("activate Loop_");
    expect(result).toContain("note over Loop_,Svc: context");
    expect(result).toContain("note right of Loop_: detail");
    expect(result).toContain("deactivate Loop_");
    expect(result).toContain("destroy Loop_");
  });

  it("does not touch comments or note body text", () => {
    const code = [
      "sequenceDiagram",
      "    participant End",
      "    participant Svc",
      "    %% End-of-life handling",
      "    note over End,Svc: End-of-transaction marker",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("%% End-of-life handling");
    expect(result).toContain("note over End_,Svc: End-of-transaction marker");
  });

  it("picks a non-colliding suffix when the `_` name is already taken", () => {
    const code = [
      "sequenceDiagram",
      "    participant Loop",
      "    participant Loop_",
      "    Loop->>Loop_: call",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant Loop__");
    expect(result).toContain("participant Loop_");
    expect(result).toContain("Loop__->>Loop_: call");
  });

  it("leaves alias text untouched when the ID is not reserved", () => {
    const code = [
      "sequenceDiagram",
      "    participant Runner as runAsk() tool loop",
      "    participant Svc",
      "    Runner->>Svc: call",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("participant Runner as runAsk() tool loop");
  });

  it("drops duplicate deactivate across alt/else branches", () => {
    const code = [
      "sequenceDiagram",
      "    participant Preview",
      "    participant MSSQL",
      "    Preview->>MSSQL: connect",
      "    activate MSSQL",
      "    alt Query succeeds",
      "        MSSQL-->>Preview: rows",
      "        deactivate MSSQL",
      "    else Query fails",
      "        MSSQL-->>Preview: error",
      "        deactivate MSSQL",
      "    end",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    const deactivateCount = (result.match(/deactivate MSSQL/g) ?? []).length;
    expect(deactivateCount).toBe(1);
    expect(result).toContain("activate MSSQL");
  });

  it("keeps balanced activate/deactivate pairs within a single branch", () => {
    const code = [
      "sequenceDiagram",
      "    participant A",
      "    participant B",
      "    A->>B: call",
      "    activate B",
      "    B-->>A: reply",
      "    deactivate B",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("activate B");
    expect(result).toContain("deactivate B");
  });

  it("drops a stray deactivate with no prior activate", () => {
    const code = [
      "sequenceDiagram",
      "    participant A",
      "    participant B",
      "    A->>B: call",
      "    deactivate B",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).not.toContain("deactivate B");
  });

  it("appends trailing deactivate for unmatched activate", () => {
    const code = [
      "sequenceDiagram",
      "    participant A",
      "    participant B",
      "    A->>B: call",
      "    activate B",
      "    B-->>A: reply",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    const lines = result.split("\n");
    expect(lines[lines.length - 1].trim()).toBe("deactivate B");
  });

  it("tracks nested activations per participant", () => {
    const code = [
      "sequenceDiagram",
      "    participant A",
      "    participant B",
      "    activate B",
      "    activate B",
      "    deactivate B",
      "    deactivate B",
      "    deactivate B",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    const deactivateCount = (result.match(/deactivate B/g) ?? []).length;
    expect(deactivateCount).toBe(2);
  });

  it("does not rebalance non-sequence diagrams", () => {
    const code = [
      "graph TD",
      "    A --> B",
      "    deactivate C",
    ].join("\n");
    const result = sanitizeMermaidCode(code);
    expect(result).toContain("deactivate C");
  });
});

describe("extractNodeLabels", () => {
  it("extracts quoted string labels", () => {
    const code = 'A["Login Component"] --> B["Auth Service"]';
    const labels = extractNodeLabels(code);
    expect(labels).toContain("Login Component");
    expect(labels).toContain("Auth Service");
  });

  it("extracts bracket-enclosed labels", () => {
    const code = "A[Login] --> B(Process) --> C{Decision}";
    const labels = extractNodeLabels(code);
    expect(labels).toContain("Login");
    expect(labels).toContain("Process");
    expect(labels).toContain("Decision");
  });

  it("returns empty array for code without labels", () => {
    const code = "A --> B --> C";
    const labels = extractNodeLabels(code);
    expect(labels).toEqual([]);
  });

  it("filters out arrow-like strings", () => {
    const code = 'A["Real Label"] --> B';
    const labels = extractNodeLabels(code);
    expect(labels).not.toContain("-->");
    expect(labels).not.toContain("->");
  });

  it("deduplicates labels", () => {
    const code = 'A["Shared"] --> B["Shared"] --> C["Unique"]';
    const labels = extractNodeLabels(code);
    const sharedCount = labels.filter((l) => l === "Shared").length;
    expect(sharedCount).toBe(1);
  });

  it("filters out single-character labels", () => {
    const code = "A[x] --> B[Login Page]";
    const labels = extractNodeLabels(code);
    expect(labels).not.toContain("x");
    expect(labels).toContain("Login Page");
  });
});

describe("sanitizeMermaidInMarkdown", () => {
  it("balances activate/deactivate inside ```mermaid blocks in markdown", () => {
    const body = `## Review

Some text.

\`\`\`mermaid
sequenceDiagram
    participant A
    activate A
    alt branch 1
        deactivate A
    else branch 2
        deactivate A
    end
\`\`\`

More text.`;
    const result = sanitizeMermaidInMarkdown(body);
    // First deactivate kept (depth 1→0); second dropped (would underflow)
    const matches = result.match(/deactivate A/g) ?? [];
    expect(matches.length).toBe(1);
    // Surrounding markdown intact
    expect(result).toContain("## Review");
    expect(result).toContain("More text.");
  });

  it("handles multiple mermaid blocks", () => {
    const body = `\`\`\`mermaid
graph TD
    A["Use \`fn\` here"]
\`\`\`

text

\`\`\`mermaid
sequenceDiagram
    participant Loop
\`\`\``;
    const result = sanitizeMermaidInMarkdown(body);
    // Block 1: backticks in label replaced with single quotes
    expect(result).toContain("A[\"Use 'fn' here\"]");
    // Block 2: reserved keyword 'Loop' renamed
    expect(result).not.toMatch(/^\s*participant Loop\s*$/m);
    expect(result).toMatch(/participant Loop_/);
  });

  it("leaves non-mermaid code blocks untouched", () => {
    const body = "```ts\nactivate Foo\ndeactivate Foo\ndeactivate Foo\n```";
    expect(sanitizeMermaidInMarkdown(body)).toBe(body);
  });

  it("returns input unchanged when there are no mermaid blocks", () => {
    const body = "Just plain markdown with **bold** and `code`.";
    expect(sanitizeMermaidInMarkdown(body)).toBe(body);
  });
});
