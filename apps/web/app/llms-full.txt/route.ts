import { docsContent } from "@/lib/docs-content";

// llms-full.txt (llmstxt.org): the full-detail companion to /llms.txt.
// Generated from the same plain-text corpus that feeds Ask Octopus, so it
// cannot drift from the docs the way a hand-maintained copy would.
export const revalidate = 86400;

export function renderLlmsFull(): string {
  const parts: string[] = [
    "# Octopus — full documentation text",
    "",
    "> AI code review for pull requests on GitHub, GitLab and Bitbucket, with full-repository context. Cloud service at https://octopus-review.ai; self-hosting optional. Short index: https://octopus-review.ai/llms.txt",
    "",
  ];
  for (const doc of docsContent) {
    parts.push(`## ${doc.title}`, "");
    for (const section of doc.sections) {
      parts.push(`### ${section.heading}`, "", section.text.trim(), "");
    }
  }
  return parts.join("\n");
}

export async function GET() {
  return new Response(renderLlmsFull(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
