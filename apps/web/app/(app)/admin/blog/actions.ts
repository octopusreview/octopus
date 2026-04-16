"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    throw new Error("Unauthorized");
  }
  return session;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createBlogPost(formData: FormData) {
  const session = await requireAdmin();

  const title = formData.get("title") as string;
  const slug = (formData.get("slug") as string) || slugify(title);
  const excerpt = (formData.get("excerpt") as string) || null;
  const content = formData.get("content") as string;
  const coverImageUrl = (formData.get("coverImageUrl") as string) || null;
  const publish = formData.get("publish") === "true";

  if (!title || !content) {
    return { error: "Title and content are required" };
  }

  const existing = await prisma.blogPost.findFirst({ where: { slug, deletedAt: null } });
  if (existing) {
    return { error: "A post with this slug already exists" };
  }

  const post = await prisma.blogPost.create({
    data: {
      title,
      slug,
      excerpt,
      content,
      coverImageUrl,
      status: publish ? "published" : "draft",
      publishedAt: publish ? new Date() : null,
      authorId: session.user.id,
      authorName: session.user.name,
    },
  });

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  return { success: true, id: post.id };
}

export async function updateBlogPost(id: string, formData: FormData) {
  await requireAdmin();

  const title = formData.get("title") as string;
  const slug = formData.get("slug") as string;
  const excerpt = (formData.get("excerpt") as string) || null;
  const content = formData.get("content") as string;
  const coverImageUrl = (formData.get("coverImageUrl") as string) || null;

  if (!title || !content || !slug) {
    return { error: "Title, slug, and content are required" };
  }

  // Check slug uniqueness (excluding current post and soft-deleted posts)
  const existing = await prisma.blogPost.findFirst({ where: { slug, deletedAt: null } });
  if (existing && existing.id !== id) {
    return { error: "A post with this slug already exists" };
  }

  await prisma.blogPost.update({
    where: { id },
    data: { title, slug, excerpt, content, coverImageUrl },
  });

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  return { success: true };
}

export async function publishBlogPost(id: string) {
  await requireAdmin();

  const post = await prisma.blogPost.update({
    where: { id },
    data: { status: "published", publishedAt: new Date() },
  });

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);
  return { success: true };
}

export async function unpublishBlogPost(id: string) {
  await requireAdmin();

  const post = await prisma.blogPost.update({
    where: { id },
    data: { status: "draft", publishedAt: null },
  });

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);
  return { success: true };
}

export async function deleteBlogPost(id: string) {
  await requireAdmin();

  const post = await prisma.blogPost.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/admin/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);
  return { success: true };
}

export async function generateExcerpt(content: string) {
  await requireAdmin();

  if (!content.trim()) {
    return { error: "Content is empty" };
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Write a concise SEO-friendly excerpt (max 150 characters) for this blog post. Return ONLY the excerpt text, nothing else.\n\n${content.slice(0, 4000)}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!text) {
    return { error: "Failed to generate excerpt" };
  }

  return { success: true, excerpt: text };
}

// ── Blog API Token Management ───────────────────────────────────────────────

export async function generateBlogApiToken(name: string) {
  await requireAdmin();

  if (!name.trim()) {
    return { error: "Token name is required" };
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const rawToken = `blog_${hex}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(0, 9) + "...";

  await prisma.blogApiToken.create({
    data: { name, tokenHash, tokenPrefix },
  });

  revalidatePath("/admin/blog");
  return { success: true, token: rawToken };
}

export async function deleteBlogApiToken(id: string) {
  await requireAdmin();

  await prisma.blogApiToken.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/admin/blog");
  return { success: true };
}
