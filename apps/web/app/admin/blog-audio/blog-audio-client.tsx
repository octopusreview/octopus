"use client";

import { useState, useTransition } from "react";
import {
  saveBlogAudioVoice,
  generateBlogAudio,
  clearBlogAudio,
} from "./actions";

type Voice = { voiceId: string; name: string; category: string | null; previewUrl: string | null };
type Post = { id: string; title: string; slug: string; audioUrl: string | null };

export function BlogAudioClient({
  elevenConfigured,
  r2Configured,
  voicesError,
  selectedVoiceId,
  voices,
  posts,
}: {
  elevenConfigured: boolean;
  r2Configured: boolean;
  voicesError: boolean;
  selectedVoiceId: string | null;
  voices: Voice[];
  posts: Post[];
}) {
  const [pending, startTransition] = useTransition();
  const [voice, setVoice] = useState(selectedVoiceId ?? "");
  const [savedVoice, setSavedVoice] = useState(selectedVoiceId ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPost, setBusyPost] = useState<string | null>(null);
  // Local audioUrl overrides so the row updates without a full reload.
  const [audio, setAudio] = useState<Record<string, string | null>>(
    Object.fromEntries(posts.map((p) => [p.id, p.audioUrl])),
  );

  const ready = elevenConfigured && r2Configured;
  const preview = voices.find((v) => v.voiceId === voice)?.previewUrl ?? null;

  function onSaveVoice() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveBlogAudioVoice(voice);
      if (res.ok) {
        setSavedVoice(voice);
        setNotice("Voice saved.");
      } else setError(res.error);
    });
  }

  function onGenerate(postId: string) {
    setError(null);
    setNotice(null);
    setBusyPost(postId);
    startTransition(async () => {
      const res = await generateBlogAudio(postId);
      setBusyPost(null);
      if (res.ok) {
        setAudio((a) => ({ ...a, [postId]: res.audioUrl }));
        setNotice("Audio generated.");
      } else setError(res.error);
    });
  }

  function onClear(postId: string) {
    setError(null);
    setBusyPost(postId);
    startTransition(async () => {
      const res = await clearBlogAudio(postId);
      setBusyPost(null);
      if (res.ok) setAudio((a) => ({ ...a, [postId]: null }));
      else setError("Failed to clear audio.");
    });
  }

  const withAudio = posts.filter((p) => audio[p.id]).length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-[#ddd]">
      <h1 className="text-2xl font-bold text-white">Blog Read-Aloud</h1>
      <p className="mt-2 text-sm text-[#888]">
        Pick an ElevenLabs voice, then generate a read-aloud MP3 for each
        published post. Audio is stored in R2 and played on the public blog.
      </p>

      {/* Config warnings */}
      {!elevenConfigured && (
        <Banner tone="warn">
          <code>ELEVENLABS_API_KEY</code> is not set on the server — add it to the
          app environment (then re-deploy with a stack re-apply) to enable voice
          listing and generation.
        </Banner>
      )}
      {!r2Configured && (
        <Banner tone="warn">
          R2 is not configured — generated audio can’t be uploaded until the{" "}
          <code>R2_*</code> variables are set.
        </Banner>
      )}
      {elevenConfigured && voicesError && (
        <Banner tone="error">
          Couldn’t load voices from ElevenLabs — the key may be invalid or the
          API is unreachable. Generation is disabled until voices load.
        </Banner>
      )}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {/* Voice picker */}
      <section className="mt-8 rounded-lg border border-white/[0.08] p-5">
        <h2 className="font-semibold text-white">Voice</h2>
        {elevenConfigured ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="rounded border border-white/[0.1] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#10D8BE]/50"
              >
                <option value="">— select a voice —</option>
                {voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                    {v.category ? ` (${v.category})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onSaveVoice}
                disabled={pending || !voice || voice === savedVoice}
                className="rounded-full bg-[#10D8BE] px-4 py-2 text-sm font-medium text-[#0c0c0c] disabled:opacity-50"
              >
                {voice === savedVoice && voice ? "Saved" : "Save voice"}
              </button>
            </div>
            {preview && (
              <audio key={preview} controls src={preview} className="mt-3 h-9 w-full max-w-sm">
                <track kind="captions" />
              </audio>
            )}
            {savedVoice && (
              <p className="mt-2 text-xs text-[#666]">
                Active voice for generation:{" "}
                <span className="text-[#aaa]">
                  {voices.find((v) => v.voiceId === savedVoice)?.name ?? savedVoice}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-[#666]">
            Configure <code>ELEVENLABS_API_KEY</code> to list and select voices.
          </p>
        )}
      </section>

      {/* Posts */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-semibold text-white">Published posts</h2>
        <span className="text-xs text-[#666]">
          {withAudio}/{posts.length} have audio
        </span>
      </div>
      {posts.length === 0 ? (
        <p className="mt-2 text-sm text-[#666]">No published posts.</p>
      ) : (
        <div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
          {posts.map((p) => {
            const url = audio[p.id];
            const busy = busyPost === p.id && pending;
            return (
              <div key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">{p.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    {url ? (
                      <span className="text-[#10D8BE]">● has audio</span>
                    ) : (
                      <span className="text-[#666]">○ no audio</span>
                    )}
                    <code className="truncate text-[#555]">{p.slug}</code>
                  </div>
                  {url && (
                    <audio key={url} controls src={url} className="mt-2 h-8 w-full max-w-xs">
                      <track kind="captions" />
                    </audio>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onGenerate(p.id)}
                    disabled={!ready || !savedVoice || pending}
                    title={!savedVoice ? "Save a voice first" : undefined}
                    className="rounded border border-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-40"
                  >
                    {busy ? "Generating…" : url ? "Regenerate" : "Generate"}
                  </button>
                  {url && (
                    <button
                      type="button"
                      onClick={() => onClear(p.id)}
                      disabled={pending}
                      className="rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-[#10D8BE]/40 bg-[#10D8BE]/[0.06] text-[#10D8BE]"
      : tone === "error"
        ? "border-red-500/30 bg-red-500/[0.06] text-red-300"
        : "border-yellow-500/30 bg-yellow-500/[0.06] text-yellow-200";
  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${cls}`}>{children}</div>
  );
}
