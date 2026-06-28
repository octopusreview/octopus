import "server-only";
import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai-usage";
import { getEmbedModel } from "@/lib/ai-client";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { getEmbedConfig, type EmbedConfig } from "@/lib/embed-config";
import { validateProviderUrl } from "@/lib/providers/url-validation";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openai;
}

// Provider-agnostic per-input char cap. Picked low enough for both providers'
// per-input token limits (OpenAI's 8191 for text-embedding-3-large, Ollama's
// effective ~8k for nomic-embed-text). ~3 chars/token in code stays safely
// under the smaller of those.
const MAX_EMBEDDING_CHARS = 24_000;

// Batching is provider-specific: OpenAI accepts large multi-item requests
// (constrained by token + item ceilings); Ollama processes synchronously
// per call, so we send modest fixed-size batches for timeout safety on
// CPU-only setups. Constants for each path live next to the path that
// uses them, not at module scope.

function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i)!;
    if (code < 128) ascii++;
    else other++;
    i += code > 0xffff ? 2 : 1;
  }
  return Math.ceil(ascii / 2) + other;
}

/**
 * Embed an array of input texts using the configured provider (OpenAI or
 * Ollama). Provider selection is process-wide via `OCTOPUS_EMBED_PROVIDER`
 * + friends — see `embed-config.ts`. Returns one vector per input; empty
 * arrays for inputs that were filtered out (whitespace-only, etc.) so
 * callers can keep the input → output positional mapping.
 *
 * Empty inputs are filtered before the API call because both providers
 * reject blank strings (OpenAI returns 400, Ollama returns a malformed
 * response). The mapping back to original positions happens at the bottom.
 *
 * `tracking` is for ai_usage rows + the spend-limit gate. When omitted
 * (system-level embeddings outside any org), the usage row is skipped and
 * the spend gate doesn't apply.
 */
export async function createEmbeddings(
  texts: string[],
  tracking?: { organizationId: string; operation: string; repositoryId?: string },
): Promise<number[][]> {
  if (tracking?.organizationId && (await isOrgOverSpendLimit(tracking.organizationId))) {
    console.warn(`[embeddings] Org ${tracking.organizationId} over spend limit — skipping embeddings`);
    return texts.map(() => []);
  }

  const baseConfig = getEmbedConfig();

  // Per-org / per-repo embed-model override beats the env default — but ONLY
  // for OpenAI. The `getEmbedModel` chain (Repository.embedModelId →
  // Organization.defaultEmbedModelId → platform default → text-embedding-3-large)
  // ALWAYS returns a non-empty string, so applying it in Ollama mode would send
  // an OpenAI model name to Ollama's /api/embed and fail. In Ollama mode the
  // env-configured model (OCTOPUS_EMBED_MODEL) always wins; system-level
  // embeddings (no org context) also use the env model.
  //
  // Caveat: an OpenAI org-level override must produce vectors with the same dim
  // as the global Qdrant collection. Mismatched dim is rejected explicitly
  // below with an actionable message instead of a cryptic Qdrant 400. Hosters
  // who want per-org dims would need per-org collections — out of scope here.
  let model = baseConfig.model;
  if (tracking?.organizationId && baseConfig.provider !== "ollama") {
    const resolved = await getEmbedModel(tracking.organizationId, tracking.repositoryId);
    if (resolved) model = resolved;
  }
  const config: EmbedConfig = { ...baseConfig, model };

  const { validTexts, validIndexes } = filterAndTruncate(texts);
  if (validTexts.length === 0) {
    return texts.map(() => []);
  }

  const { vectors: validVectors, promptTokens } =
    config.provider === "ollama"
      ? await embedWithOllama(validTexts, config)
      : await embedWithOpenAI(validTexts, config);

  // Map valid vectors back to original positions; empty array for filtered-out.
  const out: number[][] = texts.map(() => []);
  for (let i = 0; i < validIndexes.length; i++) {
    out[validIndexes[i]] = validVectors[i];
  }

  if (tracking) {
    await logAiUsage({
      provider: config.provider,
      model: config.model,
      operation: tracking.operation,
      inputTokens: promptTokens,
      outputTokens: 0,
      organizationId: tracking.organizationId,
    });
  }

  return out;
}

function filterAndTruncate(texts: string[]): { validTexts: string[]; validIndexes: number[] } {
  const validTexts: string[] = [];
  const validIndexes: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const trimmed = texts[i]?.trim();
    if (!trimmed) continue;
    validTexts.push(
      texts[i].length > MAX_EMBEDDING_CHARS ? texts[i].slice(0, MAX_EMBEDDING_CHARS) : texts[i],
    );
    validIndexes.push(i);
  }
  return { validTexts, validIndexes };
}

// OpenAI batching ceilings — 300k total tokens per request, 512 items per
// call. Conservative target leaves headroom for tokenization variance
// (dense content like lockfiles or CJK tokenize at ~2 chars/token in
// cl100k/o200k tokenizers).
const OPENAI_MAX_BATCH_TOKENS = 200_000;
const OPENAI_MAX_BATCH_ITEMS = 512;

async function embedWithOpenAI(
  texts: string[],
  config: EmbedConfig,
): Promise<{ vectors: number[][]; promptTokens: number }> {
  const client = getOpenAIClient();
  const vectors: number[][] = [];
  let promptTokens = 0;

  async function embedBatch(batch: string[]): Promise<void> {
    // For text-embedding-3-* models OpenAI accepts an explicit
    // `dimensions` arg and returns vectors at that length. Pass
    // config.dim through so an org override (eg. 1536 for compact
    // storage) actually takes effect instead of defaulting to the
    // model's native dim and producing a Qdrant 400 at upsert time.
    // Older embedding models reject the field, so only opt in for
    // the v3 family.
    const supportsDimensionsArg = config.model.startsWith("text-embedding-3-");
    let res;
    try {
      res = await client.embeddings.create({
        model: config.model,
        input: batch,
        ...(supportsDimensionsArg ? { dimensions: config.dim } : {}),
      });
    } catch (err) {
      // The split-on-token-limit recovery applies ONLY to OpenAI's
      // "request too large" 400, never to any other error. Anything
      // else (auth, network, our own dim-mismatch below) propagates
      // up unchanged.
      const isTokenLimit =
        err instanceof OpenAI.APIError &&
        err.status === 400 &&
        /maximum request size|tokens per request/i.test(err.message);
      if (!isTokenLimit || batch.length <= 1) throw err;
      const mid = Math.floor(batch.length / 2);
      await embedBatch(batch.slice(0, mid));
      await embedBatch(batch.slice(mid));
      return;
    }
    // Dim-mismatch check lives OUTSIDE the try above so the split-retry
    // catch can't accidentally swallow / retry it. A misconfigured
    // OCTOPUS_EMBED_DIM should fail loud and bubble to the caller, not
    // get bisected into smaller and smaller still-wrong batches.
    if (res.data.length > 0) {
      const gotDim = res.data[0].embedding.length;
      if (gotDim !== config.dim) {
        throw new Error(
          `OpenAI embeddings dim mismatch: model "${config.model}" returned ` +
            `${gotDim}-dim vectors, but OCTOPUS_EMBED_DIM is ${config.dim}. ` +
            `Set OCTOPUS_EMBED_DIM=${gotDim} (and wipe Qdrant collections so they get re-created).`,
        );
      }
    }
    for (const item of res.data) vectors.push(item.embedding);
    promptTokens += res.usage.prompt_tokens;
  }

  let batchStart = 0;
  while (batchStart < texts.length) {
    let batchTokens = 0;
    let batchEnd = batchStart;
    while (batchEnd < texts.length && batchEnd - batchStart < OPENAI_MAX_BATCH_ITEMS) {
      const itemTokens = estimateTokens(texts[batchEnd]);
      if (batchEnd > batchStart && batchTokens + itemTokens > OPENAI_MAX_BATCH_TOKENS) break;
      batchTokens += itemTokens;
      batchEnd++;
    }
    await embedBatch(texts.slice(batchStart, batchEnd));
    batchStart = batchEnd;
  }

  return { vectors, promptTokens };
}

// Ollama processes embedding requests synchronously per call; large batches
// would slow first-response wall time without saving wall time overall.
// 64-item chunks keep each call well under typical timeout thresholds on
// CPU-only setups.
const OLLAMA_BATCH_ITEMS = 64;

/**
 * Call Ollama's /api/embed in modest batches. Ollama doesn't return usage
 * accounting, so `promptTokens` is estimated client-side for the ai_usage
 * row. The estimate undershoots — embedding is free for self-hosters anyway,
 * so the metric is only useful for relative cost across repos.
 */
async function embedWithOllama(
  texts: string[],
  config: EmbedConfig,
): Promise<{ vectors: number[][]; promptTokens: number }> {
  if (!config.ollamaBaseUrl) {
    throw new Error("Ollama embeddings selected but OCTOPUS_OLLAMA_BASE_URL not configured");
  }
  // Defense-in-depth: even though the URL is operator-controlled via env
  // (low SSRF risk), route it through the same validator the per-org BYOK
  // path uses. `hosted: false` mirrors the `SELF_HOSTED` env default and
  // allows localhost / RFC1918 destinations for self-hosters.
  const safeBaseUrl = validateProviderUrl(config.ollamaBaseUrl, {
    hosted: process.env.SELF_HOSTED !== "true",
  });
  const vectors: number[][] = [];
  let promptTokens = 0;

  for (let i = 0; i < texts.length; i += OLLAMA_BATCH_ITEMS) {
    const batch = texts.slice(i, i + OLLAMA_BATCH_ITEMS);
    const res = await fetch(`${safeBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, input: batch }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Ollama embeddings HTTP ${res.status} from ${safeBaseUrl}/api/embed: ${detail.slice(0, 200)}`,
      );
    }
    const j = (await res.json()) as { embeddings?: number[][]; embedding?: number[] };
    // /api/embed returns `embeddings`; the older /api/embeddings returned `embedding`
    // (singular). Accept both shapes — keeps us forward-compatible if a self-hoster
    // is on an older Ollama build.
    const got = j.embeddings ?? (j.embedding ? [j.embedding] : null);
    if (!got || got.length !== batch.length) {
      throw new Error(
        `Ollama embeddings: expected ${batch.length} vectors, got ${got?.length ?? 0}. ` +
          `Check that model "${config.model}" is pulled (ollama pull ${config.model}).`,
      );
    }
    if (got[0].length !== config.dim) {
      throw new Error(
        `Ollama embeddings dim mismatch: model "${config.model}" returned ` +
          `${got[0].length}-dim vectors, but OCTOPUS_EMBED_DIM is ${config.dim}. ` +
          `Set OCTOPUS_EMBED_DIM=${got[0].length} (and wipe Qdrant collections so they get re-created).`,
      );
    }
    vectors.push(...got);
    for (const t of batch) promptTokens += estimateTokens(t);
  }

  return { vectors, promptTokens };
}
