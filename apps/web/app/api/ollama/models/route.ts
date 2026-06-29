import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { OLLAMA_CATALOG } from "@/lib/ollama-catalog";
import { isOllamaConfigured, listInstalledModels } from "@/lib/ollama-admin";

/**
 * GET /api/ollama/models
 *
 * Returns the local-model panel state for the caller's org: whether Ollama is
 * configured/reachable, which curated models are installed, the catalog, and
 * the status of any in-flight or recent pulls. Read-only — any org member may
 * view; the pull action (POST /api/ollama/pull) is admin-gated.
 *
 * Ollama is instance-level, so installed models + pulls are not org-scoped;
 * org membership only authenticates the viewer.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  if (!currentOrgId) return Response.json({ error: "No active org" }, { status: 400 });

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: currentOrgId, deletedAt: null },
    select: { id: true },
  });
  if (!member) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!isOllamaConfigured()) {
    return Response.json({
      enabled: false,
      reachable: false,
      installed: [],
      catalog: OLLAMA_CATALOG,
      pulls: [],
    });
  }

  const [installed, pulls] = await Promise.all([
    listInstalledModels(),
    prisma.ollamaModelPull.findMany({ orderBy: { updatedAt: "desc" } }),
  ]);

  return Response.json({
    enabled: true,
    reachable: installed !== null,
    installed: installed ?? [],
    catalog: OLLAMA_CATALOG,
    pulls: pulls.map((p) => ({
      model: p.model,
      status: p.status,
      statusText: p.statusText,
      progress: p.progress,
      error: p.error,
    })),
  });
}
