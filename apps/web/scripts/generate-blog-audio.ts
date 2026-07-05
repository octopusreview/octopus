/**
 * Generate read-aloud audio for published blog posts.
 *
 * Standalone script for cloud CI (GitHub Actions) — it has NO database access
 * and MUST NOT import prisma. It talks to the public authenticated blog API
 * (octopus-review.ai) over `fetch`, synthesizes speech with ElevenLabs, uploads
 * the MP3 to Cloudflare R2 with `@aws-sdk/client-s3`, and writes the resulting
 * `audioUrl` back through the API.
 *
 * For each published post WITHOUT an audioUrl:
 *   - strip Markdown to plain prose (truncated to a safe length for TTS)
 *   - ElevenLabs TTS  -> MP3 buffer
 *   - upload to R2     -> public URL  (key: blog-audio/<slug>.mp3)
 *   - PATCH /api/blog  -> persist audioUrl
 *
 * Per-post failures are isolated: one bad post never aborts the run.
 *
 * Env:
 *   OCTOPUS_API_URL        (default "https://octopus-review.ai")
 *   BLOG_API_TOKEN         Bearer token for the blog API (read + PATCH)
 *   ELEVENLABS_API_KEY     ElevenLabs API key
 *   ELEVENLABS_VOICE_ID    ElevenLabs voice id
 *   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 *   R2_PUBLIC_URL     public base for uploaded objects
 *
 * Usage:
 *   Dry run (default):  bun run --cwd apps/web scripts/generate-blog-audio.ts
 *   Apply changes:      bun run --cwd apps/web scripts/generate-blog-audio.ts --apply
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");

const API_URL = (process.env.OCTOPUS_API_URL || "https://octopus-review.ai").replace(/\/$/, "");
const BLOG_API_TOKEN = process.env.BLOG_API_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";
// ElevenLabs caps a single request; keep well under it and log when we clip.
const MAX_TTS_CHARS = 9000;

interface BlogPost {
  id: string;
  slug: string;
  content: string;
  audioUrl: string | null;
}

/**
 * Strip Markdown to readable prose for TTS. Mirrors the stripping in
 * lib/blog-reading.ts (fenced/inline code, images, links) but preserves
 * sentence text instead of reducing to a word count.
 */
function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code (backtick)
    .replace(/~~~[\s\S]*?~~~/g, " ") // fenced code (tilde)
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> keep text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
    .replace(/[*_~>|]/g, " ") // residual md punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/** GET every published post, following pagination. */
async function fetchPublishedPosts(): Promise<BlogPost[]> {
  const posts: BlogPost[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(
      `${API_URL}/api/blog?status=published&includeContent=true&limit=50&page=${page}`,
      { headers: { authorization: `Bearer ${BLOG_API_TOKEN}` } },
    );
    if (!res.ok) {
      throw new Error(`GET /api/blog failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      posts?: BlogPost[];
      pagination?: { totalPages?: number };
    };
    totalPages = Number(data?.pagination?.totalPages);
    if (!Array.isArray(data.posts) || !Number.isFinite(totalPages)) {
      throw new Error(`Unexpected /api/blog response shape on page ${page}`);
    }
    posts.push(...data.posts);
    page++;
  } while (page <= totalPages && page <= 500);

  return posts;
}

/** ElevenLabs TTS via REST -> MP3 buffer. */
async function synthesizeSpeech(text: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

let r2Client: S3Client | null = null;
function getR2Client(): S3Client {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return r2Client;
}

/** Upload an MP3 to R2 and return its public URL. */
async function uploadMp3(key: string, body: Buffer): Promise<string> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

/** PATCH the post's audioUrl through the authenticated blog API. */
async function patchAudioUrl(id: string, audioUrl: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/blog`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${BLOG_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, audioUrl }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PATCH /api/blog failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    );
  }
}

async function main() {
  console.log(`[blog-audio] Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`[blog-audio] API: ${API_URL}`);

  // Reading posts requires the token in every mode.
  if (!BLOG_API_TOKEN) {
    console.error("[blog-audio] BLOG_API_TOKEN is required.");
    process.exit(1);
  }
  // Generation/upload/write-back credentials are only needed with --apply.
  if (APPLY) {
    const missing = Object.entries({
      ELEVENLABS_API_KEY,
      ELEVENLABS_VOICE_ID,
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_BUCKET,
      R2_PUBLIC_URL,
    })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      console.error(`[blog-audio] Missing required env for --apply: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  const posts = await fetchPublishedPosts();
  const pending = posts.filter((p) => !p.audioUrl);
  const skipped = posts.length - pending.length;
  console.log(
    `[blog-audio] ${posts.length} published, ${skipped} already have audio, ${pending.length} to process\n`,
  );

  let generated = 0;
  let failed = 0;

  for (const post of pending) {
    try {
      const key = `blog-audio/${post.slug}.mp3`;
      const text = markdownToPlainText(post.content);
      const truncated = text.length > MAX_TTS_CHARS;
      const finalText = truncated ? text.slice(0, MAX_TTS_CHARS) : text;
      if (truncated) {
        console.log(
          `[blog-audio] ${post.slug}: content ${text.length} chars, truncated to ${MAX_TTS_CHARS}`,
        );
      }

      if (!APPLY) {
        console.log(
          `[blog-audio] ${post.slug}: (dry-run) would synthesize ${finalText.length} chars -> ${key} -> PATCH audioUrl`,
        );
        continue;
      }

      console.log(`[blog-audio] ${post.slug}: synthesizing ${finalText.length} chars...`);
      const mp3 = await synthesizeSpeech(finalText);
      const url = await uploadMp3(key, mp3);
      await patchAudioUrl(post.id, url);
      console.log(`[blog-audio] ${post.slug}: done -> ${url}`);
      generated++;
    } catch (err) {
      failed++;
      console.error(
        `[blog-audio] ${post.slug}: FAILED -`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`\n[blog-audio] Done.`);
  console.log(`  Published:         ${posts.length}`);
  console.log(`  Already had audio: ${skipped}`);
  if (APPLY) {
    console.log(`  Generated:         ${generated}`);
    console.log(`  Failed:            ${failed}`);
  } else {
    console.log(`  Would process:     ${pending.length}`);
    console.log(`\n[blog-audio] Dry run complete. Re-run with --apply to generate audio.`);
  }

  // Surface partial failures to CI without having aborted the loop.
  if (APPLY && failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[blog-audio] Fatal error:", err);
  process.exit(1);
});
