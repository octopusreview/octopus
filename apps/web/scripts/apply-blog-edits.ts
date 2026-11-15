/**
 * Apply a reviewed list of exact-text corrections to published blog posts,
 * through the authenticated blog API (no database access needed).
 *
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-edits.ts <edits.json>           # dry run
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-edits.ts <edits.json> --apply
 *
 * <edits.json> is a list of { "slug", "before", "after" }. Each `before` must
 * occur exactly once in its post (title, excerpt or body). Nothing is saved
 * unless every edit in the file can be placed; a second run changes nothing.
 *
 * Env: BLOG_API_TOKEN (required, needs blog:read and blog:update),
 *      OCTOPUS_API_URL (default https://octopus-review.ai).
 */
import { readFileSync } from "node:fs";
import { applyBlogEdits, type BlogEdit } from "../lib/blog-edits";

type ApiPost = { id: string; slug: string; title: string; excerpt: string | null; content: string };

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file || file.startsWith("--")) {
    console.error("Usage: apply-blog-edits.ts <edits.json> [--apply]");
    process.exit(1);
  }
  const TOKEN = process.env.BLOG_API_TOKEN;
  if (!TOKEN) {
    console.error("BLOG_API_TOKEN is required.");
    process.exit(1);
  }
  const API_URL = (process.env.OCTOPUS_API_URL ?? "https://octopus-review.ai").replace(/\/$/, "");
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  const edits: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(edits) || !edits.every((edit) =>
    edit !== null && typeof edit === "object" &&
    typeof edit.slug === "string" && edit.slug.length > 0 &&
    typeof edit.before === "string" && edit.before.length > 0 &&
    typeof edit.after === "string"
  )) throw new Error("Edits must be a list of entries with a nonempty slug and before, and a string after.");
  const bySlug = new Map<string, BlogEdit[]>();
  for (const edit of edits) bySlug.set(edit.slug, [...(bySlug.get(edit.slug) ?? []), edit]);
  console.log(`[blog-edits] ${apply ? "APPLY" : "DRY RUN (nothing is saved)"} · ${API_URL} · ${edits.length} edits in ${bySlug.size} posts`);

  const posts = new Map<string, ApiPost>();
  for (let page = 1; page <= 500; page++) {
    const res = await fetch(`${API_URL}/api/blog?status=published&includeContent=true&limit=50&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GET /api/blog failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { posts?: ApiPost[]; pagination?: { totalPages?: number } };
    for (const post of data.posts ?? []) posts.set(post.slug, post);
    const totalPages = Number(data.pagination?.totalPages);
    if (!Number.isFinite(totalPages) || page >= totalPages) break;
  }

  // Place every edit first. One edit that cannot be placed stops the whole run.
  const updates: Array<{ post: ApiPost; changed: Record<string, string> }> = [];
  let problems = 0;
  for (const [slug, postEdits] of bySlug) {
    const post = posts.get(slug);
    if (!post) {
      problems++;
      console.error(`✗ ${slug}: no published post with this slug`);
      continue;
    }
    const result = applyBlogEdits(post, postEdits);
    for (const problem of result.problems) console.error(`✗ ${slug}: ${problem}`);
    problems += result.problems.length;
    const fields = Object.keys(result.changed);
    console.log(`  ${slug}: ${result.applied} to apply, ${result.alreadyApplied} already applied${fields.length ? ` (${fields.join(", ")})` : ""}`);
    if (fields.length) updates.push({ post, changed: result.changed });
  }
  if (problems) {
    console.error(`${problems} edit(s) could not be placed. Nothing was saved.`);
    process.exit(1);
  }
  if (!apply) {
    console.log(`Dry run: ${updates.length} post(s) would be updated. Re-run with --apply to save.`);
    return;
  }
  for (const { post, changed } of updates) {
    const res = await fetch(`${API_URL}/api/blog`, { method: "PATCH", headers, body: JSON.stringify({ id: post.id, ...changed }) });
    if (!res.ok) {
      console.error(`PATCH failed for ${post.slug}: ${res.status} ${res.statusText}\n${await res.text()}\nPosts before this one were saved; run again to finish.`);
      process.exit(1);
    }
    console.log(`✓ updated ${API_URL}/blog/${post.slug}`);
  }
  console.log(`Done: ${updates.length} post(s) updated.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
