export type DiagramType = "flowchart" | "sequence" | "er" | "state";

export interface MermaidBlock {
  code: string;
  type: DiagramType;
}

export const DIAGRAM_TYPE_LABELS: Record<DiagramType, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence",
  er: "ER Diagram",
  state: "State",
};

/**
 * Detect diagram type from the first meaningful line of mermaid code.
 */
export function detectDiagramType(code: string): DiagramType {
  const firstLine = code.trimStart().split("\n")[0].trim().toLowerCase();
  if (firstLine.startsWith("sequencediagram")) return "sequence";
  if (firstLine.startsWith("erdiagram")) return "er";
  if (firstLine.startsWith("statediagram")) return "state";
  return "flowchart";
}

/**
 * Extract ALL mermaid code blocks from a text string with type detection.
 */
export function extractAllMermaidBlocks(text: string | null | undefined): MermaidBlock[] {
  if (!text) return [];
  const blocks: MermaidBlock[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code) {
      blocks.push({ code: sanitizeMermaidCode(code), type: detectDiagramType(code) });
    }
  }
  return blocks;
}

/**
 * Extract the first mermaid code block from a text string (backward compat).
 * Returns the raw mermaid code (without the fences) or null if not found.
 */
export function extractMermaidCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/```mermaid\n([\s\S]*?)```/);
  return match ? sanitizeMermaidCode(match[1].trim()) : null;
}

/**
 * Sanitize LLM-generated mermaid code to fix common syntax issues.
 *
 * Fixes applied:
 * 1. Replace literal `\n` with `<br/>` (mermaid line break) — LLMs output \n
 *    inside node labels intending a line break, but mermaid renders it literally
 * 2. Inside node labels: replace backticks and escaped quotes with single quotes
 *    (backticks trigger markdown mode; escaped quotes break label delimiters)
 * 3. Ensure `class` statements are each on their own line
 * 4. Remove trailing whitespace on lines
 */
export function sanitizeMermaidCode(code: string): string {
  let result = code;

  // 1. Replace literal \n with <br/> (mermaid line break).
  //    Literal \n in mermaid code only appears inside node labels where the LLM
  //    intended a line break. It's not valid mermaid syntax anywhere else.
  result = result.replace(/\\n/g, "<br/>");

  // 2. Inside node labels: replace backticks and escaped quotes with single quotes.
  //    Backticks trigger markdown mode; escaped quotes (\\") break label delimiters.
  //    Scoped to label boundaries to avoid mutating comments or other constructs.
  result = result.replace(
    /([\[({]["'])((?:[^"'\\]|\\.)*)(['"][\])}])/g,
    (_match, open: string, content: string, close: string) => {
      const fixed = content.replace(/`/g, "'").replace(/\\"/g, "'");
      return `${open}${fixed}${close}`;
    },
  );

  // 3. Split multiple class statements crammed onto one line
  //    e.g. "class A,B changed class C,D added" → separate lines
  result = result.replace(
    /^(\s*class\s+\S+\s+\w+)\s+(class\s+)/gm,
    "$1\n    $2",
  );

  // 4. State diagrams: sanitize note text and state descriptions that contain
  //    special characters (colons, parentheses) which break the Mermaid parser.
  //    e.g. "note right of stale: Badge: yellow Stale (NEW)" → fix colons and parens
  if (/^\s*stateDiagram/m.test(result)) {
    // Fix note lines: strip colons and parentheses from note body text.
    // Supports both plain IDs (stale) and quoted IDs ("My State").
    result = result.replace(
      /^(\s*note\s+(?:right|left)\s+of\s+(?:\w+|"[^"]*")\s*:\s*)(.+)$/gm,
      (_match, prefix: string, text: string) => {
        const cleaned = text.replace(/:/g, " -").replace(/[()]/g, "");
        return `${prefix}${cleaned}`;
      },
    );
    // Fix state descriptions: "stateId : Description with (parens)" → remove parens
    result = result.replace(
      /^(\s*\w+\s*:\s*)(.+)$/gm,
      (_match, prefix: string, text: string) => {
        // Only fix if it looks like a state description (not a transition)
        if (/-->/.test(prefix)) return _match;
        const cleaned = text.replace(/[()]/g, "");
        return `${prefix}${cleaned}`;
      },
    );
  }

  // 5. Remove trailing whitespace
  result = result.replace(/[ \t]+$/gm, "");

  return result;
}

/**
 * Extract human-readable node labels from mermaid code.
 * Looks for quoted strings and bracket-enclosed labels that contain
 * meaningful text for semantic search (e.g. "LoginComponent", "AuthService").
 */
export function extractNodeLabels(mermaidCode: string): string[] {
  const labels = new Set<string>();

  // Match quoted strings: "Label" or 'Label'
  for (const match of mermaidCode.matchAll(/["']([^"']+)["']/g)) {
    const label = match[1].trim();
    if (label.length > 1 && !/^[\s\->=|]+$/.test(label)) {
      labels.add(label);
    }
  }

  // Match bracket-enclosed labels: [Label], (Label), {Label}, ([Label])
  for (const match of mermaidCode.matchAll(/[\[({]([^\[\](){}|]+)[\])}]/g)) {
    const label = match[1].trim();
    if (label.length > 1 && !/^[\s\->=|]+$/.test(label) && !label.startsWith("```")) {
      labels.add(label);
    }
  }

  return Array.from(labels);
}
