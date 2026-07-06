"use server";

import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";
import { getSuperAdmin } from "@/lib/superadmin";
import {
  isElevenLabsConfigured,
  markdownToPlainText,
  synthesizeSpeech,
  MAX_TTS_CHARS,
} from "@/lib/elevenlabs";
import { isR2Configured, uploadToR2 } from "@/lib/r2";

// Super-admin is re-checked inside EVERY action (defense in depth — the page
// gate alone is not sufficient for state-changing operations).

export async function saveBlogAudioVoice(
  voiceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sa = await getSuperAdmin();
  if (!sa) return { ok: false, error: "Forbidden" };
  const v = String(voiceId).trim();
  if (!v) return { ok: false, error: "Pick a voice first." };

  await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    update: { blogAudioVoiceId: v },
    create: { id: "singleton", blogAudioVoiceId: v },
  });
  revalidatePath("/admin/blog-audio");
  console.log(`[blog-audio] actor=${sa.id} action=save-voice voice=${v}`);
  return { ok: true };
}

export async function generateBlogAudio(
  postId: string,
): Promise<{ ok: true; audioUrl: string } | { ok: false; error: string }> {
  const sa = await getSuperAdmin();
  if (!sa) return { ok: false, error: "Forbidden" };
  if (!isElevenLabsConfigured())
    return { ok: false, error: "ELEVENLABS_API_KEY is not configured on the server." };
  if (!isR2Configured())
    return { ok: false, error: "R2 is not configured on the server." };

  const cfg = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { blogAudioVoiceId: true },
  });
  const voiceId = cfg?.blogAudioVoiceId;
  if (!voiceId) return { ok: false, error: "Select and save a voice first." };

  const post = await prisma.blogPost.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true, slug: true, content: true },
  });
  if (!post) return { ok: false, error: "Post not found." };

  const text = markdownToPlainText(post.content).slice(0, MAX_TTS_CHARS);
  if (!text) return { ok: false, error: "Post has no readable text." };

  try {
    const mp3 = await synthesizeSpeech(text, voiceId);
    // The R2 object lives at a stable per-slug key and is served immutable +
    // max-age=1y, so regenerating overwrites it in place at the SAME URL. Append
    // a version query param to the STORED url so the CDN/browser fetch a fresh
    // copy and the <audio key={url}> element remounts after a regenerate.
    const baseUrl = await uploadToR2(`blog-audio/${post.slug}.mp3`, mp3, "audio/mpeg");
    const url = `${baseUrl}?v=${Date.now()}`;
    await prisma.blogPost.update({ where: { id: post.id }, data: { audioUrl: url } });
    revalidatePath("/admin/blog-audio");
    revalidatePath(`/blog/${post.slug}`);
    console.log(
      `[blog-audio] actor=${sa.id} action=generate post=${post.id} slug=${post.slug} voice=${voiceId} bytes=${mp3.length}`,
    );
    return { ok: true, audioUrl: url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function clearBlogAudio(postId: string): Promise<{ ok: boolean }> {
  const sa = await getSuperAdmin();
  if (!sa) return { ok: false };
  const post = await prisma.blogPost.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (!post) return { ok: false };
  await prisma.blogPost.update({ where: { id: post.id }, data: { audioUrl: null } });
  revalidatePath("/admin/blog-audio");
  revalidatePath(`/blog/${post.slug}`);
  return { ok: true };
}
