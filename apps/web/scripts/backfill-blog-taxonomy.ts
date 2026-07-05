/**
 * Backfill script: populate the new BlogPost taxonomy fields
 * (`readingTime`, `category`, `tags`) on existing published posts.
 *
 * For each published, non-deleted post:
 *   - readingTime: recomputed deterministically from content when null.
 *   - category / tags: generated with ONE Anthropic call (same minified-JSON
 *     shape as the authoring API) only when missing; existing values are kept.
 *
 * Fully-populated posts are skipped (idempotent). Generating category/tags
 * requires ANTHROPIC_API_KEY; readingTime never does.
 *
 * Usage:
 *   Dry run (default):  bun run --cwd apps/web scripts/backfill-blog-taxonomy.ts
 *   Apply changes:      bun run --cwd apps/web scripts/backfill-blog-taxonomy.ts --apply
 */

import { prisma } from "@octopus/db";
import Anthropic from "@anthropic-ai/sdk";
import { readingTimeMinutes } from "@/lib/blog-reading";

const APPLY = process.argv.includes("--apply");

// Keep in sync with the allowlist in app/api/blog/route.ts.
const BLOG_CATEGORIES = ["Engineering", "Product", "Company", "Security", "Guides"] as const;
function normalizeCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = BLOG_CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? null;
}

interface GeneratedSeo {
  category: string | null;
  tags: string[];
}

/**
 * Ask Claude for SEO metadata as minified JSON and return the parsed
 * category/tags. Returns null/[] on any failure so callers degrade gracefully.
 */
async function generateSeo(content: string): Promise<GeneratedSeo> {
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
    const parsed = JSON.parse(cleaned) as { category?: string; tags?: string[] };
    const category = normalizeCategory(parsed.category);
    const tags = Array.isArray(parsed.tags)
      ? [...new Set(parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6)
      : [];
    return { category, tags };
  } catch {
    return { category: null, tags: [] };
  }
}

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const posts = await prisma.blogPost.findMany({
    where: { status: "published", deletedAt: null },
    select: {
      id: true,
      slug: true,
      content: true,
      tags: true,
      category: true,
      readingTime: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`[backfill] Loaded ${posts.length} published posts\n`);

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const needsReadingTime = post.readingTime == null;
    const needsSeo = post.tags.length === 0 || post.category === null;

    if (!needsReadingTime && !needsSeo) {
      skipped++;
      continue;
    }

    const data: { readingTime?: number; tags?: string[]; category?: string } = {};

    if (needsReadingTime) {
      data.readingTime = readingTimeMinutes(post.content);
    }

    if (needsSeo) {
      const seo = await generateSeo(post.content);
      if (post.tags.length === 0 && seo.tags.length > 0) {
        data.tags = seo.tags;
      }
      if (post.category === null && seo.category) {
        data.category = seo.category;
      }
    }

    if (Object.keys(data).length === 0) {
      skipped++;
      console.log(`[backfill] ${post.slug.padEnd(50)} nothing to write (generation returned nothing)`);
      continue;
    }

    const summary = [
      data.readingTime != null ? `readingTime=${data.readingTime}` : null,
      data.category != null ? `category=${data.category}` : null,
      data.tags != null ? `tags=[${data.tags.join(", ")}]` : null,
    ]
      .filter(Boolean)
      .join(" ");

    console.log(`[backfill] ${post.slug.padEnd(50)} ${APPLY ? "->" : "(dry-run)"} ${summary}`);

    if (APPLY) {
      await prisma.blogPost.update({ where: { id: post.id }, data });
      updated++;
    }
  }

  console.log(`\n[backfill] Done.`);
  console.log(`  Posts scanned:     ${posts.length}`);
  console.log(`  Skipped (no-op):   ${skipped}`);
  if (APPLY) {
    console.log(`  Updated:           ${updated}`);
  } else {
    console.log(`\n[backfill] Dry run complete. Re-run with --apply to persist changes.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
