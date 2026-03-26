import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { BlogSearch } from "@/components/blog-search";
import { ScrollToTop } from "@/components/scroll-to-top";

const POSTS_PER_PAGE = 10;

export const metadata: Metadata = {
  title: "Blog — Octopus",
  description:
    "Engineering insights, product updates, and lessons learned building AI-powered code review tools.",
  alternates: {
    canonical: "https://octopus-review.ai/blog",
  },
};

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page: pageParam, q: searchQuery } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const query = searchQuery?.trim() || "";

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const isLoggedIn = !!session;

  const where = {
    status: "published" as const,
    deletedAt: null,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { excerpt: { contains: query, mode: "insensitive" as const } },
            { content: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
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
      },
    }),
    prisma.blogPost.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <LandingDesktopNav isLoggedIn={isLoggedIn} />
      <LandingMobileNav isLoggedIn={isLoggedIn} />

      <main className="mx-auto max-w-4xl px-6 pt-32 pb-20">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
            <p className="mt-2 text-lg text-[#888]">
              Engineering insights, product updates, and lessons learned.
            </p>
          </div>
          <BlogSearch />
        </div>

        {query && (
          <p className="mb-6 text-sm text-[#555]">
            {totalCount} result{totalCount !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          </p>
        )}

        {posts.length === 0 ? (
          <p className="text-[#555]">{query ? "No posts found." : "No posts yet. Check back soon."}</p>
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
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={featured.coverImageUrl}
                        alt={featured.title}
                        className="mb-4 w-full rounded-lg"
                        loading="lazy"
                      />
                    )}
                    <h2 className="mb-2 text-2xl font-semibold text-white group-hover:text-[#10D8BE] transition-colors">
                      {featured.title}
                    </h2>
                    {featured.excerpt && (
                      <p className="mb-3 text-[#888] line-clamp-2">{featured.excerpt}</p>
                    )}
                    <div className="flex items-center gap-3 text-sm text-[#555]">
                      <span>{featured.authorName}</span>
                      <span>·</span>
                      <time>
                        {featured.publishedAt
                          ? new Date(featured.publishedAt).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })
                          : ""}
                      </time>
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
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={post.coverImageUrl}
                              alt={post.title}
                              className="hidden size-16 shrink-0 rounded-lg object-cover sm:block"
                              loading="lazy"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <h2 className="font-semibold text-white transition-colors group-hover:text-[#10D8BE] truncate">
                              {post.title}
                            </h2>
                            {post.excerpt && (
                              <p className="mt-1 text-sm text-[#888] line-clamp-1">{post.excerpt}</p>
                            )}
                          </div>
                          <div className="hidden shrink-0 text-right text-sm text-[#555] sm:block">
                            <div>{post.authorName}</div>
                            <time>
                              {post.publishedAt
                                ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : ""}
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
        {totalPages > 1 && (() => {
          const qs = (p: number) => {
            const params = new URLSearchParams();
            if (p > 1) params.set("page", String(p));
            if (query) params.set("q", query);
            const str = params.toString();
            return str ? `/blog?${str}` : "/blog";
          };
          return (
          <div className="mt-12 flex items-center justify-center gap-2">
            {page > 1 ? (
              <Link
                href={qs(page - 1)}
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
                href={qs(page + 1)}
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
          );
        })()}
      </main>

      <LandingFooter />
      <ScrollToTop />
    </div>
  );
}
