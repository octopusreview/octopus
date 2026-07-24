import { prisma } from "@octopus/db";

export const HARDCODED_REVIEW_MODEL = "claude-sonnet-4-6";
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

export interface ResolvedReviewModel {
  model: string;
  /** true when the model came from an explicit repo/org pin (not the platform default). */
  pinned: boolean;
}

/**
 * Resolve the review model AND report whether it was an explicit pin, in a
 * single pass of DB lookups. Single source of truth for the
 * repo-pin → org-pin → platform-default precedence; the router
 * (review-routing.ts) uses `pinned` to know when it may downshift.
 */
export async function resolveReviewModelPin(orgId: string, repoId?: string): Promise<ResolvedReviewModel> {
  if (repoId) {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { reviewModelId: true },
    });
    if (repo?.reviewModelId) return { model: repo.reviewModelId, pinned: true };
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { defaultModelId: true },
  });
  if (org?.defaultModelId) return { model: org.defaultModelId, pinned: true };

  return { model: (await getPlatformDefault("llm")) ?? HARDCODED_REVIEW_MODEL, pinned: false };
}

export async function getReviewModel(orgId: string, repoId?: string): Promise<string> {
  return (await resolveReviewModelPin(orgId, repoId)).model;
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
