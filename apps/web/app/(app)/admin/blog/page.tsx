import { prisma } from "@octopus/db";
import { BlogAdmin } from "./blog-admin";

const POSTS_PER_PAGE = 5;

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const [posts, totalCount, tokens] = await Promise.all([
    prisma.blogPost.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * POSTS_PER_PAGE,
      take: POSTS_PER_PAGE,
    }),
    prisma.blogPost.count({ where: { deletedAt: null } }),
    prisma.blogApiToken.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

  return (
    <BlogAdmin
      posts={posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        authorName: p.authorName,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      }))}
      tokens={tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
      page={page}
      totalPages={totalPages}
    />
  );
}
