import { notFound } from "next/navigation";
import { getSuperAdmin } from "@/lib/superadmin";
import { prisma } from "@octopus/db";
import { isElevenLabsConfigured, listVoices } from "@/lib/elevenlabs";
import { isR2Configured } from "@/lib/r2";
import { BlogAudioClient } from "./blog-audio-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog Read-Aloud — Octopus Admin" };

/**
 * /admin/blog-audio — pick an ElevenLabs voice and generate read-aloud MP3s for
 * published blog posts (app-side; replaces the cloud-CI generation path).
 * Super-admin (vendor) only, mirroring /admin/tokens & /admin/telemetry.
 */
export default async function BlogAudioPage() {
  if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true") notFound();
  const sa = await getSuperAdmin();
  if (!sa) notFound();

  const elevenConfigured = isElevenLabsConfigured();
  const r2Configured = isR2Configured();

  const [cfg, posts, voices] = await Promise.all([
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { blogAudioVoiceId: true },
    }),
    prisma.blogPost.findMany({
      where: { deletedAt: null, status: "published" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, slug: true, audioUrl: true },
    }),
    elevenConfigured ? listVoices().catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <BlogAudioClient
      elevenConfigured={elevenConfigured}
      r2Configured={r2Configured}
      selectedVoiceId={cfg?.blogAudioVoiceId ?? null}
      voices={voices}
      posts={posts}
    />
  );
}
