/**
 * Apply a reviewed list of exact-text corrections to published blog posts,
 * through the authenticated blog API (no database access needed).
 *
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-edits.ts <edits.json>           # dry run
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-edits.ts <edits.json> --apply
 *     BLOG_API_TOKEN=... bun run apps/web/scripts/apply-blog-edits.ts <edits.json> --apply --clear-audio
 *
 * <edits.json> is a list of { "slug", "before", "after" }. Each `before` must
 * occur exactly once in its post (title, excerpt or body), or be recognized
 * as already applied by applyBlogEdits. Nothing is saved unless every edit
 * in the file can be placed or recognized as already applied.
 *
 * --clear-audio also removes the read-aloud recording of every post named in
 * the file, whether or not this run changes its text: a recording is not
 * remade when the text changes, so it keeps speaking the old wording. The
 * admin console then lists those posts as missing audio.
 *
 * Env: BLOG_API_TOKEN (required, needs blog:read and blog:update),
 *      OCTOPUS_API_URL (default https://octopus-review.ai).
 */
import { readFileSync } from "node:fs";
import { applyBlogEdits, type BlogEdit } from "../lib/blog-edits";

type ApiPost = { id: string; slug: string; title: string; excerpt: string | null; content: string; audioUrl?: string | null };

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  const clearAudio = process.argv.includes("--clear-audio");
  if (!file || file.startsWith("--")) {
    console.error("Usage: apply-blog-edits.ts <edits.json> [--apply] [--clear-audio]");
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

  const loadPublishedPosts = async () => {
    const found = new Map<string, ApiPost>();
    for (let page = 1; page <= 500; page++) {
      const res = await fetch(`${API_URL}/api/blog?status=published&includeContent=true&limit=50&page=${page}`, { headers });
      if (!res.ok) throw new Error(`GET /api/blog failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { posts?: ApiPost[]; pagination?: { totalPages?: number } };
      for (const post of data.posts ?? []) found.set(post.slug, post);
      const totalPages = Number(data.pagination?.totalPages);
      if (!Number.isFinite(totalPages) || page >= totalPages) break;
    }
    return found;
  };
  const posts = await loadPublishedPosts();

  // Place every edit first. One edit that cannot be placed stops the whole run.
  const updates: Array<{ post: ApiPost; changed: Record<string, string | null> }> = [];
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
    const changed: Record<string, string | null> = { ...result.changed };
    if (clearAudio && post.audioUrl) changed.audioUrl = null;
    const fields = Object.keys(changed);
    console.log(`  ${slug}: ${result.applied} to apply, ${result.alreadyApplied} already applied${fields.length ? ` (${fields.join(", ")})` : ""}`);
    if (fields.length) updates.push({ post, changed });
  }
  if (problems) {
    console.error(`${problems} edit(s) could not be placed. Nothing was saved.`);
    process.exit(1);
  }
  if (!apply) {
    console.log(`Dry run: ${updates.length} post(s) would be updated. Re-run with --apply to save.`);
    return;
  }
  let saved = 0;
  const stop = (message: string): never => {
    console.error(`${message}\n${saved} post(s) were saved before this one and stay saved. Run again to finish: edits already applied are skipped.`);
    process.exit(1);
  };
  for (const { post, changed } of updates) {
    // Read the post again just before saving. If someone edited or unpublished
    // it since the edits were placed, saving would overwrite their change.
    let current: ApiPost | undefined;
    try {
      current = (await loadPublishedPosts()).get(post.slug);
    } catch (error) {
      stop(`Could not re-read ${post.slug} before saving: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!current || current.title !== post.title || current.excerpt !== post.excerpt || current.content !== post.content) {
      stop(`${post.slug} was changed or unpublished after the edits were placed; it was not saved.`);
    }
    try {
      const res = await fetch(`${API_URL}/api/blog`, { method: "PATCH", headers, body: JSON.stringify({ id: post.id, ...changed }) });
      if (!res.ok) stop(`PATCH failed for ${post.slug}: ${res.status} ${res.statusText}\n${await res.text().catch(() => "")}`);
    } catch (error) {
      stop(`PATCH did not complete for ${post.slug} (it may or may not have been saved): ${error instanceof Error ? error.message : String(error)}`);
    }
    saved++;
    console.log(`✓ updated ${API_URL}/blog/${post.slug}`);
  }
  console.log(`Done: ${saved} post(s) updated.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
