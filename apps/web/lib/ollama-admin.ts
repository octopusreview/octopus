import "server-only";
import { prisma } from "@octopus/db";
import { normalizeServerUrl } from "./providers/ollama";
import { findCatalogEntry } from "./ollama-catalog";

/**
 * Admin-side Ollama model management: list installed models, stream a pull and
 * record its progress, register a completed model. Instance-level — Ollama is
 * one server per deployment (see the OllamaModelPull schema note).
 *
 * Unlike the review provider (which defaults to localhost), the management UI
 * requires OLLAMA_SERVER_URL to be *explicitly set*: the panel is meaningless
 * without a real server, and on the hosted SaaS the var is unset so the whole
 * feature stays hidden.
 */
export function isOllamaConfigured(): boolean {
  return !!process.env.OLLAMA_SERVER_URL?.trim();
}

/** Normalized origin of the configured server. Only call when isOllamaConfigured(). */
export function getOllamaBaseUrl(): string {
  const raw = process.env.OLLAMA_SERVER_URL?.trim();
  if (!raw) throw new Error("OLLAMA_SERVER_URL is not set");
  return normalizeServerUrl(raw);
}

function authHeaders(): Record<string, string> {
  const username = process.env.OLLAMA_USERNAME;
  if (!username) return {};
  const password = process.env.OLLAMA_PASSWORD ?? "";
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

/**
 * Models already present on the server (`GET /api/tags`). Returns null when the
 * server is unreachable, so the UI can tell "none installed" apart from
 * "can't reach Ollama".
 */
export async function listInstalledModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  } catch {
    return null;
  }
}

// The pull stream emits many progress lines per second; persist at most this
// often so a download doesn't hammer the DB with thousands of writes.
const PROGRESS_WRITE_INTERVAL_MS = 1500;

/**
 * Stream `POST /api/pull` and record progress into the OllamaModelPull row.
 *
 * Error handling is self-contained: on failure it writes status="failed" with
 * the message and returns (it does NOT throw), so the pg-boss worker never
 * retries a multi-GB download and the row stays the single source of truth the
 * UI polls. On success it registers the model in AvailableModel so it appears
 * in the model pickers right away.
 */
export async function runOllamaPull(model: string): Promise<void> {
  try {
    await prisma.ollamaModelPull.update({
      where: { model },
      data: { status: "pulling", statusText: "starting", progress: 0, error: null },
    });

    const res = await fetch(`${getOllamaBaseUrl()}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/pull returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastWrite = 0;
    let lastStatus = "";
    let lastProgress = 0;
    let success = false;

    const flush = async () => {
      const now = Date.now();
      if (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return;
      lastWrite = now;
      await prisma.ollamaModelPull.update({
        where: { model },
        data: { status: "pulling", statusText: lastStatus || null, progress: lastProgress },
      });
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt: { status?: string; error?: string; total?: number; completed?: number };
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (evt.error) throw new Error(evt.error);
        if (evt.status) {
          lastStatus = evt.status;
          if (evt.status === "success") success = true;
        }
        if (typeof evt.total === "number" && evt.total > 0 && typeof evt.completed === "number") {
          lastProgress = Math.min(100, Math.round((evt.completed / evt.total) * 100));
        }
        await flush();
      }
    }

    // Ollama ends a successful pull with {"status":"success"}. If the stream
    // closed without it (e.g. the connection dropped mid-download), treat it as
    // a failure rather than silently marking a partial model "completed".
    if (!success) throw new Error("pull ended before completion");

    await registerPulledModel(model);
    await prisma.ollamaModelPull.update({
      where: { model },
      data: { status: "completed", statusText: "ready", progress: 100, error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ollamaModelPull
      .update({ where: { model }, data: { status: "failed", error: message.slice(0, 500) } })
      .catch(() => {});
  }
}

/** Add a successfully-pulled curated model to AvailableModel (free, active). */
async function registerPulledModel(model: string): Promise<void> {
  const entry = findCatalogEntry(model);
  if (!entry) return; // only curated models are registered — stay defensive
  // Only register chat/LLM models in AvailableModel. Those route through
  // ai-router via the "ollama:" prefix and belong in the review-model picker.
  // Embedding models are configured exclusively via OCTOPUS_EMBED_* env, never
  // the picker — registering one would add a dropdown entry that's silently
  // ignored in Ollama-embed mode and fails if picked while on OpenAI
  // embeddings. The pulled model still shows as "Installed" via /api/tags.
  if (entry.category !== "llm") return;
  const modelId = `ollama:${entry.name}`;
  await prisma.availableModel.upsert({
    where: { modelId },
    create: {
      modelId,
      displayName: entry.displayName,
      provider: "ollama",
      category: entry.category,
      inputPrice: 0,
      outputPrice: 0,
      isActive: true,
    },
    update: { isActive: true, displayName: entry.displayName, category: entry.category },
  });
}
