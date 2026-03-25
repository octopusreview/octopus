import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  if (!q) {
    return NextResponse.json({ posts: [] });
  }

  const posts = await prisma.blogPost.findMany({
    where: {
      status: "published",
      deletedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { excerpt: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { publishedAt: "desc" },
    take: 10,
    select: {
      title: true,
      slug: true,
      excerpt: true,
    },
  });

  return NextResponse.json({ posts });
}
