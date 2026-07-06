import "server-only";

// App-side ElevenLabs text-to-speech for blog read-aloud. The app holds the API
// key and the selected voice, so audio is generated on demand from the admin UI
// (/admin/blog-audio) and the audioUrl is written straight to the DB.

const API_BASE = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_turbo_v2_5";
// ElevenLabs caps a single TTS request; stay well under and clip long posts.
export const MAX_TTS_CHARS = 9000;

const apiKey = process.env.ELEVENLABS_API_KEY;

export function isElevenLabsConfigured(): boolean {
  return Boolean(apiKey);
}

export type ElevenVoice = {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
};

/** List the account's available voices (for the admin voice picker). */
export async function listVoices(): Promise<ElevenVoice[]> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");
  const res = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey, accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs GET /voices failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    voices?: Array<{ voice_id: string; name: string; category?: string; preview_url?: string }>;
  };
  return (data.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category ?? null,
    previewUrl: v.preview_url ?? null,
  }));
}

/** Synthesize speech for `text` with `voiceId` → MP3 buffer. */
export async function synthesizeSpeech(text: string, voiceId: string): Promise<Buffer> {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");
  const res = await fetch(`${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Strip Markdown to readable prose for TTS (fenced/inline code, images, links,
 * heading markers, residual punctuation).
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
