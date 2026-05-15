import "server-only";
import OpenAI from "openai";
import { logAiUsage } from "@/lib/ai-usage";
import { getEmbedModel } from "@/lib/ai-client";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { config as dbxConfig } from "@/lib/databricks/config";

// Embeddings client targets the Databricks **AI Gateway** OpenAI-compatible
// route at `${host}/ai-gateway/openai/v1`, authenticated with a workspace
// Gateway API key (DATABRICKS_GATEWAY_TOKEN). The Gateway forwards to
// OpenAI's text-embedding-3-large upstream. For local dev (no DATABRICKS_HOST
// set), fall back to direct OpenAI calls with OPENAI_API_KEY.

async function getClient(): Promise<OpenAI> {
  if (dbxConfig.isDatabricksRuntime) {
    const token = process.env.DATABRICKS_GATEWAY_TOKEN;
    if (!token) {
      throw new Error(
        "DATABRICKS_GATEWAY_TOKEN is missing — generate one in Databricks UI " +
          "(Compute → External Agents → Other Integrations → Generate API Key) " +
          "and push it to the octopus-octopus-ai secret scope.",
      );
    }
    return new OpenAI({
      apiKey: token,
      baseURL: `${dbxConfig.host}/ai-gateway/openai/v1`,
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
}

// text-embedding-3-large max: 8191 tokens per input
// Conservative limit: ~3 chars/token for code → 24000 chars stays safely under 8191 tokens
const MAX_EMBEDDING_CHARS = 24_000;

// OpenAI enforces a 300,000 token total-request cap for embeddings.
// Databricks AI Gateway's `databricks-gte-large-en` enforces a stricter
// 150-input cap. Cap at 128 so we keep headroom and the same code works
// against either backend.
// Dense content (lock files, .dts, hex blobs, CJK) can tokenize at
// ~2 chars/token, so ASCII gets chars/2 and non-ASCII counts as 1 token
// per char (CJK in cl100k/o200k often hits 1+ tokens per char).
const MAX_BATCH_TOKENS = 200_000;
const MAX_BATCH_ITEMS = process.env.DATABRICKS_HOST ? 128 : 512;

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

export async function createEmbeddings(
  texts: string[],
  tracking?: { organizationId: string; operation: string; repositoryId?: string },
): Promise<number[][]> {
  if (tracking?.organizationId && await isOrgOverSpendLimit(tracking.organizationId)) {
    console.warn(`[embeddings] Org ${tracking.organizationId} over spend limit — skipping embeddings`);
    return texts.map(() => []);
  }

  const client = await getClient();
  // On Databricks AI Gateway the embedding endpoint is `databricks-gte-large-en`
  // (1024-dim). For local-dev (no DATABRICKS_HOST), fall back to OpenAI's
  // text-embedding-3-large per the org's configured model. The VS indexes are
  // sized to 1024 to match GTE-Large-EN — switching to a different upstream
  // requires re-creating the indexes at the new dimension.
  const embedModel = dbxConfig.isDatabricksRuntime
    ? "databricks-gte-large-en"
    : tracking?.organizationId
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
      // Force `encoding_format: "float"` — the OpenAI SDK requests base64 by
      // default and decodes it as little-endian Float32Array. Databricks AI
      // Gateway returns base64 in a format that the SDK was decoding as a
      // larger float width (giving 256-dim instead of the actual 1024-dim
      // GTE-Large-EN output). Asking for "float" returns a plain JSON array
      // and avoids the decode mismatch entirely.
      const res = await client.embeddings.create({
        model: embedModel,
        input: batch,
        encoding_format: "float",
      });
      for (const item of res.data) {
        const v = item.embedding;
        if (Array.isArray(v)) {
          validVectors.push(v);
        } else if (typeof v === "string") {
          // Some servers ignore encoding_format and still return base64;
          // decode it ourselves as little-endian Float32.
          const buf = Buffer.from(v, "base64");
          const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          validVectors.push(Array.from(floats));
        } else {
          throw new Error(`unexpected embedding shape: ${typeof v}`);
        }
      }
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
