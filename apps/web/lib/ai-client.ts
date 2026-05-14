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
