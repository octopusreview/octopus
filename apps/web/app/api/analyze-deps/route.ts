import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { analyzeRepositoryDependencies } from "@octopus/package-analyzer";
import type { AnalysisProgressEvent } from "@octopus/package-analyzer";
import { getInstallationToken } from "@/lib/github";

const GITHUB_API = "https://api.github.com/repos";
const GITHUB_RAW = "https://raw.githubusercontent.com";

function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const branch = parts.length >= 4 && parts[2] === "tree" ? parts.slice(3).join("/") : undefined;
    return { owner: parts[0], repo: parts[1], branch };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      organizationId: true,
      organization: { select: { githubInstallationId: true } },
    },
  });

  if (!member) {
    return Response.json({ error: "No organization found" }, { status: 403 });
  }

  const orgId = member.organizationId;
  const userId = session.user.id;
  const installationId = member.organization.githubInstallationId;

  // Build auth headers for GitHub API (uses installation token if available)
  async function githubHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (installationId) {
      try {
        const token = await getInstallationToken(installationId);
        h.Authorization = `token ${token}`;
      } catch { /* fall back to unauthenticated */ }
    }
    return h;
  }

  // Parse request
  let body: { repoUrl: string; repositoryId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { repoUrl, repositoryId } = body;
  if (!repoUrl || typeof repoUrl !== "string") {
    return Response.json({ error: "repoUrl is required" }, { status: 400 });
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return Response.json({ error: "Invalid GitHub repository URL" }, { status: 400 });
  }

  const { owner, repo, branch } = parsed;
  const repoName = `${owner}/${repo}`;

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const startTime = Date.now();
      let analysisId: string | null = null;

      try {
        // 1. Get default branch + HEAD commit
        let ref = branch;
        let commitHash: string | null = null;

        const ghHeaders = await githubHeaders();

        const repoResp = await fetch(`${GITHUB_API}/${owner}/${repo}`, { headers: ghHeaders });
        if (!repoResp.ok) {
          send("error", { message: `Repository not found or not accessible: ${repoName}` });
          controller.close();
          return;
        }
        const repoData = await repoResp.json() as Record<string, any>;
        if (!ref) ref = repoData.default_branch ?? "main";

        // Get HEAD commit hash
        try {
          const commitResp = await fetch(`${GITHUB_API}/${owner}/${repo}/commits/${ref}`, { headers: ghHeaders });
          if (commitResp.ok) {
            const commitData = await commitResp.json() as Record<string, any>;
            commitHash = commitData.sha ?? null;
          }
        } catch { /* non-critical */ }

        // 2. Check cache — same repo + same commit hash
        if (commitHash) {
          const cached = await prisma.packageAnalysis.findFirst({
            where: {
              organizationId: orgId,
              repoUrl: `https://github.com/${repoName}`,
              commitHash,
              status: "completed",
            },
            orderBy: { createdAt: "desc" },
          });

          if (cached) {
            send("progress", { step: "started", message: "Found cached analysis for this commit" });
            send("complete", {
              analysisId: cached.id,
              reports: cached.results,
              repoName,
              analyzedFiles: cached.analyzedFiles,
              cached: true,
            });
            controller.close();
            return;
          }
        }

        // 3. Create analysis record
        const analysis = await prisma.packageAnalysis.create({
          data: {
            repoUrl: `https://github.com/${repoName}`,
            repoName,
            commitHash,
            status: "running",
            organizationId: orgId,
            repositoryId: repositoryId ?? null,
            userId,
          },
        });
        analysisId = analysis.id;

        send("progress", { step: "started", message: `Analyzing ${repoName}@${ref?.slice(0, 7) ?? ref}...` });

        // 4. Fetch file tree
        const treeResp = await fetch(
          `${GITHUB_API}/${owner}/${repo}/git/trees/${ref}?recursive=1`,
          { headers: ghHeaders },
        );
        if (!treeResp.ok) {
          throw new Error("Failed to fetch repository tree");
        }
        const treeData = await treeResp.json() as Record<string, any>;
        const packageJsonPaths: string[] = ((treeData.tree ?? []) as { type: string; path: string }[])
          .filter((f) => f.type === "blob" && (f.path === "package.json" || f.path.endsWith("/package.json")) && !f.path.includes("node_modules"))
          .map((f) => f.path);

        if (packageJsonPaths.length === 0) {
          await prisma.packageAnalysis.update({
            where: { id: analysisId },
            data: { status: "completed", results: [], analyzedFiles: [], durationMs: Date.now() - startTime },
          });
          send("complete", { analysisId, reports: [], repoName, analyzedFiles: [] });
          controller.close();
          return;
        }

        send("progress", { step: "extracting", message: `Found ${packageJsonPaths.length} package.json file(s)` });

        // 5. Fetch contents (use Contents API for private repo support)
        const rawHeaders = { ...ghHeaders, Accept: "application/vnd.github.raw+json" };
        const packageJsonContents: { file: string; content: string }[] = [];
        for (const filePath of packageJsonPaths) {
          try {
            const rawResp = await fetch(
              `${GITHUB_API}/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
              { headers: rawHeaders },
            );
            if (rawResp.ok) {
              packageJsonContents.push({ file: filePath, content: await rawResp.text() });
            }
          } catch { /* skip */ }
        }

        if (packageJsonContents.length === 0) {
          await prisma.packageAnalysis.update({
            where: { id: analysisId },
            data: { status: "completed", results: [], analyzedFiles: [], durationMs: Date.now() - startTime },
          });
          send("complete", { analysisId, reports: [], repoName, analyzedFiles: [] });
          controller.close();
          return;
        }

        // 6. Fetch safe packages from DB (allowlist)
        const safePackages = await prisma.safePackage.findMany({ select: { name: true } });
        const allowlist = safePackages.map((p) => p.name);

        // 7. Run analysis
        const reports = await analyzeRepositoryDependencies({
          packageJsonContents,
          config: { allowlist },
          onProgress: (event: AnalysisProgressEvent) => {
            if (event.finding) {
              send("finding", event.finding);
            } else {
              send("progress", { step: event.step, message: event.message, package: event.package, progress: event.progress });
            }
          },
        });

        // 7. Save results
        const durationMs = Date.now() - startTime;
        await prisma.packageAnalysis.update({
          where: { id: analysisId },
          data: {
            status: "completed",
            results: JSON.parse(JSON.stringify(reports)),
            analyzedFiles: packageJsonPaths,
            totalPackages: reports.length,
            criticalCount: reports.filter((r) => r.overallRisk === "critical").length,
            highCount: reports.filter((r) => r.overallRisk === "high").length,
            mediumCount: reports.filter((r) => r.overallRisk === "medium").length,
            durationMs,
          },
        });

        send("complete", { analysisId, reports, repoName, analyzedFiles: packageJsonPaths });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        if (analysisId) {
          await prisma.packageAnalysis.update({
            where: { id: analysisId },
            data: { status: "failed", errorMessage: message, durationMs: Date.now() - startTime },
          }).catch(() => {});
        }
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
