import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import {
  isElevenLabsConfigured,
  listVoices,
  synthesizeSpeech,
  markdownToPlainText,
  MAX_TTS_CHARS,
} from "@/lib/elevenlabs";
import { isR2Configured, uploadToR2 } from "@/lib/r2";

// Machine auth: shared ADMIN_API_SECRET bearer. The admin UI lives in the
// octopus-configuration console and calls this via lib/octopus-api.ts.
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

/** State for the admin UI: config flags, selected voice, voices, and posts. */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const elevenConfigured = isElevenLabsConfigured();
  const r2Configured = isR2Configured();

  const [cfg, posts] = await Promise.all([
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { blogAudioVoiceId: true },
    }),
    prisma.blogPost.findMany({
      where: { deletedAt: null, status: "published" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, slug: true, audioUrl: true },
    }),
  ]);

  let voices: Awaited<ReturnType<typeof listVoices>> = [];
  let voicesError = false;
  if (elevenConfigured) {
    try {
      voices = await listVoices();
    } catch {
      voicesError = true;
    }
  }

  return NextResponse.json({
    elevenConfigured,
    r2Configured,
    voicesError,
    selectedVoiceId: cfg?.blogAudioVoiceId ?? null,
    voices,
    posts,
  });
}

/** Actions: save-voice | generate | clear. */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "save-voice") {
    const voiceId = String(body.voiceId ?? "").trim();
    if (!voiceId) return NextResponse.json({ error: "voiceId required" }, { status: 400 });
    await prisma.systemConfig.upsert({
      where: { id: "singleton" },
      update: { blogAudioVoiceId: voiceId },
      create: { id: "singleton", blogAudioVoiceId: voiceId },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "clear") {
    const postId = String(body.postId ?? "");
    const post = await prisma.blogPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    await prisma.blogPost.update({ where: { id: post.id }, data: { audioUrl: null } });
    return NextResponse.json({ ok: true });
  }

  if (action === "generate") {
    if (!isElevenLabsConfigured())
      return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured." }, { status: 400 });
    if (!isR2Configured())
      return NextResponse.json({ error: "R2 is not configured." }, { status: 400 });

    const cfg = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { blogAudioVoiceId: true },
    });
    const voiceId = cfg?.blogAudioVoiceId;
    if (!voiceId) return NextResponse.json({ error: "Select and save a voice first." }, { status: 400 });

    const postId = String(body.postId ?? "");
    const post = await prisma.blogPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, slug: true, content: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const text = markdownToPlainText(post.content).slice(0, MAX_TTS_CHARS);
    if (!text) return NextResponse.json({ error: "Post has no readable text" }, { status: 400 });

    try {
      const mp3 = await synthesizeSpeech(text, voiceId);
      // Stable per-slug key served immutable + max-age=1y; append a version
      // query param so a regenerate busts the CDN/browser cache.
      const baseUrl = await uploadToR2(`blog-audio/${post.slug}.mp3`, mp3, "audio/mpeg");
      const url = `${baseUrl}?v=${Date.now()}`;
      await prisma.blogPost.update({ where: { id: post.id }, data: { audioUrl: url } });
      console.log(`[admin] blog-audio generate post=${post.id} slug=${post.slug} bytes=${mp3.length}`);
      return NextResponse.json({ ok: true, audioUrl: url });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
