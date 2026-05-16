import { prisma } from "@octopus/db";

// In Databricks runtime these models go through the AI Gateway. The
// `ai-router.ts` translator converts `claude-sonnet-4-6` →
// `databricks-claude-sonnet-4-6` before the request leaves the app. The
// embed model is the only one that differs at the app level — Databricks
// AI Gateway exposes a 1024-dim GTE-Large-EN rather than OpenAI's
// 3072-dim text-embedding-3-large, so VS indexes are sized to 1024.
const ON_DATABRICKS = Boolean(process.env.DATABRICKS_HOST);
export const HARDCODED_REVIEW_MODEL = "claude-sonnet-4-6";
export const HARDCODED_EMBED_MODEL = ON_DATABRICKS
  ? "databricks-gte-large-en"
  : "text-embedding-3-large";

// Embedding vector dimensions for the supported models. EXPECTED_EMBED_DIM is
// the dimension that the active embed model produces and MUST match the
// dimension the Vector Search indexes were created with. If `DATABRICKS_HOST`
// is unset after the indexes have already been bootstrapped at 1024-dim, the
// embedding model would silently switch to 3072-dim and every upsert would
// fail with a hard dimension-mismatch error from VS (we surface those via
// the `vsUpsert` SUCCESS-row check in apps/web/lib/qdrant.ts). Exporting the
// constant here lets callers double-check vector shape locally before sending
// — failing loud and fast at the embedder rather than at the VS boundary.
export const EMBED_MODEL_DIMS: Record<string, number> = {
  "databricks-gte-large-en": 1024,
  "text-embedding-3-large": 3072,
};
export const EXPECTED_EMBED_DIM: number =
  EMBED_MODEL_DIMS[HARDCODED_EMBED_MODEL] ?? 1024;

/**
 * Return the expected embedding dimension for a given model id. Returns
 * `null` if we don't know the model's dimension (org has overridden to a
 * custom embed model). Callers can use `null` to skip the local sanity check
 * and rely on VS to reject mismatched rows.
 */
export function getExpectedEmbedDim(modelId: string): number | null {
  return EMBED_MODEL_DIMS[modelId] ?? null;
}

async function getPlatformDefault(category: "llm" | "embedding"): Promise<string | null> {
  try {
    const model = await prisma.availableModel.findFirst({
      where: { category, isPlatformDefault: true, isActive: true },
      select: { modelId: true },
    });
    return model?.modelId ?? null;
  } catch (error) {
    console.error(`Failed to fetch platform default for ${category}:`, error);
    return null;
  }
}

export async function getReviewModel(orgId: string, repoId?: string): Promise<string> {
  if (repoId) {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { reviewModelId: true },
    });
    if (repo?.reviewModelId) return repo.reviewModelId;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { defaultModelId: true },
  });
  if (org?.defaultModelId) return org.defaultModelId;

  return (await getPlatformDefault("llm")) ?? HARDCODED_REVIEW_MODEL;
}

export async function getEmbedModel(orgId: string, repoId?: string): Promise<string> {
  if (repoId) {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { embedModelId: true },
    });
    if (repo?.embedModelId) return repo.embedModelId;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { defaultEmbedModelId: true },
  });
  if (org?.defaultEmbedModelId) return org.defaultEmbedModelId;

  return (await getPlatformDefault("embedding")) ?? HARDCODED_EMBED_MODEL;
}
