import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { safeIndexLogMessage } from "@/lib/index-log-safety";
import { writeSyncLog, deleteSyncLogs } from "@/lib/elasticsearch";
import { runIndexingInBackground } from "@/lib/indexing-runner";
import { createAbortController, abortIndexing } from "@/lib/indexing-abort";
import type { LogLevel } from "@/lib/indexer";

const STALE_INDEX_MS = 10 * 60 * 1000;

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      provider: true,
      defaultBranch: true,
      installationId: true,
      indexStatus: true,
      indexAttemptId: true,
      updatedAt: true,
      organizationId: true,
      organization: { select: { githubInstallationId: true } },
    },
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const installationId =
    repo.installationId ?? repo.organization.githubInstallationId;
  if (repo.provider === "github" && !installationId) {
    return NextResponse.json(
      { error: "Repository has no GitHub installation ID" },
      { status: 400 },
    );
  }
  if (repo.provider === "bitbucket") {
    const bbIntegration = await prisma.bitbucketIntegration.findUnique({
      where: { organizationId: repo.organizationId },
      select: { id: true },
    });
    if (!bbIntegration) {
      return NextResponse.json(
        { error: "No Bitbucket integration for this org" },
        { status: 400 },
      );
    }
  }

  if (repo.indexStatus === "indexing") {
    const elapsed = Date.now() - repo.updatedAt.getTime();
    if (elapsed < STALE_INDEX_MS) {
      return NextResponse.json(
        { error: "Indexing is already in progress" },
        { status: 409 },
      );
    }
  }

  const channel = `presence-org-${repo.organizationId}`;
  const emitLog = (message: string, level: LogLevel = "info") => {
    const timestamp = Date.now();
    const id = randomUUID();
    pubby.trigger(channel, "index-log", {
      repoId: repo.id,
      id,
      message: safeIndexLogMessage(message),
      level,
      timestamp,
    }).catch(() => console.warn("[repository-index] log notification failed"));
    writeSyncLog({
      orgId: repo.organizationId,
      repoId: repo.id,
      id,
      message,
      level,
      timestamp,
    });
  };

  await deleteSyncLogs(repo.organizationId, repo.id);

  const indexAttemptId = randomUUID();
  const claim = await prisma.repository.updateMany({
    where: { id: repo.id, indexStatus: repo.indexStatus, updatedAt: repo.updatedAt },
    data: { indexStatus: "indexing", indexAttemptId },
  });
  if (!claim.count) return NextResponse.json({ error: "Repository state changed or indexing is already in progress" }, { status: 409 });
  if (repo.indexStatus === "indexing" && repo.indexAttemptId) abortIndexing(repo.indexAttemptId);
  const abortController = createAbortController(indexAttemptId);

  runIndexingInBackground(
    repo.id,
    repo.fullName,
    repo.defaultBranch,
    repo.organizationId,
    installationId ?? 0,
    channel,
    emitLog,
    abortController,
    indexAttemptId,
    repo.provider,
  );

  return NextResponse.json({ message: "Reindex started", repoId: repo.id });
}
