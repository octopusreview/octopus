import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { BlogContent } from "@/components/blog-content";
import { ScrollToTop } from "@/components/scroll-to-top";
import { IconArrowLeft } from "@tabler/icons-react";

async function getPost(slug: string) {
  return prisma.blogPost.findFirst({
    where: { slug, status: "published", deletedAt: null },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Post Not Found" };

  const canonicalUrl = `https://octopus-review.ai/blog/${slug}`;

  return {
    title: `${post.title} — Octopus Blog`,
    description: post.excerpt ?? undefined,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      type: "article",
      publishedTime: post.publishedAt?.toISOString(),
      images: post.coverImageUrl ? [{ url: post.coverImageUrl }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt ?? undefined,
      images: post.coverImageUrl ? [post.coverImageUrl] : [],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const isLoggedIn = !!session;
  const post = await getPost(slug);

  if (!post) notFound();

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <LandingDesktopNav isLoggedIn={isLoggedIn} />
      <LandingMobileNav isLoggedIn={isLoggedIn} />

      <article className="mx-auto max-w-3xl px-6 pt-32 pb-20">
        <Link
          href="/blog"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-[#555] transition-colors hover:text-white"
        >
          <IconArrowLeft className="size-3.5" />
          Back to Blog
        </Link>

        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt={post.title}
            className="mb-8 w-full rounded-xl object-cover"
            loading="lazy"
          />
        )}

        <h1 className="mb-4 text-4xl font-bold tracking-tight">{post.title}</h1>

        <div className="mb-10 flex items-center gap-3 text-sm text-[#555]">
          <span>{post.authorName}</span>
          <span>·</span>
          <time>
            {post.publishedAt
              ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : ""}
          </time>
        </div>

        <div className="text-[#a0a0a0] [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white [&_strong]:text-white [&_a]:text-[#10D8BE] [&_code]:bg-white/[0.06] [&_pre]:bg-white/[0.04] [&_pre]:border [&_pre]:border-white/[0.06] [&_blockquote]:border-[#333] [&_th]:border-[#333] [&_td]:border-[#333] [&_hr]:border-[#333] [&_table]:border-[#333]">
          <BlogContent content={post.content} />
        </div>
      </article>

      <LandingFooter />
      <ScrollToTop />
    </div>
  );
}
