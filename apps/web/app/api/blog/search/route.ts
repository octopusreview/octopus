import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { isPostgresSafeText } from "@/lib/bounded-json";

export async function GET(request: NextRequest) {
  const values = request.nextUrl.searchParams.getAll("q");
  const rawQuery = values[0] ?? "";
  if (values.length > 1 || rawQuery.length > 1024 || !isPostgresSafeText(rawQuery)) {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }
  const q = rawQuery.trim();

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
