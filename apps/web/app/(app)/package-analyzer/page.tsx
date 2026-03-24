import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { PackageAnalyzerClient } from "@/components/package-analyzer/package-analyzer-client";

export default async function PackageAnalyzerPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; repoId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });

  if (!member) redirect("/login");

  const params = await searchParams;
  const defaultUrl = params.repo ?? undefined;
  const autoStart = !!defaultUrl;

  // Fetch history
  const history = await prisma.packageAnalysis.findMany({
    where: { organizationId: member.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      repoName: true,
      repoUrl: true,
      commitHash: true,
      status: true,
      totalPackages: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      durationMs: true,
      createdAt: true,
      user: { select: { name: true, image: true } },
      _count: { select: { deepDives: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Package Analyzer</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Analyze npm dependencies for security risks, typosquatting, and malicious packages.
        </p>
      </div>
      <PackageAnalyzerClient
        authenticated={true}
        defaultUrl={defaultUrl}
        autoStart={autoStart}
        history={history.map((h) => ({
          ...h,
          createdAt: h.createdAt.toISOString(),
          commitHash: h.commitHash ?? undefined,
          durationMs: h.durationMs ?? undefined,
          userName: h.user.name,
          deepDiveCount: h._count.deepDives,
        }))}
      />
    </div>
  );
}
