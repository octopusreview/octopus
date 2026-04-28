import "server-only";
import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai-usage";
import { getEmbedModel } from "@/lib/ai-client";
import { isOrgOverSpendLimit } from "@/lib/cost";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return openai;
}

// text-embedding-3-large max: 8191 tokens per input
// Conservative limit: ~3 chars/token for code → 24000 chars stays safely under 8191 tokens
const MAX_EMBEDDING_CHARS = 24_000;

// OpenAI enforces a 300,000 token total-request cap for embeddings.
// Keep headroom: target ~200k. Dense content (lock files, .dts, hex blobs, CJK)
// can tokenize at ~2 chars/token, so ASCII gets chars/2 and non-ASCII counts as
// 1 token per char (CJK in cl100k/o200k often hits 1+ tokens per char).
const MAX_BATCH_TOKENS = 200_000;
const MAX_BATCH_ITEMS = 512;

function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 2) + other;
}

export async function createEmbeddings(
  texts: string[],
  tracking?: { organizationId: string; operation: string; repositoryId?: string },
): Promise<number[][]> {
  if (tracking?.organizationId && await isOrgOverSpendLimit(tracking.organizationId)) {
    console.warn(`[embeddings] Org ${tracking.organizationId} over spend limit — skipping embeddings`);
    return texts.map(() => []);
  }

  const client = getClient();
  const embedModel = tracking?.organizationId
    ? await getEmbedModel(tracking.organizationId, tracking.repositoryId)
    : "text-embedding-3-large";

  // Filter out empty/whitespace-only strings — OpenAI embeddings API rejects them
  const validTexts: string[] = [];
  const validIndexes: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const trimmed = texts[i]?.trim();
    if (trimmed) {
      validTexts.push(texts[i]);
      validIndexes.push(i);
    }
  }

  if (validTexts.length === 0) {
    return texts.map(() => []);
  }

  // Pre-truncate each input to the per-item char cap.
  const truncated = validTexts.map((t) =>
    t.length > MAX_EMBEDDING_CHARS ? t.slice(0, MAX_EMBEDDING_CHARS) : t,
  );

  const validVectors: number[][] = [];
  let totalPromptTokens = 0;

  // Send a batch, splitting in half on the 300k-token 400 error. Token estimates
  // can underestimate for dense content; this lets us recover without failing
  // the whole repo index over one bad batch.
  async function embedBatch(batch: string[]): Promise<void> {
    try {
      const res = await client.embeddings.create({ model: embedModel, input: batch });
      for (const item of res.data) validVectors.push(item.embedding);
      totalPromptTokens += res.usage.prompt_tokens;
    } catch (err) {
      const isTokenLimit =
        err instanceof OpenAI.APIError &&
        err.status === 400 &&
        /maximum request size|tokens per request/i.test(err.message);
      if (!isTokenLimit || batch.length <= 1) throw err;
      const mid = Math.floor(batch.length / 2);
      await embedBatch(batch.slice(0, mid));
      await embedBatch(batch.slice(mid));
    }
  }

  // Dynamic batching: stay under both MAX_BATCH_TOKENS and MAX_BATCH_ITEMS per request.
  let batchStart = 0;
  while (batchStart < truncated.length) {
    let batchTokens = 0;
    let batchEnd = batchStart;
    while (batchEnd < truncated.length && batchEnd - batchStart < MAX_BATCH_ITEMS) {
      const itemTokens = estimateTokens(truncated[batchEnd]);
      if (batchEnd > batchStart && batchTokens + itemTokens > MAX_BATCH_TOKENS) break;
      batchTokens += itemTokens;
      batchEnd++;
    }

    await embedBatch(truncated.slice(batchStart, batchEnd));
    batchStart = batchEnd;
  }

  // Map valid vectors back to original positions, empty array for filtered-out texts
  const vectors: number[][] = texts.map(() => []);
  for (let i = 0; i < validIndexes.length; i++) {
    vectors[validIndexes[i]] = validVectors[i];
  }

  if (tracking) {
    await logAiUsage({
      provider: "openai",
      model: embedModel,
      operation: tracking.operation,
      inputTokens: totalPromptTokens,
      outputTokens: 0,
      organizationId: tracking.organizationId,
    });
  }

  return vectors;
}
