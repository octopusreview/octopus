import GithubSlugger from "github-slugger";

export type TocHeading = { depth: 2 | 3; text: string; id: string };

const WORDS_PER_MINUTE = 200;

/**
 * Word count of PROSE only — fenced/inline code, image markup and Markdown
 * punctuation are stripped so counts reflect readable text (not syntax).
 * Used for both the displayed read time and the JSON-LD wordCount so the two
 * published metrics agree.
 */
export function proseWordCount(markdown: string): number {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code (backtick)
    .replace(/~~~[\s\S]*?~~~/g, " ") // fenced code (tilde)
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → keep text
    .replace(/[#>*_~`|-]/g, " "); // residual md punctuation
  return prose.split(/\s+/).filter(Boolean).length;
}

/** Estimate reading time in whole minutes (min 1) from raw Markdown. */
export function readingTimeMinutes(markdown: string): number {
  return Math.max(1, Math.round(proseWordCount(markdown) / WORDS_PER_MINUTE));
}

/**
 * Extract `##`/`###` headings for a table of contents. Fenced code is tracked
 * per CommonMark — a fence closes only on a line of the SAME marker character
 * at least as long as the opener (and nothing else) — so `##` lines inside
 * nested or mixed (``` vs ~~~) code fences are ignored rather than emitted as
 * dead TOC links. Ids use `github-slugger` so they match the ids `rehype-slug`
 * assigns to the rendered headings (including duplicate `-1`/`-2` suffixes,
 * since both walk the document in order).
 */
export function extractHeadings(markdown: string): TocHeading[] {
  const slugger = new GithubSlugger();
  const headings: TocHeading[] = [];
  let fence: { char: string; len: number } | null = null;

  for (const raw of markdown.split("\n")) {
    const opener = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (opener) {
      const marker = opener[1];
      const char = marker[0];
      const len = marker.length;
      if (fence) {
        // Close only on the same marker char, >= opening length, marker-only line.
        if (char === fence.char && len >= fence.len && /^\s*[`~]+\s*$/.test(raw)) {
          fence = null;
        }
      } else {
        fence = { char, len };
      }
      continue;
    }
    if (fence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!match) continue;

    const depth = match[1].length as 2 | 3;
    const text = match[2]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (!text) continue;

    headings.push({ depth, text, id: slugger.slug(text) });
  }

  return headings;
}
