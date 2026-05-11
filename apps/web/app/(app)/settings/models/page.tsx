import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { HARDCODED_REVIEW_MODEL, HARDCODED_EMBED_MODEL } from "@/lib/ai-client";
import { ModelsSettings } from "./models-settings";

const INITIAL_REPO_COUNT = 10;

export default async function ModelsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const [member, availableModels] = await Promise.all([
    prisma.organizationMember.findFirst({
      where: {
        userId: session.user.id,
        ...(currentOrgId ? { organizationId: currentOrgId } : {}),
        deletedAt: null,
      },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            defaultModelId: true,
            defaultEmbedModelId: true,
          },
        },
      },
    }),
    prisma.availableModel.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: { modelId: true, displayName: true, provider: true, category: true },
    }),
  ]);

  if (!member) redirect("/dashboard");

  const orgId = member.organization.id;

  const [repos, totalCount] = await Promise.all([
    prisma.repository.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        fullName: true,
        reviewModelId: true,
        embedModelId: true,
      },
      orderBy: { name: "asc" },
      take: INITIAL_REPO_COUNT,
    }),
    prisma.repository.count({
      where: { organizationId: orgId, isActive: true },
    }),
  ]);

  // Sort custom (has overrides) first within initial batch
  repos.sort((a, b) => {
    const aCustom = a.reviewModelId || a.embedModelId ? 1 : 0;
    const bCustom = b.reviewModelId || b.embedModelId ? 1 : 0;
    if (aCustom !== bCustom) return bCustom - aCustom;
    return 0;
  });

  const isOwner = member.role === "owner";

  const platformDefaults = await prisma.availableModel.findMany({
    where: { isPlatformDefault: true, isActive: true },
    select: { modelId: true, displayName: true, category: true },
  });
  const platformDefaultLlm =
    platformDefaults.find((m) => m.category === "llm") ??
    availableModels.find((m) => m.modelId === HARDCODED_REVIEW_MODEL) ??
    null;
  const platformDefaultEmbed =
    platformDefaults.find((m) => m.category === "embedding") ??
    availableModels.find((m) => m.modelId === HARDCODED_EMBED_MODEL) ??
    null;

  return (
    <ModelsSettings
      key={orgId}
      isOwner={isOwner}
      availableModels={availableModels}
      currentModelId={member.organization.defaultModelId}
      currentEmbedModelId={member.organization.defaultEmbedModelId}
      platformDefaultLlmName={platformDefaultLlm?.displayName ?? null}
      platformDefaultEmbedName={platformDefaultEmbed?.displayName ?? null}
      initialRepos={repos}
      totalRepoCount={totalCount}
    />
  );
}
