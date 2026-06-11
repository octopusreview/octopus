import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { normaliseRemoteUrl } from "@/app/api/cli/repos/by-remote/route";
import {
  indexLocalBatch,
  markLocalIndexFailed,
  prepareRepoForLocalIndex,
  recordLocalIndexProgress,
  type LocalFile,
} from "@/lib/index-local";

/**
 * POST /api/cli/repos/index-local
 *
 * Server endpoint for `octp review` to index a local working tree against an
 * org when the repo isn't connected via the GitHub App / GitLab / Bitbucket
 * webhook flow. The CLI walks `git ls-files`, packs files into byte-budgeted
 * batches, and posts each batch as a separate request — one batch per HTTP
 * call so a slow embed API doesn't push the request over typical proxy timeouts
 * and so the user can see progress.
 *
 * Body shape per batch:
 *   - First batch (batchIndex = 0): { remoteUrl, defaultBranch, totalBatches,
 *     totalFiles, batchIndex: 0, files }
 *     → creates the Repository row (or re-uses an existing CLI-uploaded one),
 *       wipes prior chunks, sets indexStatus=indexing, then processes batch 0.
 *   - Subsequent batches: { repoId, totalBatches, batchIndex, files }
 *     → process files against an existing in-progress row.
 *   - Last batch (batchIndex === totalBatches - 1): also flips indexStatus to
 *     "indexed" + records indexedAt + indexDurationMs.
 *
 * Hard limits to keep request size sane:
 *   - 5 MB total body (Next.js default proxy limits start to bite past this)
 *   - 200 files per batch
 *   - 100 KB per file (matches the existing skip threshold in indexer)
 *
 * Errors:
 *   - 401 unauth
 *   - 400 bad input (parse, batch-index gaps, file too big, etc.)
 *   - 409 the repo is managed via platform installation — index it via the
 *     usual flow instead.
 *   - 500 on indexing failure — repo row gets indexStatus=failed so the CLI's
 *     poll sees it.
 *
 * Audit log: one row per first-batch (cli.index_local_start) and one per
 * final-batch (cli.index_local_complete) so admins can see who triggered
 * indexing for which repo.
 */

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 200;
const MAX_FILE_CONTENT_BYTES = 100_000;

type FirstBatchBody = {
  remoteUrl: string;
  defaultBranch?: string;
  totalBatches: number;
  totalFiles: number;
  batchIndex: 0;
  files: LocalFile[];
};

type SubsequentBatchBody = {
  repoId: string;
  totalBatches: number;
  batchIndex: number;
  files: LocalFile[];
};

type Body = FirstBatchBody | SubsequentBatchBody;

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawText = await request.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Batch too large (${rawText.length} bytes). Cap is ${MAX_BODY_BYTES}.` },
      { status: 413 },
    );
  }

  let body: Body;
  try {
    body = JSON.parse(rawText) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateBatch(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const isFirstBatch = body.batchIndex === 0;
  const isLastBatch = body.batchIndex === body.totalBatches - 1;

  // Resolve / create repo row (first batch) or look up existing (later batches).
  let repoId: string;
  let fullName: string;
  let startedAt: number;
  if (isFirstBatch) {
    const first = body as FirstBatchBody;
    const remote = normaliseRemoteUrl(first.remoteUrl);
    if (!remote) {
      return NextResponse.json(
        { error: "Could not parse remoteUrl into provider/owner/repo" },
        { status: 400 },
      );
    }
    const prep = await prepareRepoForLocalIndex(
      auth.org.id,
      remote.provider,
      remote.fullName,
      first.defaultBranch || "main",
    );
    if (!prep.ok) {
      return NextResponse.json(
        {
          error:
            "This repo is connected via the platform installation. Use the dashboard to re-index it.",
          repoId: prep.repoId,
        },
        { status: 409 },
      );
    }
    repoId = prep.repoId;
    fullName = remote.fullName;
    startedAt = Date.now();
    await writeAuditLog({
      action: "cli.index_local_start",
      category: "repo",
      actorId: auth.user?.id ?? null,
      actorEmail: auth.user?.email ?? null,
      organizationId: auth.org.id,
      targetType: "repository",
      targetId: repoId,
      metadata: {
        fullName,
        provider: remote.provider,
        totalBatches: first.totalBatches,
        totalFiles: first.totalFiles,
        reIndex: prep.reIndex,
      },
    }).catch((e) => console.error("[cli.index-local] start audit failed:", e));
  } else {
    const sub = body as SubsequentBatchBody;
    const repo = await prisma.repository.findFirst({
      where: { id: sub.repoId, organizationId: auth.org.id, isActive: true },
      select: { id: true, fullName: true, indexStatus: true, updatedAt: true },
    });
    if (!repo) {
      return NextResponse.json({ error: "Repo not found or not in org" }, { status: 404 });
    }
    if (repo.indexStatus !== "indexing") {
      return NextResponse.json(
        { error: `Cannot continue: repo indexStatus is ${repo.indexStatus}` },
        { status: 409 },
      );
    }
    repoId = repo.id;
    fullName = repo.fullName;
    startedAt = repo.updatedAt.getTime();
  }

  // Spend-limit gate — same invariant the sibling CLI review endpoints enforce.
  // Run AFTER repo resolution so that, if the org crosses its cap between
  // batch N and N+1, we can mark the repo failed instead of stranding it in
  // indexStatus="indexing" forever (the CLI's retry loop would otherwise be
  // stuck waiting for a final-batch state flip that never happens).
  if (await isOrgOverSpendLimit(auth.org.id)) {
    if (!isFirstBatch) {
      await markLocalIndexFailed(repoId).catch((e) =>
        console.error("[cli.index-local] failed to mark repo failed on 402:", e),
      );
    }
    return NextResponse.json({ error: "Monthly spend limit reached" }, { status: 402 });
  }

  try {
    const result = await indexLocalBatch(repoId, fullName, auth.org.id, body.files);
    await recordLocalIndexProgress(
      repoId,
      startedAt,
      {
        indexedFiles: result.indexedInBatch,
        totalChunks: result.chunksInBatch,
        totalVectors: result.chunksInBatch,
        ...(isFirstBatch ? { totalFiles: (body as FirstBatchBody).totalFiles } : {}),
      },
      isLastBatch,
    );

    if (isLastBatch) {
      await writeAuditLog({
        action: "cli.index_local_complete",
        category: "repo",
        actorId: auth.user?.id ?? null,
        actorEmail: auth.user?.email ?? null,
        organizationId: auth.org.id,
        targetType: "repository",
        targetId: repoId,
        metadata: { fullName, totalBatches: body.totalBatches },
      }).catch((e) => console.error("[cli.index-local] complete audit failed:", e));
    }

    return NextResponse.json({
      repoId,
      batchIndex: body.batchIndex,
      indexedInBatch: result.indexedInBatch,
      skippedInBatch: result.skippedInBatch,
      chunksInBatch: result.chunksInBatch,
      done: isLastBatch,
    });
  } catch (e) {
    await markLocalIndexFailed(repoId).catch(() => {});
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[cli.index-local] batch ${body.batchIndex}/${body.totalBatches} for ${fullName} failed:`, detail);
    const isProd = process.env.NODE_ENV === "production";
    return NextResponse.json(
      { error: isProd ? "Indexing batch failed" : `Indexing batch failed: ${detail}` },
      { status: 500 },
    );
  }
}

function validateBatch(body: Body): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Empty body" };
  if (typeof body.batchIndex !== "number" || body.batchIndex < 0) {
    return { ok: false, error: "batchIndex must be a non-negative integer" };
  }
  if (typeof body.totalBatches !== "number" || body.totalBatches < 1) {
    return { ok: false, error: "totalBatches must be a positive integer" };
  }
  if (body.batchIndex >= body.totalBatches) {
    return { ok: false, error: "batchIndex must be < totalBatches" };
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return { ok: false, error: "files must be a non-empty array" };
  }
  if (body.files.length > MAX_FILES_PER_BATCH) {
    return { ok: false, error: `Too many files in batch (cap ${MAX_FILES_PER_BATCH})` };
  }
  for (const f of body.files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
      return { ok: false, error: "each file must be { path: string, content: string }" };
    }
    if (f.content.length > MAX_FILE_CONTENT_BYTES) {
      return { ok: false, error: `file ${f.path} exceeds per-file cap of ${MAX_FILE_CONTENT_BYTES}` };
    }
  }
  if (body.batchIndex === 0) {
    const first = body as FirstBatchBody;
    if (typeof first.remoteUrl !== "string" || !first.remoteUrl.trim()) {
      return { ok: false, error: "first batch must include remoteUrl" };
    }
    if (typeof first.totalFiles !== "number" || first.totalFiles < 0) {
      return { ok: false, error: "first batch must include totalFiles" };
    }
  } else {
    const sub = body as SubsequentBatchBody;
    if (typeof sub.repoId !== "string" || !sub.repoId.trim()) {
      return { ok: false, error: "subsequent batches must include repoId" };
    }
  }
  return { ok: true };
}

