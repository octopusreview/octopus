import type { Metadata } from "next";
import { ORGANIZATION_ENTITY, blogAuthorJsonLd } from "@/lib/structured-data";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { prisma } from "@octopus/db";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { BlogContent } from "@/components/blog-content";
import { BlogAudioPlayer } from "@/components/blog-audio-player";
import { BlogToc } from "@/components/blog-toc";
import { ScrollToTop } from "@/components/scroll-to-top";
import { IconArrowLeft } from "@tabler/icons-react";
import { readingTimeMinutes, extractHeadings, proseWordCount, postModifiedAt } from "@/lib/blog-reading";
import { safeJsonLd } from "@/lib/html";
import { relatedPosts } from "@/lib/blog-related";

import { CARD_SIZE } from "@/lib/og-card";

// Every published post's tags, newest first, to pick related posts from.
// Read on each request, so a post that is unpublished stops being listed at once.
function getRelatedCandidates() {
  return prisma.blogPost.findMany({
    where: { status: "published", deletedAt: null },
    select: { slug: true, title: true, tags: true },
    orderBy: { publishedAt: "desc" },
  });
}

// No post is rendered at build time (the build has no database). Each post is
// rendered on its first request and then served from the cache.
export function generateStaticParams() {
  return [];
}

async function getPost(slug: string) {
  return prisma.blogPost.findFirst({
    where: { slug, status: "published", deletedAt: null },
  });
}

function canonicalUrlFor(slug: string) {
  return `https://octopus-review.ai/blog/${slug}`;
}

/** The post's cover image, or a card generated from its title when it has none. */
function socialImage(post: { slug: string; title: string; coverImageUrl: string | null }) {
  return post.coverImageUrl
    ? { url: post.coverImageUrl }
    : { url: `${canonicalUrlFor(post.slug)}/card`, ...CARD_SIZE, alt: post.title };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Post Not Found" };

  const canonicalUrl = canonicalUrlFor(slug);

  return {
    title: post.title,
    description: post.excerpt ?? undefined,
    keywords: post.tags.length > 0 ? post.tags : undefined,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      images: [socialImage(post)],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt ?? undefined,
      images: [socialImage(post).url],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) notFound();

  const canonicalUrl = canonicalUrlFor(slug);
  const headings = extractHeadings(post.content);
  const minutes = post.readingTime ?? readingTimeMinutes(post.content);
  const wordCount = proseWordCount(post.content);
  const related = relatedPosts(slug, await getRelatedCandidates());

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: [socialImage(post).url],
    datePublished: post.publishedAt?.toISOString(),
    dateModified: postModifiedAt(post)?.toISOString(),
    wordCount,
    ...(post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
    ...(post.category ? { articleSection: post.category } : {}),
    author: blogAuthorJsonLd(post.authorName),
    publisher: ORGANIZATION_ENTITY,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Blog",
        item: "https://octopus-review.ai/blog",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: post.title,
        item: canonicalUrl,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-background text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(blogPostingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <LandingDesktopNav />
      <LandingMobileNav />

      <div className="mx-auto max-w-6xl px-6 pt-32 pb-20">
        <Link
          href="/blog"
          className="relative mb-8 inline-flex items-center gap-1.5 text-sm text-[#555] transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-white"
        >
          <IconArrowLeft className="size-3.5" />
          Back to Blog
        </Link>

        <div className="gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
          <article className="min-w-0 max-w-3xl">
            {post.coverImageUrl && (
              <img
                src={post.coverImageUrl}
                alt={`Cover image for "${post.title}"`}
                width={1200}
                height={630}
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="mb-8 aspect-[1200/630] w-full rounded-xl object-cover"
              />
            )}

            {post.category && (
              <Link
                href={`/blog?category=${encodeURIComponent(post.category)}`}
                className="mb-3 inline-block text-xs font-semibold uppercase tracking-[0.2em] text-primary transition-colors hover:text-primary/80"
              >
                {post.category}
              </Link>
            )}

            <h1 className="mb-4 text-4xl font-bold tracking-tight">{post.title}</h1>

            <div className="mb-10 flex flex-wrap items-center gap-3 text-sm text-[#555]">
              <span>{post.authorName}</span>
              <span aria-hidden="true">·</span>
              <time>
                {post.publishedAt
                  ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : ""}
              </time>
              <span aria-hidden="true">·</span>
              <span>{minutes} min read</span>
              {post.audioUrl && (
                <>
                  <span aria-hidden="true">·</span>
                  <BlogAudioPlayer src={post.audioUrl} />
                </>
              )}
            </div>

            {headings.length >= 2 && (
              <details className="mb-8 rounded-lg border border-white/[0.08] p-4 lg:hidden">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
                  On this page
                </summary>
                <div className="mt-4">
                  <BlogToc headings={headings} />
                </div>
              </details>
            )}

            <div className="text-[#a0a0a0] [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white [&_strong]:text-white [&_a]:text-primary [&_code]:bg-white/[0.06] [&_pre]:bg-white/[0.04] [&_pre]:border [&_pre]:border-white/[0.06] [&_blockquote]:border-[#333] [&_th]:border-[#333] [&_td]:border-[#333] [&_hr]:border-[#333] [&_table]:border-[#333]">
              <BlogContent content={post.content} />
            </div>

            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2 border-t border-white/[0.06] pt-6">
                {post.tags.map((t) => (
                  <Link
                    key={t}
                    href={`/blog?tag=${encodeURIComponent(t)}`}
                    className="rounded-full border border-white/[0.08] px-3 py-1 text-xs text-[#888] transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            )}

            {related.length > 0 && (
              <nav aria-label="Related posts" className="mt-10 border-t border-white/[0.06] pt-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
                  Related posts
                </h2>
                <ul>
                  {related.map((relatedPost) => (
                    <li key={relatedPost.slug}>
                      <Link
                        href={`/blog/${relatedPost.slug}`}
                        className="block py-2 text-sm text-[#ccc] transition-colors hover:text-primary"
                      >
                        {relatedPost.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <BlogToc headings={headings} />
            </div>
          </aside>
        </div>
      </div>

      <LandingFooter />
      <ScrollToTop />
    </div>
  );
}
