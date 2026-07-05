import GithubSlugger from "github-slugger";

export type TocHeading = { depth: 2 | 3; text: string; id: string };

const WORDS_PER_MINUTE = 200;

/**
 * Estimate reading time (in whole minutes, min 1) from raw GitHub-flavored
 * Markdown. Code fences, inline code, image markup, and Markdown punctuation
 * are stripped so the word count reflects prose, not syntax.
 */
export function readingTimeMinutes(markdown: string): number {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → keep text
    .replace(/[#>*_~`|-]/g, " "); // residual md punctuation
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Extract the `##`/`###` headings from raw Markdown for a table of contents.
 * Uses `github-slugger` so the generated ids match what `rehype-slug` assigns
 * to the rendered headings (including duplicate-heading `-1`/`-2` suffixes,
 * since both walk the document in order). Headings inside fenced code are
 * ignored.
 */
export function extractHeadings(markdown: string): TocHeading[] {
  const slugger = new GithubSlugger();
  const headings: TocHeading[] = [];
  let inFence = false;

  for (const raw of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!match) continue;

    const depth = match[1].length as 2 | 3;
    // Strip inline Markdown so the visible text (and slug) match the render.
    const text = match[2]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (!text) continue;

    headings.push({ depth, text, id: slugger.slug(text) });
  }

  return headings;
}
