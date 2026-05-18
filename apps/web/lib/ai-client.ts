import { prisma } from "@octopus/db";

// Last-resort fallback when no platform default is set in AvailableModel and
// neither the repo nor the org has overridden the review model. Codex Mini
// is OpenAI's coding-focused model — well-suited to PR review and cheaper
// per-token than the previous claude-sonnet fallback. The DB-driven
// `isPlatformDefault` flag is the actual source of truth; this constant
// only fires when the DB is empty or unreachable.
export const HARDCODED_REVIEW_MODEL = "codex-mini-latest";
export const HARDCODED_EMBED_MODEL = "text-embedding-3-large";

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
