import { describe, it, expect } from "bun:test";
import { buildRssFeed, escapeXml, type RssFeedPost } from "../blog-rss";

const basePost: RssFeedPost = {
  title: "Hello World",
  slug: "hello-world",
  excerpt: "A first post",
  authorName: "Ada Lovelace",
  publishedAt: new Date("2026-06-10T12:00:00Z"),
  updatedAt: new Date("2026-06-11T12:00:00Z"),
};

describe("escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildRssFeed", () => {
  it("produces a well-formed RSS 2.0 document with a self link", () => {
    const xml = buildRssFeed([basePost]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(
      '<atom:link href="https://octopus-review.ai/blog/feed.xml" rel="self"',
    );
  });

  it("escapes special characters in title and excerpt", () => {
    const xml = buildRssFeed([
      {
        ...basePost,
        title: `Why "AI" review & <you> matter`,
        excerpt: `Tom & Jerry's <script> take`,
      },
    ]);
    expect(xml).toContain("Why &quot;AI&quot; review &amp; &lt;you&gt; matter");
    expect(xml).toContain("&lt;script&gt;");
    expect(/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)).toBe(false);
  });

  it("emits a permalink guid and RFC-822 pubDate", () => {
    const xml = buildRssFeed([basePost]);
    expect(xml).toContain(
      '<guid isPermaLink="true">https://octopus-review.ai/blog/hello-world</guid>',
    );
    expect(xml).toContain("<pubDate>Wed, 10 Jun 2026 12:00:00 GMT</pubDate>");
  });

  it("omits dc:creator when authorName is null", () => {
    const xml = buildRssFeed([{ ...basePost, authorName: null }]);
    expect(xml).not.toContain("<dc:creator>");
  });

  it("falls back to updatedAt when publishedAt is null", () => {
    const xml = buildRssFeed([
      {
        ...basePost,
        publishedAt: null,
        updatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    ]);
    expect(xml).toContain("<pubDate>Fri, 01 May 2026 00:00:00 GMT</pubDate>");
  });

  it("renders an empty description for a null excerpt", () => {
    const xml = buildRssFeed([{ ...basePost, excerpt: null }]);
    expect(xml).toContain("<description></description>");
  });
});
