import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const SITE_URL = "https://octopus-review.ai";

// Emit lastmod as a W3C date (YYYY-MM-DD). Passing a Date makes Next serialize
// it via toISOString() with sub-second precision (…T14:23:52.518Z), which
// Google Search Console flags as an invalid lastmod. A date-only string is
// emitted verbatim.
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Static marketing/docs pages: we don't track a per-page modification date, so
// we intentionally omit lastmod rather than stamp the request time — an
// always-"now" lastmod is not verifiably accurate and Google warns on it.
const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
  { url: `${SITE_URL}/blog`, changeFrequency: "daily", priority: 0.9 },
  { url: `${SITE_URL}/not-a-rabbit`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/compare`, changeFrequency: "weekly", priority: 0.8 },
  { url: `${SITE_URL}/vs-coderabbit`, changeFrequency: "weekly", priority: 0.8 },
  { url: `${SITE_URL}/vs-greptile`, changeFrequency: "weekly", priority: 0.8 },
  { url: `${SITE_URL}/brand`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${SITE_URL}/bug-bounty`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/docs/about`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/docs/getting-started`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/docs/pricing`, changeFrequency: "weekly", priority: 0.9 },
  { url: `${SITE_URL}/docs/faq`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/github-action`, changeFrequency: "monthly", priority: 0.9 },
  { url: `${SITE_URL}/docs/integrations`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/docs/cli`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/cli/claude-code-integration`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/self-hosting`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/skills`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/glossary`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/docs/octopusignore`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${SITE_URL}/docs/privacy`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/terms`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/cookies`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/github-app`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/oauth-setup`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/security`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/security-overview`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/docs/data-retention`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/dpa`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/sub-processors`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${SITE_URL}/docs/changelog`, changeFrequency: "weekly", priority: 0.6 },
  { url: `${SITE_URL}/status`, changeFrequency: "weekly", priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch all published blog posts from database.
  // Wrapped in try/catch because DB may not be available during build.
  let blogPages: MetadataRoute.Sitemap = [];
  try {
    const blogPosts = await prisma.blogPost.findMany({
      where: { status: "published", deletedAt: null },
      select: { slug: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
    });

    blogPages = blogPosts.map((post) => {
      const modified = post.updatedAt ?? post.publishedAt;
      return {
        url: `${SITE_URL}/blog/${post.slug}`,
        // Real, verifiable modification date, date-only (no sub-second precision).
        ...(modified ? { lastModified: ymd(modified) } : {}),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      };
    });
  } catch {
    // DB unavailable during build — blog posts will be included at runtime.
  }

  return [...STATIC_PAGES, ...blogPages];
}
