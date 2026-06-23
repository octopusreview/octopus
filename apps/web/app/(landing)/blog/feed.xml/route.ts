import { prisma } from "@octopus/db";
import { buildRssFeed } from "@/lib/blog-rss";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 20;

function fetchPublishedPosts() {
  return prisma.blogPost.findMany({
    where: { status: "published", deletedAt: null },
    orderBy: { publishedAt: "desc" },
    take: MAX_ITEMS,
    select: {
      title: true,
      slug: true,
      excerpt: true,
      authorName: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
}

export async function GET() {
  let posts: Awaited<ReturnType<typeof fetchPublishedPosts>> = [];
  try {
    posts = await fetchPublishedPosts();
  } catch {
    posts = [];
  }

  const xml = buildRssFeed(posts);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
