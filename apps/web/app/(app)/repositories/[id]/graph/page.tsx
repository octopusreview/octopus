import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { RepoGraphView } from "./repo-graph-view";

export default async function RepoGraphPage({
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
      fullName: true,
      indexStatus: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) notFound();

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{repo.fullName}</h1>
        <p className="text-muted-foreground">
          Repository graph — nodes are files, solid edges are imports, dashed edges are semantic similarity.
        </p>
      </div>
      <RepoGraphView repoId={repo.id} indexStatus={repo.indexStatus} />
    </div>
  );
}
