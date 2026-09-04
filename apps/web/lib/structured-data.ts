/**
 * Shared schema.org entities for the marketing site. One Organization entity
 * (with sameAs profiles) is emitted site-wide from the landing layout and
 * referenced by @id from page-level schemas, so search engines and LLM
 * crawlers resolve "Octopus" to one entity and its public profiles.
 */
export const SITE_URL = "https://octopus-review.ai";
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

export const SOCIAL_PROFILES = [
  "https://github.com/octopusreview",
  "https://x.com/octopus_review",
  "https://www.linkedin.com/company/octopus-review",
  "https://www.reddit.com/r/octopusreview/",
  "https://www.youtube.com/@OctopusReview",
  "https://bsky.app/profile/octopus-review.ai",
] as const;

export const AI_VENDORS_SENTENCE =
  "Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Alibaba Qwen, or any model on OpenRouter";

/** Organization without @context, for embedding as publisher/author. */
export const ORGANIZATION_ENTITY = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "Octopus",
  alternateName: "Octopus Review",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/logo.svg`,
  },
  description:
    "Octopus is an AI code review service that reviews every pull request on GitHub, GitLab and Bitbucket with full-repository context and posts severity-rated findings inline.",
  sameAs: [...SOCIAL_PROFILES],
} as const;

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  ...ORGANIZATION_ENTITY,
} as const;

/** JSON for a <script type="application/ld+json"> body; closes no script tag early. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script>/gi, "<\\/script>");
}
