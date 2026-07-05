import type { Metadata } from "next";
import Link from "@/components/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { IconChevronLeft, IconChevronRight, IconX } from "@tabler/icons-react";
import { BlogSearch } from "@/components/blog-search";
import { ScrollToTop } from "@/components/scroll-to-top";
import { unstable_cache } from "next/cache";

const POSTS_PER_PAGE = 10;

// Sidebar taxonomy (categories + tag cloud) is identical across every /blog
// request and changes only when posts change, so cache it (revalidated hourly)
// instead of scanning every published post on each request. A short window is
// fine for a blog sidebar; new posts show up within the hour.
const getBlogTaxonomy = unstable_cache(
  async () => {
    const where = { status: "published" as const, deletedAt: null };
    const [categoryGroups, tagRows] = await Promise.all([
      prisma.blogPost.groupBy({
        by: ["category"],
        where,
        _count: { _all: true },
      }),
      prisma.blogPost.findMany({ where, select: { tags: true } }),
    ]);

    const categories = categoryGroups
      .map((g) => ({ name: g.category, count: g._count._all }))
      .filter((c): c is { name: string; count: number } => c.name != null)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const tagFreq = new Map<string, number>();
    for (const row of tagRows) {
      for (const t of row.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    }
    const tagCloud = [...tagFreq.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return { categories, tagCloud };
  },
  ["blog-taxonomy"],
  { revalidate: 3600 },
);

export const metadata: Metadata = {
  title: "Blog — Octopus",
  description:
    "Engineering insights, product updates, and lessons learned building AI-powered code review tools.",
  alternates: {
    canonical: "https://octopus-review.ai/blog",
    types: {
      "application/rss+xml": [
        {
          url: "https://octopus-review.ai/blog/feed.xml",
          title: "Octopus Blog RSS Feed",
        },
      ],
    },
  },
};

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    category?: string;
    tag?: string;
  }>;
}) {
  const {
    page: pageParam,
    q: searchQuery,
    category: categoryParam,
    tag: tagParam,
  } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const query = searchQuery?.trim() || "";
  const category = categoryParam?.trim() || "";
  const tag = tagParam?.trim() || "";

  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  const isLoggedIn = !!session;

  // Base scope: every published, non-deleted post. The sidebar aggregations
  // use this so they always reflect the full corpus, not the active filter.
  const baseWhere = {
    status: "published" as const,
    deletedAt: null,
  };

  // Post-list scope: base scope narrowed by the active search / category / tag.
  const where = {
    ...baseWhere,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { excerpt: { contains: query, mode: "insensitive" as const } },
            { content: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(category ? { category } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
  };

  const [posts, totalCount] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * POSTS_PER_PAGE,
      take: POSTS_PER_PAGE,
      select: {
        title: true,
        slug: true,
        excerpt: true,
        coverImageUrl: true,
        publishedAt: true,
        authorName: true,
        readingTime: true,
      },
    }),
    prisma.blogPost.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

  const { categories, tagCloud } = await getBlogTaxonomy();
  const maxTagCount = tagCloud.length ? tagCloud[0].count : 0;
  const minTagCount = tagCloud.length ? tagCloud[tagCloud.length - 1].count : 0;

  const hasSidebar = categories.length > 0 || tagCloud.length > 0;

  // Build a /blog URL from an explicit final param set (page 1 omitted so the
  // canonical first page stays clean). Used by filter links + pagination so
  // the active params (q, category, tag) always carry over.
  const makeHref = (p: {
    q?: string;
    category?: string;
    tag?: string;
    page?: number;
  }) => {
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.category) sp.set("category", p.category);
    if (p.tag) sp.set("tag", p.tag);
    if (p.page && p.page > 1) sp.set("page", String(p.page));
    const s = sp.toString();
    return s ? `/blog?${s}` : "/blog";
  };

  // Tag-cloud visual weighting: 0 (least frequent) → 3 (most frequent).
  const tagWeight = (count: number) =>
    maxTagCount === minTagCount
      ? 2
      : Math.round(((count - minTagCount) / (maxTagCount - minTagCount)) * 3);
  const TAG_SIZE = ["text-xs", "text-xs", "text-sm", "text-sm"];
  const TAG_TONE = ["text-[#666]", "text-[#888]", "text-[#aaa]", "text-white"];

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <LandingDesktopNav isLoggedIn={isLoggedIn} />
      <LandingMobileNav isLoggedIn={isLoggedIn} />

      <main className="mx-auto max-w-6xl px-6 pt-32 pb-20">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
            <p className="mt-2 text-lg text-[#888]">
              Engineering insights, product updates, and lessons learned.
            </p>
          </div>
          <BlogSearch />
        </div>

        <div
          className={
            hasSidebar
              ? "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
              : ""
          }
        >
          {hasSidebar && (
            <aside className="mb-10 lg:mb-0 lg:sticky lg:top-28 lg:self-start">
              {categories.length > 0 && (
                <div>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
                    Categories
                  </h2>
                  <nav className="flex flex-col gap-1.5 text-sm">
                    <Link
                      href={makeHref({ q: query, tag })}
                      className={`transition-colors ${
                        category
                          ? "text-[#888] hover:text-white"
                          : "text-[#10D8BE]"
                      }`}
                    >
                      All posts
                    </Link>
                    {categories.map((c) => {
                      const active = c.name === category;
                      return (
                        <Link
                          key={c.name}
                          href={makeHref({ q: query, category: c.name, tag })}
                          className={`flex items-center justify-between gap-3 transition-colors ${
                            active
                              ? "text-[#10D8BE]"
                              : "text-[#888] hover:text-white"
                          }`}
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 text-[#555]">{c.count}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              )}

              {tagCloud.length > 0 && (
                <div className={categories.length > 0 ? "mt-8" : ""}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
                    Topics
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {tagCloud.map((t) => {
                      const active = t.name === tag;
                      const w = tagWeight(t.count);
                      return (
                        <Link
                          key={t.name}
                          href={makeHref({ q: query, category, tag: t.name })}
                          className={`rounded-full border px-2.5 py-1 leading-none transition-colors ${
                            TAG_SIZE[w]
                          } ${
                            active
                              ? "border-[#10D8BE]/40 bg-[#10D8BE]/10 text-[#10D8BE]"
                              : `border-white/[0.08] ${TAG_TONE[w]} hover:border-white/[0.15] hover:text-white`
                          }`}
                        >
                          {t.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>
          )}

          <div className="min-w-0">
            {(category || tag) && (
              <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[#555]">Filtered by</span>
                {category && (
                  <span className="rounded-full border border-[#10D8BE]/30 bg-[#10D8BE]/10 px-2.5 py-1 text-[#10D8BE]">
                    {category}
                  </span>
                )}
                {tag && (
                  <span className="rounded-full border border-[#10D8BE]/30 bg-[#10D8BE]/10 px-2.5 py-1 text-[#10D8BE]">
                    #{tag}
                  </span>
                )}
                <Link
                  href={makeHref({ q: query })}
                  className="inline-flex items-center gap-1 text-[#555] transition-colors hover:text-white"
                >
                  <IconX className="size-3.5" />
                  clear
                </Link>
              </div>
            )}

            {query && (
              <p className="mb-6 text-sm text-[#555]">
                {totalCount} result{totalCount !== 1 ? "s" : ""} for &ldquo;
                {query}&rdquo;
              </p>
            )}

            {posts.length === 0 ? (
              <p className="text-[#555]">
                {query || category || tag
                  ? "No posts found."
                  : "No posts yet. Check back soon."}
              </p>
            ) : (
              <div>
                {/* Featured post (first one) */}
                {(() => {
                  const featured = posts[0];
                  const rest = posts.slice(1);
                  return (
                    <>
                      <Link
                        href={`/blog/${featured.slug}`}
                        className="group block rounded-xl border border-white/[0.06] p-6 transition-colors hover:border-white/[0.12] hover:bg-white/[0.02]"
                      >
                        {featured.coverImageUrl && (
                          <img
                            src={featured.coverImageUrl}
                            alt={`Cover image for "${featured.title}"`}
                            width={1200}
                            height={630}
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            className="mb-4 aspect-[1200/630] w-full rounded-lg object-cover"
                          />
                        )}
                        <h2 className="mb-2 text-2xl font-semibold text-white group-hover:text-[#10D8BE] transition-colors">
                          {featured.title}
                        </h2>
                        {featured.excerpt && (
                          <p className="mb-3 text-[#888] line-clamp-2">
                            {featured.excerpt}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-sm text-[#555]">
                          <span>{featured.authorName}</span>
                          <span>·</span>
                          <time>
                            {featured.publishedAt
                              ? new Date(
                                  featured.publishedAt,
                                ).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "long",
                                  day: "numeric",
                                })
                              : ""}
                          </time>
                          {featured.readingTime != null && (
                            <>
                              <span>·</span>
                              <span>{featured.readingTime} min read</span>
                            </>
                          )}
                        </div>
                      </Link>

                      {/* Compact list for the rest */}
                      {rest.length > 0 && (
                        <div className="mt-8 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06]">
                          {rest.map((post) => (
                            <Link
                              key={post.slug}
                              href={`/blog/${post.slug}`}
                              className="group flex items-center gap-5 px-6 py-5 transition-colors hover:bg-white/[0.02]"
                            >
                              {post.coverImageUrl && (
                                <img
                                  src={post.coverImageUrl}
                                  alt={`Cover image for "${post.title}"`}
                                  width={64}
                                  height={64}
                                  loading="lazy"
                                  decoding="async"
                                  className="hidden size-16 shrink-0 rounded-lg object-cover sm:block"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <h2 className="font-semibold text-white transition-colors group-hover:text-[#10D8BE] truncate">
                                  {post.title}
                                </h2>
                                {post.excerpt && (
                                  <p className="mt-1 text-sm text-[#888] line-clamp-1">
                                    {post.excerpt}
                                  </p>
                                )}
                              </div>
                              <div className="hidden shrink-0 text-right text-sm text-[#555] sm:block">
                                <div>{post.authorName}</div>
                                <time>
                                  {post.publishedAt
                                    ? new Date(
                                        post.publishedAt,
                                      ).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })
                                    : ""}
                                  {post.readingTime != null &&
                                    ` · ${post.readingTime} min read`}
                                </time>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-12 flex items-center justify-center gap-2">
                {page > 1 ? (
                  <Link
                    href={makeHref({ q: query, category, tag, page: page - 1 })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-[#888] transition-colors hover:border-white/[0.15] hover:text-white"
                  >
                    <IconChevronLeft className="size-4" />
                    Previous
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.04] px-4 py-2 text-sm text-[#333] cursor-not-allowed">
                    <IconChevronLeft className="size-4" />
                    Previous
                  </span>
                )}

                <span className="px-4 py-2 text-sm text-[#555]">
                  {page} / {totalPages}
                </span>

                {page < totalPages ? (
                  <Link
                    href={makeHref({ q: query, category, tag, page: page + 1 })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-[#888] transition-colors hover:border-white/[0.15] hover:text-white"
                  >
                    Next
                    <IconChevronRight className="size-4" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.04] px-4 py-2 text-sm text-[#333] cursor-not-allowed">
                    Next
                    <IconChevronRight className="size-4" />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <LandingFooter />
      <ScrollToTop />
    </div>
  );
}
