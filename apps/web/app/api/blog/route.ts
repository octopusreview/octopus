import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { readingTimeMinutes } from "@/lib/blog-reading";

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
      tags,
      category,
    } = body as {
      title?: string;
      slug?: string;
      content?: string;
      excerpt?: string;
      coverImageUrl?: string;
      authorName?: string;
      status?: string;
      generateSeo?: boolean;
      tags?: string[];
      category?: string;
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

    // Sanitize taxonomy inputs (author-provided values win over generation)
    let finalTags = Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6)
      : [];
    let finalCategory = category?.trim() ? category.trim() : null;

    // Generate SEO metadata (excerpt / category / tags) if requested and any
    // piece is missing. One Anthropic call fills ONLY the gaps; generation
    // failures must never block post creation.
    let finalExcerpt = excerpt;
    if (generateSeo && (!finalExcerpt || finalTags.length === 0 || finalCategory === null)) {
      try {
        const client = new Anthropic();
        const response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [
            {
              role: "user",
              content: `Generate SEO metadata for this blog post. Return ONLY minified JSON, no prose or code fences, of the exact shape: {"excerpt": string (<=150 chars), "category": one of ["Engineering","Product","Company","Security","Guides"], "tags": 3-6 short lowercase topic strings}.\n\n${content.slice(0, 4000)}`,
            },
          ],
        });
        const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
        const cleaned = text.replace(/```(?:json)?/gi, "").trim();
        try {
          const parsed = JSON.parse(cleaned) as {
            excerpt?: string;
            category?: string;
            tags?: string[];
          };
          if (!finalExcerpt && typeof parsed.excerpt === "string" && parsed.excerpt.trim()) {
            finalExcerpt = parsed.excerpt.trim();
          }
          if (finalCategory === null && typeof parsed.category === "string" && parsed.category.trim()) {
            finalCategory = parsed.category.trim();
          }
          if (finalTags.length === 0 && Array.isArray(parsed.tags)) {
            finalTags = [...new Set(parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6);
          }
        } catch {
          // Not valid JSON — fall back to the original excerpt-only behavior.
          if (!finalExcerpt && text) finalExcerpt = text;
        }
      } catch {
        // SEO generation failed, continue without generated metadata
      }
    }

    const isPublished = status === "published";
    const readingTime = readingTimeMinutes(content);

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
        tags: finalTags,
        category: finalCategory,
        readingTime,
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
      tags: post.tags,
      category: post.category,
      url: `/blog/${post.slug}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to create blog post" },
      { status: 500 },
    );
  }
}
