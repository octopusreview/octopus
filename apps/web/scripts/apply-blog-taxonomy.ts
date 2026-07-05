/**
 * Apply the reviewed blog taxonomy (scripts/data/blog-taxonomy.json) to
 * existing posts via the authenticated PATCH /api/blog endpoint over the
 * public API — no DB access needed (the prod DB is VPN-only).
 *
 *   Dry run (default, no writes):
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-taxonomy.ts
 *   Apply:
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-taxonomy.ts --apply
 *
 * Env: BLOG_API_TOKEN (required), OCTOPUS_API_URL (default https://octopus-review.ai).
 */
import taxonomy from "./data/blog-taxonomy.json" with { type: "json" };

const APPLY = process.argv.includes("--apply");
const API_URL = (process.env.OCTOPUS_API_URL ?? "https://octopus-review.ai").replace(/\/$/, "");
const TOKEN = process.env.BLOG_API_TOKEN;

if (!TOKEN) {
  console.error("BLOG_API_TOKEN is required.");
  process.exit(1);
}

type Post = { id: string; slug: string; category?: string | null; tags?: string[] };

async function fetchAllPosts(): Promise<Post[]> {
  const posts: Post[] = [];
  // Hard page cap as a backstop; the real exit is page >= totalPages below.
  for (let page = 1; page <= 500; page++) {
    const res = await fetch(`${API_URL}/api/blog?status=published&limit=50&page=${page}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`GET /api/blog failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { posts?: Post[]; pagination?: { totalPages?: number } };
    const totalPages = Number(data?.pagination?.totalPages);
    if (!Array.isArray(data.posts) || !Number.isFinite(totalPages)) {
      throw new Error(`Unexpected /api/blog response shape on page ${page}`);
    }
    posts.push(...data.posts);
    if (page >= totalPages) break;
  }
  return posts;
}

async function main() {
  console.log(`[apply-taxonomy] Mode: ${APPLY ? "APPLY" : "DRY RUN"} · ${API_URL}`);
  const posts = await fetchAllPosts();
  const bySlug = new Map(posts.map((p) => [p.slug, p]));

  let applied = 0;
  let missing = 0;
  let failed = 0;

  for (const entry of taxonomy.posts) {
    const post = bySlug.get(entry.slug);
    if (!post) {
      console.warn(`  ⚠ no published post for slug: ${entry.slug}`);
      missing++;
      continue;
    }
    console.log(`  ${entry.slug} → [${entry.category}] ${entry.tags.join(", ")}`);
    if (!APPLY) continue;

    try {
      const res = await fetch(`${API_URL}/api/blog`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ id: post.id, category: entry.category, tags: entry.tags }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`    ✗ PATCH failed: ${res.status} ${detail.slice(0, 200)}`);
        failed++;
        continue;
      }
      applied++;
    } catch (err) {
      console.error(`    ✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(
    `[apply-taxonomy] ${APPLY ? `applied ${applied}` : `would apply ${taxonomy.posts.length - missing}`}` +
      `, missing ${missing}, failed ${failed}`,
  );
  if (APPLY && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
