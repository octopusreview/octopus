import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { readingTimeMinutes } from "@/lib/blog-reading";
import { hashToken } from "@/lib/api-auth";
import { hasScopes } from "@/lib/scopes";

type AuthedToken = { id: string; tokenPrefix: string; scopes: string[] };

async function authenticateServiceToken(
  request: NextRequest,
): Promise<AuthedToken | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  // Plain sha256 lookup with NO format/prefix precondition — legacy blog tokens
  // were minted with an unconstrained format, so a prefix gate would break them.
  const svc = await prisma.serviceToken.findUnique({
    where: { tokenHash: hashToken(token), deletedAt: null },
  });
  if (!svc) return null;
  if (svc.expiresAt && svc.expiresAt.getTime() <= Date.now()) return null;

  // Fire-and-forget; never logs the token.
  prisma.serviceToken
    .update({ where: { id: svc.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: svc.id, tokenPrefix: svc.tokenPrefix, scopes: svc.scopes };
}

// 401 when unauthenticated (no/invalid/expired token); 403 when the token is
// valid but lacks the required scope (deny-by-default). Returns the authed
// token on success, or a ready-to-return NextResponse on failure.
async function requireScope(
  request: NextRequest,
  scope: string,
): Promise<{ token: AuthedToken } | { error: NextResponse }> {
  const token = await authenticateServiceToken(request);
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!hasScopes(token.scopes, scope)) {
    return {
      error: NextResponse.json(
        { error: `Missing required scope: ${scope}` },
        { status: 403 },
      ),
    };
  }
  return { token };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Canonical blog categories. Author- and LLM-supplied values are matched
// case-insensitively against this allowlist; anything else becomes null so the
// sidebar only ever shows known categories.
const BLOG_CATEGORIES = ["Engineering", "Product", "Company", "Security", "Guides"] as const;
function normalizeCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = BLOG_CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? null;
}

// audioUrl is rendered as <audio src> on the public blog, so only accept null
// (clear) or an https URL under the configured R2 public base — never an
// arbitrary origin (guards a leaked write token from repointing audio). FAILS
// CLOSED: if R2_PUBLIC_URL is unset, any non-null audioUrl is rejected.
function normalizeAudioUrl(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!base) return { ok: false };
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return { ok: false };
    if (!value.startsWith(`${base}/`)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

// coverImageUrl is rendered as <img src> on the public blog. Accept null or an
// https URL whose host is allowlisted (the R2 public host + cdn.octopus-review.ai,
// which matches next.config images.remotePatterns) — not an arbitrary origin.
function normalizeImageUrl(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return { ok: false };
    const hosts = new Set<string>(["cdn.octopus-review.ai"]);
    const base = process.env.R2_PUBLIC_URL;
    if (base) {
      try {
        hosts.add(new URL(base).host);
      } catch {
        // ignore malformed R2_PUBLIC_URL
      }
    }
    if (!hosts.has(u.host)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, "blog:read");
  if ("error" in auth) return auth.error;

  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10));
  const status = searchParams.get("status") || undefined;
  // Full post bodies are opt-in (the audio generator needs them); the default
  // list response stays lean.
  const includeContent = searchParams.get("includeContent") === "true";

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
        ...(includeContent ? { content: true } : {}),
        coverImageUrl: true,
        audioUrl: true,
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
  const auth = await requireScope(request, "blog:create");
  if ("error" in auth) return auth.error;

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

    const coverImage = normalizeImageUrl(coverImageUrl);
    if (!coverImage.ok) {
      return NextResponse.json(
        { error: "coverImageUrl must be null or an https URL on an allowed host" },
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
    let finalCategory = normalizeCategory(category);

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
          if (finalCategory === null && typeof parsed.category === "string") {
            finalCategory = normalizeCategory(parsed.category);
          }
          if (finalTags.length === 0 && Array.isArray(parsed.tags)) {
            finalTags = [...new Set(parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6);
          }
        } catch {
          // Model didn't return valid JSON — skip generated metadata rather
          // than storing raw model output as the excerpt.
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
        coverImageUrl: coverImage.value,
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

    console.log(
      `[blog-api] token=${auth.token.tokenPrefix} action=create post=${post.id} slug=${post.slug} status=${post.status}`,
    );

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

export async function PATCH(request: NextRequest) {
  const auth = await requireScope(request, "blog:update");
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const { id, title, content, excerpt, coverImageUrl, status, audioUrl, tags, category } =
      body as {
        id?: string;
        title?: string;
        content?: string;
        excerpt?: string | null;
        coverImageUrl?: string | null;
        status?: string;
        audioUrl?: string | null;
        tags?: string[];
        category?: string;
      };

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const post = await prisma.blogPost.findFirst({ where: { id, deletedAt: null } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Update ONLY the fields the caller provided, each with POST-grade
    // validation. Slug is intentionally immutable via PATCH.
    const data: {
      title?: string;
      content?: string;
      excerpt?: string | null;
      coverImageUrl?: string | null;
      status?: string;
      publishedAt?: Date;
      readingTime?: number;
      audioUrl?: string | null;
      tags?: string[];
      category?: string | null;
    } = {};

    if ("title" in body) {
      if (typeof title !== "string" || !title.trim()) {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      data.title = title;
    }
    if ("content" in body) {
      if (typeof content !== "string" || !content.trim()) {
        return NextResponse.json({ error: "content must be a non-empty string" }, { status: 400 });
      }
      data.content = content;
      data.readingTime = readingTimeMinutes(content); // recompute on edit
    }
    if ("excerpt" in body) {
      data.excerpt = typeof excerpt === "string" ? excerpt : null;
    }
    if ("coverImageUrl" in body) {
      const img = normalizeImageUrl(coverImageUrl);
      if (!img.ok) {
        return NextResponse.json(
          { error: "coverImageUrl must be null or an https URL on an allowed host" },
          { status: 400 },
        );
      }
      data.coverImageUrl = img.value;
    }
    if ("status" in body) {
      if (status !== "draft" && status !== "published") {
        return NextResponse.json({ error: 'status must be "draft" or "published"' }, { status: 400 });
      }
      data.status = status;
      // Publish: stamp publishedAt the first time. Unpublish keeps the original date.
      if (status === "published" && !post.publishedAt) data.publishedAt = new Date();
    }
    if ("audioUrl" in body) {
      const result = normalizeAudioUrl(audioUrl);
      if (!result.ok) {
        return NextResponse.json(
          { error: "audioUrl must be null or an https URL under the configured audio host" },
          { status: 400 },
        );
      }
      data.audioUrl = result.value;
    }
    if ("tags" in body && Array.isArray(tags)) {
      data.tags = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6);
    }
    if ("category" in body) {
      data.category = normalizeCategory(category);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 },
      );
    }

    const updated = await prisma.blogPost.update({
      where: { id: post.id },
      data,
      select: {
        id: true,
        slug: true,
        status: true,
        audioUrl: true,
        tags: true,
        category: true,
      },
    });

    revalidatePath("/blog");
    revalidatePath(`/blog/${updated.slug}`);

    console.log(
      `[blog-api] token=${auth.token.tokenPrefix} action=update post=${updated.id} fields=${Object.keys(data).join(",")}`,
    );

    return NextResponse.json({
      success: true,
      id: updated.id,
      slug: updated.slug,
      status: updated.status,
      audioUrl: updated.audioUrl,
      tags: updated.tags,
      category: updated.category,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to update blog post" },
      { status: 500 },
    );
  }
}
