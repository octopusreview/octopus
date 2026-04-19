export type DiagramType = "flowchart" | "sequence" | "er" | "state";

const SEQUENCE_RESERVED_KEYWORDS = new Set([
  "participant",
  "actor",
  "note",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "rect",
  "activate",
  "deactivate",
  "autonumber",
  "end",
  "link",
  "links",
  "properties",
  "details",
  "destroy",
  "create",
  "box",
  "break",
  "critical",
  "over",
  "right",
  "left",
  "of",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

  // 2. Inside node labels: replace backticks, escaped quotes, and semicolons.
  //    Backticks trigger markdown mode; escaped quotes (\\") break label delimiters;
  //    semicolons are statement separators in Mermaid and break the parser when
  //    they appear inside node labels.
  //    Scoped to label boundaries to avoid mutating comments or other constructs.
  result = result.replace(
    /([\[({]["'])((?:[^"'\\]|\\.)*)(['"][\])}])/g,
    (_match, open: string, content: string, close: string) => {
      const fixed = content
        .replace(/`/g, "'")
        .replace(/\\"/g, "'")
        .replace(/;/g, ",");
      return `${open}${fixed}${close}`;
    },
  );

  // 2b. Catch semicolons in unquoted bracket-enclosed labels too.
  //     e.g. A[primary language; if mixed] → A[primary language, if mixed]
  //     Only replace semicolons inside [...], (...), {...} that weren't caught above.
  //     Uses a permissive content match (no quote delimiters) so nested brackets
  //     and multiple semicolons are handled correctly.
  result = result.replace(
    /([\[({])([^"'\[\](){}]*;[^"'\[\](){}]*)([\])}])/g,
    (_match, open: string, content: string, close: string) => {
      return `${open}${content.replace(/;/g, ",")}${close}`;
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

  // 5. Sequence diagrams: rename participants whose IDs collide with Mermaid
  //    reserved keywords. Mermaid's sequence lexer matches these keywords
  //    case-insensitively, so a participant named `Loop` is tokenized as the
  //    `loop` block keyword and breaks every reference to it.
  if (/^\s*sequenceDiagram/m.test(result)) {
    result = renameReservedParticipants(result);
  }

  // 6. Remove trailing whitespace
  result = result.replace(/[ \t]+$/gm, "");

  return result;
}

/**
 * Rename sequence-diagram participant IDs that collide with Mermaid reserved
 * keywords (case-insensitive). References are rewritten only in positions
 * where Mermaid expects a participant token (arrow lines before `:`,
 * activate/deactivate/destroy/create, note over/left of/right of), never in
 * message text, note bodies, comments, or alias display names.
 */
function renameReservedParticipants(code: string): string {
  const declRe = /^(\s*(?:participant|actor)\s+)([A-Za-z][A-Za-z0-9_]*)\b/gm;

  const existingIds = new Set<string>();
  for (const match of code.matchAll(declRe)) {
    existingIds.add(match[2]);
  }

  const renames = new Map<string, string>();
  let result = code.replace(declRe, (full, prefix: string, id: string) => {
    if (!SEQUENCE_RESERVED_KEYWORDS.has(id.toLowerCase())) return full;
    let safe = `${id}_`;
    while (existingIds.has(safe)) safe += "_";
    existingIds.add(safe);
    renames.set(id, safe);
    return `${prefix}${safe}`;
  });

  if (renames.size === 0) return result;

  const replaceInZone = (text: string): string => {
    let out = text;
    for (const [orig, safe] of renames) {
      out = out.replace(new RegExp(`\\b${escapeRegex(orig)}\\b`, "g"), safe);
    }
    return out;
  };

  const lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    // Participant declarations already handled; do not touch their alias text.
    if (/^(participant|actor)\s/i.test(trimmed)) continue;
    // For lines with a colon (arrow messages, note bodies), only the segment
    // before the first colon can contain participant references.
    const colonIdx = line.indexOf(":");
    if (colonIdx >= 0) {
      lines[i] = replaceInZone(line.slice(0, colonIdx)) + line.slice(colonIdx);
      continue;
    }
    // Lines without a colon: activate/deactivate/destroy/create + block
    // keywords (loop/alt/etc.). Safe to replace globally — message text
    // cannot appear on these lines.
    lines[i] = replaceInZone(line);
  }
  return lines.join("\n");
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
