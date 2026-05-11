import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";

async function authenticateBlogToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const apiToken = await prisma.blogApiToken.findUnique({
    where: { tokenHash, deletedAt: null },
  });

  if (!apiToken) return null;

  // Update lastUsedAt
  prisma.blogApiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return apiToken;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(request: NextRequest) {
  const token = await authenticateBlogToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10));
  const status = searchParams.get("status") || undefined;

  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { excerpt: { contains: q, mode: "insensitive" as const } },
            { content: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        coverImageUrl: true,
        status: true,
        authorName: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
    prisma.blogPost.count({ where }),
  ]);

  return NextResponse.json({
    posts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(request: NextRequest) {
  const token = await authenticateBlogToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      title,
      slug,
      content,
      excerpt,
      coverImageUrl,
      authorName = "Octopus Team",
      status = "draft",
      generateSeo = false,
    } = body as {
      title?: string;
      slug?: string;
      content?: string;
      excerpt?: string;
      coverImageUrl?: string;
      authorName?: string;
      status?: string;
      generateSeo?: boolean;
    };

    if (!title || !content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 },
      );
    }

    const finalSlug = slug || slugify(title);

    // Check slug uniqueness (exclude soft-deleted posts)
    const existing = await prisma.blogPost.findFirst({ where: { slug: finalSlug, deletedAt: null } });
    if (existing) {
      return NextResponse.json(
        { error: "A post with this slug already exists" },
        { status: 409 },
      );
    }

    // Generate SEO excerpt if requested and not provided
    let finalExcerpt = excerpt;
    if (generateSeo && !excerpt) {
      try {
        const client = new Anthropic();
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: `Write a concise SEO-friendly excerpt (max 150 characters) for this blog post. Return ONLY the excerpt text, nothing else.\n\n${content.slice(0, 4000)}`,
            },
          ],
        });
        const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
        if (text) finalExcerpt = text;
      } catch {
        // SEO generation failed, continue without excerpt
      }
    }

    const isPublished = status === "published";

    const post = await prisma.blogPost.create({
      data: {
        title,
        slug: finalSlug,
        excerpt: finalExcerpt ?? null,
        content,
        coverImageUrl: coverImageUrl ?? null,
        status: isPublished ? "published" : "draft",
        publishedAt: isPublished ? new Date() : null,
        authorId: "api",
        authorName,
      },
    });

    revalidatePath("/blog");
    revalidatePath("/admin/blog");

    return NextResponse.json({
      success: true,
      id: post.id,
      slug: post.slug,
      status: post.status,
      excerpt: post.excerpt,
      url: `/blog/${post.slug}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to create blog post" },
      { status: 500 },
    );
  }
}
