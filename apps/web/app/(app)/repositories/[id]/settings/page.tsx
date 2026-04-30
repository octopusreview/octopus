import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ReviewConfigForm } from "./review-config-form";
import { RepoConfigForm } from "./repo-config-form";
import { DEFAULT_REPO_CONFIG_FILES, normalizeRepoConfigFiles } from "@/lib/repo-config-shared";

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const repo = await prisma.repository.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      fullName: true,
      reviewConfig: true,
      useRepoConfig: true,
      repoConfigFiles: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) notFound();

  const isOwner = repo.organization.members[0].role === "owner";
  const reviewConfig = (repo.reviewConfig as Record<string, unknown>) ?? {};
  const initialFiles = normalizeRepoConfigFiles(repo.repoConfigFiles);
  const initialFilesOrDefault = initialFiles.length > 0 ? initialFiles : [...DEFAULT_REPO_CONFIG_FILES];

  return (
    <div className="container mx-auto max-w-2xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{repo.fullName}</h1>
        <p className="text-muted-foreground">Review settings</p>
      </div>
      <ReviewConfigForm
        repoId={repo.id}
        isOwner={isOwner}
        initialConfig={reviewConfig}
      />
      <RepoConfigForm
        repoId={repo.id}
        isOwner={isOwner}
        initialEnabled={repo.useRepoConfig}
        initialFiles={initialFilesOrDefault}
      />
    </div>
  );
}
