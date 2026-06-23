const SITE_URL = "https://octopus-review.ai";
const FEED_TITLE = "Octopus Blog";
const FEED_DESCRIPTION =
  "Engineering insights, product updates, and lessons learned building AI-powered code review tools.";

export type RssFeedPost = {
  title: string;
  slug: string;
  excerpt: string | null;
  authorName: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildRssFeed(posts: RssFeedPost[]): string {
  const lastBuildDate = (posts[0]?.publishedAt ?? new Date()).toUTCString();

  const items = posts
    .map((post) => {
      const link = `${SITE_URL}/blog/${post.slug}`;
      const pubDate = (
        post.publishedAt ??
        post.updatedAt ??
        new Date()
      ).toUTCString();
      const description = post.excerpt ? escapeXml(post.excerpt) : "";
      const creator = post.authorName
        ? `\n      <dc:creator>${escapeXml(post.authorName)}</dc:creator>`
        : "";
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>${creator}
      <description>${description}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE_URL}/blog</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}
