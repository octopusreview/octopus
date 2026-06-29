import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { enqueue } from "@/lib/queue";
import { findCatalogEntry } from "@/lib/ollama-catalog";
import { isOllamaConfigured } from "@/lib/ollama-admin";

// A pull row that's "pulling"/"queued" but hasn't been touched within this
// window is treated as orphaned (worker died mid-download) and may be
// re-triggered. Otherwise an active pull is left alone (idempotent re-clicks).
const ACTIVE_PULL_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/ollama/pull  { model }
 *
 * Admin-only. Enqueues a background pull of a curated Ollama model. `model`
 * must be one of the catalog entries — this both keeps the feature curated and
 * bounds what the server will fetch. Returns the pull row's current state; the
 * client polls GET /api/ollama/models for progress.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  if (!currentOrgId) return Response.json({ error: "No active org" }, { status: 400 });

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: currentOrgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return Response.json({ error: "Admin role required" }, { status: 403 });
  }

  if (!isOllamaConfigured()) {
    return Response.json(
      { error: "Ollama is not configured (set OLLAMA_SERVER_URL)" },
      { status: 400 },
    );
  }

  let body: { model?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model : "";
  if (!findCatalogEntry(model)) {
    return Response.json({ error: "Unknown model" }, { status: 400 });
  }

  // Don't double-enqueue an actively-running pull; do allow re-triggering a
  // completed, failed, or stale (orphaned) one.
  const existing = await prisma.ollamaModelPull.findUnique({ where: { model } });
  if (
    existing &&
    (existing.status === "pulling" || existing.status === "queued") &&
    Date.now() - existing.updatedAt.getTime() < ACTIVE_PULL_TTL_MS
  ) {
    return Response.json({
      model: existing.model,
      status: existing.status,
      progress: existing.progress,
    });
  }

  const row = await prisma.ollamaModelPull.upsert({
    where: { model },
    create: { model, status: "queued", progress: 0 },
    update: { status: "queued", statusText: null, progress: 0, error: null },
  });
  // singletonKey collapses concurrent enqueues for the same model into one
  // job (the TTL check above handles the common case; this closes the
  // double-click / double-submit race so two workers can't pull in parallel).
  await enqueue("pull-ollama-model", { model }, { singletonKey: model });

  return Response.json({ model: row.model, status: row.status, progress: row.progress });
}
