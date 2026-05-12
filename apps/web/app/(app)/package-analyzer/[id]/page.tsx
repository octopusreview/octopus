import { redirect } from "next/navigation";
import Link from "@/components/link";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import type { DependencyRiskReport } from "@octopus/package-analyzer";
import { ResultsSummary } from "@/components/package-analyzer/results-summary";
import { ResultsList } from "@/components/package-analyzer/results-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { IconArrowLeft, IconClock, IconGitCommit, IconMicroscope } from "@tabler/icons-react";

export default async function PackageAnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { id } = await params;

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

  const [analysis, safePackages] = await Promise.all([
    prisma.packageAnalysis.findFirst({
    where: { id, organizationId: member.organizationId },
    select: {
      id: true,
      repoName: true,
      repoUrl: true,
      commitHash: true,
      status: true,
      results: true,
      analyzedFiles: true,
      totalPackages: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      durationMs: true,
      errorMessage: true,
      createdAt: true,
      user: { select: { name: true } },
      deepDives: {
        select: {
          id: true,
          packageName: true,
          version: true,
          verdict: true,
          confidence: true,
          summary: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  }),
    prisma.safePackage.findMany({ select: { name: true } }),
  ]);

  if (!analysis) redirect("/package-analyzer");

  const safeSet = new Set(safePackages.map((p) => p.name));
  const reports = (analysis.results ?? []) as unknown as DependencyRiskReport[];
  const analyzedFiles = (analysis.analyzedFiles ?? []) as unknown as string[];

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-10">
      <Link
        href="/package-analyzer"
        className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm transition-colors"
      >
        <IconArrowLeft className="h-4 w-4" />
        Back to Package Analyzer
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{analysis.repoName}</h1>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <IconClock className="h-4 w-4" />
            {new Date(analysis.createdAt).toLocaleString()}
          </span>
          {analysis.commitHash && (
            <span className="flex items-center gap-1">
              <IconGitCommit className="h-4 w-4" />
              {analysis.commitHash.slice(0, 7)}
            </span>
          )}
          {analysis.durationMs && (
            <span>{(analysis.durationMs / 1000).toFixed(1)}s</span>
          )}
          <span>by {analysis.user.name}</span>
        </div>
      </div>

      {analysis.status === "failed" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          Analysis failed: {analysis.errorMessage ?? "Unknown error"}
        </div>
      )}

      {reports.length > 0 && (
        <div className="space-y-6">
          <ResultsSummary
            reports={reports}
            repoName={analysis.repoName}
            analyzedFiles={analyzedFiles}
          />
          <ResultsList reports={reports} authenticated={true} analysisId={analysis.id} safePackages={safeSet} />
        </div>
      )}

      {analysis.status === "completed" && reports.length === 0 && (
        <div className="text-muted-foreground py-12 text-center">
          <p className="text-lg">All dependencies look clean!</p>
          <p className="mt-1 text-sm">No suspicious packages detected in {analyzedFiles.length} package.json file(s).</p>
        </div>
      )}

      {analysis.deepDives.length > 0 && (
        <div className="mt-8 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <IconMicroscope className="h-5 w-5" />
            Deep Dive Analyses ({analysis.deepDives.length})
          </h2>
          {analysis.deepDives.map((dd) => {
            const verdictColor: Record<string, string> = {
              malicious: "destructive",
              suspicious: "secondary",
              likely_safe: "outline",
              safe: "outline",
            };
            return (
              <Card key={dd.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold">{dd.packageName}</code>
                      {dd.version && <span className="text-muted-foreground text-xs">@{dd.version}</span>}
                      <Badge variant={(verdictColor[dd.verdict] ?? "secondary") as "default" | "secondary" | "destructive" | "outline"}>
                        {dd.verdict.replace("_", " ").toUpperCase()}
                      </Badge>
                      <span className="text-muted-foreground text-xs">({dd.confidence} confidence)</span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm line-clamp-2">{dd.summary}</p>
                  </div>
                  <div className="text-muted-foreground shrink-0 text-xs">
                    {new Date(dd.createdAt).toLocaleString()}
                    <br />
                    by {dd.user.name}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
