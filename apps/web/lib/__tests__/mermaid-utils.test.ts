import { describe, it, expect } from "bun:test";
import {
  detectDiagramType,
  extractAllMermaidBlocks,
  extractMermaidCode,
  sanitizeMermaidCode,
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
