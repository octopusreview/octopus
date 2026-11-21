import "server-only";
import { prisma } from "@octopus/db";
import type { Schemas } from "@qdrant/js-client-rest";
import { SupersededIndexError } from "@/lib/repository-index-completion";

export type RepositoryIndexOwner = { repoId: string; signal?: AbortSignal } & (
  { indexAttemptId: string; uploadId?: string } | { activeIndexGeneration: string | null; organizationId?: string; defaultBranch?: string }
);

export async function getRepositoryIndexGeneration(owner: RepositoryIndexOwner): Promise<string | null> {
  owner.signal?.throwIfAborted();
  const current = await prisma.repository.findFirst({
    where: {
      id: owner.repoId,
      ...("indexAttemptId" in owner ? {
        indexStatus: "indexing", indexAttemptId: owner.indexAttemptId,
        ...(owner.uploadId === undefined ? {} : { localIndexUpload: { path: ["id"], equals: owner.uploadId } }),
      } : {
        indexStatus: "indexed", activeIndexGeneration: owner.activeIndexGeneration,
        organizationId: owner.organizationId, defaultBranch: owner.defaultBranch,
      }),
    },
    select: { id: true },
  });
  if (!current) throw new SupersededIndexError();
  owner.signal?.throwIfAborted();
  return "indexAttemptId" in owner ? owner.uploadId ?? owner.indexAttemptId : owner.activeIndexGeneration;
}

export function repositoryCodeStorageId(repoId: string, generation: string | null): string {
  // Older binaries filter and delete solely by repoId. Keep generated indexes
  // outside that legacy key so rolling upgrades cannot expose or erase them.
  return generation === null ? repoId : JSON.stringify([repoId, generation]);
}

export function repositoryCodeFilter(repoId: string, generation: string | null): Schemas["Filter"] {
  return { must: [
    { key: "repoId", match: { value: repositoryCodeStorageId(repoId, generation) } },
    generation === null ? { is_empty: { key: "indexGeneration" } } : { key: "indexGeneration", match: { value: generation } },
  ] };
}

export async function getActiveRepositoryCodeFilter(repoIds: string[]): Promise<Schemas["Filter"] | null> {
  if (!repoIds.length) return null;
  const repos = await prisma.repository.findMany({
    where: { id: { in: repoIds } }, select: { id: true, activeIndexGeneration: true },
  });
  return repos.length ? { should: repos.map(repo => repositoryCodeFilter(repo.id, repo.activeIndexGeneration)) } : null;
}
