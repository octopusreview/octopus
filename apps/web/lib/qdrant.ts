// ─────────────────────────────────────────────────────────────────────────────
// Vector store — Databricks Vector Search backend
//
// This module preserves the public surface of the original Qdrant-backed
// vector store so call sites compile without changes. Bodies now hit Databricks
// Vector Search Direct Access indexes via the REST API.
//
// Index naming follows ${VECTOR_SEARCH_CATALOG}.${VECTOR_SEARCH_SCHEMA}.<collection>.
// 7 indexes are pre-created by databricks/bootstrap/create_indexes.py:
//   code_chunks, knowledge_chunks, review_chunks, chat_chunks,
//   flowchart_chunks, docs_chunks, feedback_patterns
//
// Notable behavior changes from the Qdrant version:
//   - Direct Access does NOT support hybrid (dense + sparse) search.
//     `queryText` parameters are accepted but ignored; a one-time warning is
//     logged at module init. The plan documents this as a known degradation.
//   - Filter-based deletes (e.g. by repoId) require a scan-then-delete-by-PK
//     two-step. The PK list is collected via /scan, then deleted in batches.
//   - PKs are STRING — no UUID coercion needed; CUIDs flow through unchanged.
//   - sanitizePayload (lone-surrogate strip) is kept for JSON safety.
// ─────────────────────────────────────────────────────────────────────────────

import { dbxFetch } from "./databricks/rest";
import { config as dbxConfig, vsIndexName } from "./databricks/config";

const VECTOR_SIZE = 3072; // OpenAI text-embedding-3-large
const SPARSE_VECTOR_NAME = "sparse"; // legacy constant; unused on VS

// ─────────────────────────────────────────────────────────────────────────────
// Surrogate-strip — same logic the Qdrant version had
// ─────────────────────────────────────────────────────────────────────────────
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function sanitizeString(s: string): string {
  return s.replace(LONE_SURROGATE_RE, "�");
}
function sanitizePayloadValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizePayloadValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizePayloadValue(v);
    }
    return out;
  }
  return value;
}
function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizePayloadValue(payload) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry helper (transient errors only)
// ─────────────────────────────────────────────────────────────────────────────
function isTransientError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const cause = error instanceof Error && "cause" in error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;
  const code = cause && typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code?: unknown }).code).toUpperCase()
    : "";
  if (["EPIPE", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code)) return true;
  if (message.includes("429") || message.includes("503") || message.includes("502")) return true;
  return message.includes("fetch failed")
    || message.includes("socket hang up")
    || message.includes("network socket disconnected")
    || message.includes("other side closed");
}

async function withVsRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxAttempts) throw error;
      const delay = Math.min(500 * 2 ** (attempt - 1), 4000);
      console.warn(`[vs] ${label} transient failure (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms:`, error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dict-style filter builders.
//
// Databricks Vector Search STANDARD endpoints accept a `filters` object
// (key → value or list of values). Keys can be a column name (equality) or
// `<column> <OP>` where OP ∈ {NOT, LT, GT, LE, GE, LIKE}. Multiple keys are
// implicit AND. There is no native OR; for OR we issue parallel queries and
// merge in JS (see searchFeedbackPatterns).
// STORAGE_OPTIMIZED endpoints use `filter_string` instead, but we use STANDARD
// because STORAGE_OPTIMIZED doesn't support DIRECT_ACCESS indexes.
// ─────────────────────────────────────────────────────────────────────────────
type Filters = Record<string, unknown>;

/** `{ col: value }` — equality. */
function eqFilter(col: string, value: string): Filters {
  return { [col]: value };
}

/** `{ col: [a, b, c] }` — IN list. Empty list yields a never-match filter. */
function inFilter(col: string, values: string[]): Filters {
  if (values.length === 0) return { [`${col} NOT`]: null, [col]: "__never__" };
  return { [col]: values };
}

/** Shallow-merge multiple filter objects → implicit AND. */
function andFilters(...parts: (Filters | undefined)[]): Filters {
  const out: Filters = {};
  for (const p of parts) if (p) Object.assign(out, p);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST helpers
// ─────────────────────────────────────────────────────────────────────────────

const VS_BASE = "/api/2.0/vector-search/indexes";

type ScoredRow = { payload: Record<string, unknown>; score: number };

type QueryResponse = {
  result: {
    data_array?: unknown[][];
    manifest?: { columns?: Array<{ name: string }> };
    next_page_token?: string;
  };
};

type ScanResponse = {
  data?: unknown[][];
  manifest?: { columns?: Array<{ name: string }> };
  data_array?: unknown[][]; // some endpoints use this name
  next_page_token?: string;
};

function rowsToScored(resp: QueryResponse): ScoredRow[] {
  const cols = resp.result.manifest?.columns?.map((c) => c.name) ?? [];
  const rows = resp.result.data_array ?? [];
  const scoreIdx = cols.indexOf("__db_score__") >= 0 ? cols.indexOf("__db_score__") : cols.indexOf("score");
  return rows.map((row) => {
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      if (i === scoreIdx) continue;
      payload[cols[i]] = row[i];
    }
    const score = scoreIdx >= 0 ? Number(row[scoreIdx] ?? 0) : 0;
    return { payload, score };
  });
}

async function vsQuery(
  indexName: string,
  queryVector: number[],
  options: {
    filters?: Filters;
    limit: number;
    columns?: string[];
    /** When set, runs HYBRID search (ANN + keyword bm25) and re-ranks. */
    queryText?: string;
  },
): Promise<ScoredRow[]> {
  const body: Record<string, unknown> = {
    query_vector: queryVector,
    num_results: options.limit,
  };
  if (options.queryText) {
    body.query_text = options.queryText;
    body.query_type = "HYBRID";
  }
  if (options.filters && Object.keys(options.filters).length > 0) {
    // VS REST accepts `filters_json` (string-encoded) — most universally supported.
    body.filters_json = JSON.stringify(options.filters);
  }
  if (options.columns) body.columns = options.columns;

  const resp = await withVsRetry(
    () =>
      dbxFetch<QueryResponse>(
        `${VS_BASE}/${encodeURIComponent(indexName)}/query`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    `query ${indexName}`,
  );
  return rowsToScored(resp);
}

async function vsUpsert(
  indexName: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  // Direct Access supports up to 1000 rows per upsert call.
  for (let i = 0; i < rows.length; i += 1000) {
    const slice = rows.slice(i, i + 1000);
    await withVsRetry(
      () =>
        dbxFetch(
          `${VS_BASE}/${encodeURIComponent(indexName)}/upsert-data`,
          {
            method: "POST",
            body: JSON.stringify({ inputs_json: JSON.stringify(slice) }),
          },
        ),
      `upsert ${indexName}`,
    );
  }
}

async function vsDeleteByPk(indexName: string, pks: string[]): Promise<void> {
  if (pks.length === 0) return;
  // Direct Access supports up to 100 PKs per delete call.
  for (let i = 0; i < pks.length; i += 100) {
    const slice = pks.slice(i, i + 100);
    await withVsRetry(
      () =>
        dbxFetch(
          `${VS_BASE}/${encodeURIComponent(indexName)}/delete-data`,
          {
            method: "POST",
            body: JSON.stringify({ primary_keys: slice }),
          },
        ),
      `delete ${indexName}`,
    );
  }
}

/**
 * Scan an index with a filter, returning rows. Used both for "get all chunks
 * for repo X" and for collecting PKs to delete-by-filter.
 */
async function vsScan(
  indexName: string,
  options: { filters?: Filters; limit?: number; columns?: string[] },
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  const pageSize = Math.min(options.limit ?? 1000, 1000);
  const maxRows = options.limit ?? Number.POSITIVE_INFINITY;

  while (results.length < maxRows) {
    const body: Record<string, unknown> = {
      num_results: Math.min(pageSize, maxRows - results.length),
    };
    if (options.filters && Object.keys(options.filters).length > 0) {
      body.filters_json = JSON.stringify(options.filters);
    }
    if (options.columns) body.columns = options.columns;
    if (pageToken) body.page_token = pageToken;

    let resp: ScanResponse;
    try {
      resp = await withVsRetry(
        () =>
          dbxFetch<ScanResponse>(
            `${VS_BASE}/${encodeURIComponent(indexName)}/scan`,
            { method: "POST", body: JSON.stringify(body) },
          ),
        `scan ${indexName}`,
      );
    } catch (err) {
      // Common case: index doesn't exist yet, or empty. Match Qdrant fallback.
      console.warn(`[vs] scan ${indexName} failed, returning empty:`, err instanceof Error ? err.message : err);
      return results;
    }

    const cols = resp.manifest?.columns?.map((c) => c.name) ?? [];
    const rows = resp.data_array ?? resp.data ?? [];
    for (const row of rows) {
      const payload: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        payload[cols[i]] = row[i];
      }
      results.push(payload);
    }

    pageToken = resp.next_page_token;
    if (!pageToken || rows.length === 0) break;
  }

  return results;
}

/** Delete-by-filter helper: scan to collect PKs, then delete by PK. */
async function vsDeleteByFilter(indexName: string, filters: Filters): Promise<void> {
  const rows = await vsScan(indexName, { filters, columns: ["id"] });
  const pks = rows.map((r) => String(r.id)).filter(Boolean);
  if (pks.length > 0) await vsDeleteByPk(indexName, pks);
}

// One-shot hybrid-search-disabled notice
let hybridWarned = false;
function warnHybridDisabledOnce() {
  if (hybridWarned) return;
  hybridWarned = true;
  console.warn(
    "[vs] Hybrid (dense + sparse) search is not supported on Direct Access indexes — falling back to dense-only. `queryText` arguments are accepted but ignored.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compat: getQdrantClient() — kept as a permissive stub so legacy callers
// (e.g. apps/web/lib/repo-graph.ts which used qdrant.scroll directly) still
// compile and run. Methods that map cleanly are implemented; everything else
// throws with a clear message.
// ─────────────────────────────────────────────────────────────────────────────

type QdrantScrollPoint = {
  id: string;
  vector?: number[];
  payload?: Record<string, unknown> | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyClient = any;

let legacyShim: LegacyClient | null = null;
export function getQdrantClient(): LegacyClient {
  if (!legacyShim) {
    legacyShim = {
      scroll: async (
        collection: string,
        opts: {
          filter?: { must?: Array<{ key: string; match: { value?: unknown; any?: unknown[] } }> };
          limit?: number;
          offset?: string | number;
          with_payload?: boolean;
          with_vector?: boolean;
        },
      ): Promise<{ points: QdrantScrollPoint[]; next_page_offset: string | number | null }> => {
        // Translate Qdrant-style `filter.must` into the VS filters dict.
        const filters: Filters = {};
        for (const m of opts.filter?.must ?? []) {
          if (m.match.any && Array.isArray(m.match.any)) {
            filters[m.key] = (m.match.any as unknown[]).map(String);
          } else if (m.match.value !== undefined) {
            filters[m.key] = String(m.match.value);
          }
        }
        const rows = await vsScan(vsIndexName(collection), {
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          limit: opts.limit ?? 100,
          // `with_vector` honored implicitly — we always return all columns from VS
        });
        const points: QdrantScrollPoint[] = rows.map((r) => ({
          id: String(r.id ?? ""),
          vector: opts.with_vector
            ? Array.isArray(r.embedding)
              ? (r.embedding as number[])
              : undefined
            : undefined,
          payload: opts.with_payload ? r : null,
        }));
        // VS scan is self-pageninating inside vsScan; no further pagination needed.
        return { points, next_page_offset: null };
      },
    };
  }
  return legacyShim;
}

// ─────────────────────────────────────────────────────────────────────────────
// code_chunks
// ─────────────────────────────────────────────────────────────────────────────
const COLLECTION_NAME = "code_chunks";

export async function ensureCollection() {
  // Indexes are created at deploy time by databricks/bootstrap/create_indexes.py.
  // No-op shim preserved for legacy callers (boot-reconciler, etc.).
}

export async function upsertChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  if (points.length === 0) return;
  const rows = points.map((p) => {
    const safePayload = sanitizePayload(p.payload);
    return { id: p.id, embedding: p.vector, ...safePayload };
  });
  await vsUpsert(vsIndexName(COLLECTION_NAME), rows);
}

export async function deleteRepoChunks(repoId: string) {
  await vsDeleteByFilter(vsIndexName(COLLECTION_NAME), eqFilter("repoId", repoId));
}

export async function deleteRepoFileChunks(repoId: string, filePaths: string[]) {
  if (filePaths.length === 0) return;
  await vsDeleteByFilter(
    vsIndexName(COLLECTION_NAME),
    andFilters(eqFilter("repoId", repoId), inFilter("filePath", filePaths)),
  );
}

export async function getRepoChunks(
  repoId: string,
  limit = 50,
): Promise<string[]> {
  const rows = await vsScan(vsIndexName(COLLECTION_NAME), {
    filters: eqFilter("repoId", repoId),
    limit,
    columns: ["text"],
  });
  return rows.map((r) => (r.text as string) ?? "").filter(Boolean);
}

export async function searchSimilarChunks(
  repoId: string,
  queryVector: number[],
  limit = 20,
  queryText?: string,
): Promise<{ filePath: string; text: string; startLine: number; endLine: number; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  const rows = await vsQuery(vsIndexName(COLLECTION_NAME), queryVector, {
    filters: eqFilter("repoId", repoId),
    limit,
    columns: ["filePath", "text", "startLine", "endLine"],
  });
  return rows.map((r) => ({
    filePath: (r.payload.filePath as string) ?? "",
    text: (r.payload.text as string) ?? "",
    startLine: Number(r.payload.startLine ?? 0),
    endLine: Number(r.payload.endLine ?? 0),
    score: r.score,
  }));
}

export async function searchCodeChunksAcrossRepos(
  repoIds: string[],
  queryVector: number[],
  limit = 20,
  queryText?: string,
): Promise<{ filePath: string; text: string; startLine: number; endLine: number; repoId: string; score: number }[]> {
  if (repoIds.length === 0) return [];
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  const rows = await vsQuery(vsIndexName(COLLECTION_NAME), queryVector, {
    filters: inFilter("repoId", repoIds),
    limit,
    columns: ["filePath", "text", "startLine", "endLine", "repoId"],
  });
  return rows.map((r) => ({
    filePath: (r.payload.filePath as string) ?? "",
    text: (r.payload.text as string) ?? "",
    startLine: Number(r.payload.startLine ?? 0),
    endLine: Number(r.payload.endLine ?? 0),
    repoId: (r.payload.repoId as string) ?? "",
    score: r.score,
  }));
}

export { COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// knowledge_chunks
// ─────────────────────────────────────────────────────────────────────────────
const KNOWLEDGE_COLLECTION_NAME = "knowledge_chunks";

export async function ensureKnowledgeCollection() {
  // No-op (created at deploy time).
}

export async function upsertKnowledgeChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    id: p.id,
    embedding: p.vector,
    ...sanitizePayload(p.payload),
  }));
  await vsUpsert(vsIndexName(KNOWLEDGE_COLLECTION_NAME), rows);
}

export async function deleteKnowledgeDocumentChunks(documentId: string) {
  await vsDeleteByFilter(vsIndexName(KNOWLEDGE_COLLECTION_NAME), eqFilter("documentId", documentId));
}

export async function searchKnowledgeChunks(
  orgId: string,
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ title: string; text: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  const rows = await vsQuery(vsIndexName(KNOWLEDGE_COLLECTION_NAME), queryVector, {
    filters: eqFilter("orgId", orgId),
    limit,
    columns: ["title", "text"],
  });
  return rows.map((r) => ({
    title: (r.payload.title as string) ?? "",
    text: (r.payload.text as string) ?? "",
    score: r.score,
  }));
}

export async function getKnowledgeChunksByOrg(
  orgId: string,
  limit = 20,
): Promise<string[]> {
  const rows = await vsScan(vsIndexName(KNOWLEDGE_COLLECTION_NAME), {
    filters: eqFilter("orgId", orgId),
    limit,
    columns: ["text"],
  });
  return rows.map((r) => (r.text as string) ?? "").filter(Boolean);
}

export { KNOWLEDGE_COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// review_chunks
// ─────────────────────────────────────────────────────────────────────────────
const REVIEW_COLLECTION_NAME = "review_chunks";

export async function ensureReviewCollection() {
  // No-op (created at deploy time).
}

export async function upsertReviewChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    id: p.id,
    embedding: p.vector,
    ...sanitizePayload(p.payload),
  }));
  await vsUpsert(vsIndexName(REVIEW_COLLECTION_NAME), rows);
}

export async function deleteReviewChunksByPR(pullRequestId: string) {
  await vsDeleteByFilter(vsIndexName(REVIEW_COLLECTION_NAME), eqFilter("pullRequestId", pullRequestId));
}

export async function searchReviewChunks(
  orgId: string,
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ text: string; prTitle: string; prNumber: number; repoFullName: string; author: string; reviewDate: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  const rows = await vsQuery(vsIndexName(REVIEW_COLLECTION_NAME), queryVector, {
    filters: eqFilter("orgId", orgId),
    limit,
    columns: ["text", "prTitle", "prNumber", "repoFullName", "author", "reviewDate"],
  });
  return rows.map((r) => ({
    text: (r.payload.text as string) ?? "",
    prTitle: (r.payload.prTitle as string) ?? "",
    prNumber: Number(r.payload.prNumber ?? 0),
    repoFullName: (r.payload.repoFullName as string) ?? "",
    author: (r.payload.author as string) ?? "",
    reviewDate: (r.payload.reviewDate as string) ?? "",
    score: r.score,
  }));
}

export { REVIEW_COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// chat_chunks
// ─────────────────────────────────────────────────────────────────────────────
const CHAT_COLLECTION_NAME = "chat_chunks";

export async function ensureChatCollection() {
  // No-op.
}

export async function upsertChatChunk(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  await vsUpsert(vsIndexName(CHAT_COLLECTION_NAME), [
    { id: point.id, embedding: point.vector, ...sanitizePayload(point.payload) },
  ]);
}

export async function searchChatChunks(
  orgId: string,
  queryVector: number[],
  limit = 5,
  excludeConversationId?: string,
  queryText?: string,
): Promise<{ question: string; answer: string; conversationId: string; conversationTitle: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  try {
    // VS dict-filter doesn't have a clean NOT operator; we over-fetch and filter
    // client-side when excludeConversationId is set.
    const overfetch = excludeConversationId ? limit * 2 : limit;
    const rows = await vsQuery(vsIndexName(CHAT_COLLECTION_NAME), queryVector, {
      filters: eqFilter("orgId", orgId),
      limit: overfetch,
      columns: ["question", "answer", "conversationId", "conversationTitle"],
    });
    let filtered = rows;
    if (excludeConversationId) {
      filtered = rows.filter((r) => r.payload.conversationId !== excludeConversationId);
    }
    return filtered.slice(0, limit).map((r) => ({
      question: (r.payload.question as string) ?? "",
      answer: (r.payload.answer as string) ?? "",
      conversationId: (r.payload.conversationId as string) ?? "",
      conversationTitle: (r.payload.conversationTitle as string) ?? "",
      score: r.score,
    }));
  } catch {
    return [];
  }
}

export async function deleteChatChunksByConversation(conversationId: string) {
  await vsDeleteByFilter(
    vsIndexName(CHAT_COLLECTION_NAME),
    eqFilter("conversationId", conversationId),
  );
}

export { CHAT_COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// flowchart_chunks (diagrams)
// ─────────────────────────────────────────────────────────────────────────────
const DIAGRAM_COLLECTION_NAME = "flowchart_chunks";

export async function ensureDiagramCollection() {
  // No-op.
}

export async function upsertDiagramChunk(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  await vsUpsert(vsIndexName(DIAGRAM_COLLECTION_NAME), [
    { id: point.id, embedding: point.vector, ...sanitizePayload(point.payload) },
  ]);
}

export async function deleteDiagramChunksByPR(pullRequestId: string) {
  await vsDeleteByFilter(
    vsIndexName(DIAGRAM_COLLECTION_NAME),
    eqFilter("pullRequestId", pullRequestId),
  );
}

export async function searchDiagramChunks(
  orgId: string,
  queryVector: number[],
  limit = 3,
  queryText?: string,
): Promise<{ mermaidCode: string; diagramType: string; prTitle: string; prNumber: number; repoFullName: string; author: string; reviewDate: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  try {
    const rows = await vsQuery(vsIndexName(DIAGRAM_COLLECTION_NAME), queryVector, {
      filters: eqFilter("orgId", orgId),
      limit,
      columns: ["mermaidCode", "diagramType", "prTitle", "prNumber", "repoFullName", "author", "reviewDate"],
    });
    return rows.map((r) => ({
      mermaidCode: (r.payload.mermaidCode as string) ?? "",
      diagramType: (r.payload.diagramType as string) ?? "flowchart",
      prTitle: (r.payload.prTitle as string) ?? "",
      prNumber: Number(r.payload.prNumber ?? 0),
      repoFullName: (r.payload.repoFullName as string) ?? "",
      author: (r.payload.author as string) ?? "",
      reviewDate: (r.payload.reviewDate as string) ?? "",
      score: r.score,
    }));
  } catch {
    return [];
  }
}

export { DIAGRAM_COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// feedback_patterns
// ─────────────────────────────────────────────────────────────────────────────
const FEEDBACK_COLLECTION_NAME = "feedback_patterns";

export async function ensureFeedbackCollection() {
  // No-op.
}

export async function upsertFeedbackPattern(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  const payload = sanitizePayload({ ...point.payload, issueId: point.id });
  await vsUpsert(vsIndexName(FEEDBACK_COLLECTION_NAME), [
    { id: point.id, embedding: point.vector, ...payload },
  ]);
}

export async function searchFeedbackPatterns(
  repoId: string,
  queryVector: number[],
  limit = 5,
  orgId?: string,
  queryText?: string,
): Promise<{ title: string; description: string; feedback: string; repoId: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  try {
    // VS dict-filter has no native OR. When both repoId and orgId are given,
    // run two parallel queries and merge top-k by score.
    const queries: Promise<ScoredRow[]>[] = [
      vsQuery(vsIndexName(FEEDBACK_COLLECTION_NAME), queryVector, {
        filters: eqFilter("repoId", repoId),
        limit,
        columns: ["title", "description", "feedback", "repoId"],
      }),
    ];
    if (orgId) {
      queries.push(
        vsQuery(vsIndexName(FEEDBACK_COLLECTION_NAME), queryVector, {
          filters: eqFilter("orgId", orgId),
          limit,
          columns: ["title", "description", "feedback", "repoId"],
        }),
      );
    }
    const allRows = (await Promise.all(queries)).flat();
    // De-dupe by feedback+title and keep highest score; sort desc; take top `limit`.
    const seen = new Map<string, ScoredRow>();
    for (const r of allRows) {
      const key = `${r.payload.title ?? ""}::${r.payload.feedback ?? ""}`;
      const prev = seen.get(key);
      if (!prev || prev.score < r.score) seen.set(key, r);
    }
    const merged = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    return merged.map((r) => ({
      title: (r.payload.title as string) ?? "",
      description: (r.payload.description as string) ?? "",
      feedback: (r.payload.feedback as string) ?? "",
      repoId: (r.payload.repoId as string) ?? "",
      score: r.score,
    }));
  } catch {
    return [];
  }
}

export { FEEDBACK_COLLECTION_NAME };

// ─────────────────────────────────────────────────────────────────────────────
// docs_chunks
// ─────────────────────────────────────────────────────────────────────────────
const DOCS_COLLECTION_NAME = "docs_chunks";

export async function ensureDocsCollection() {
  // No-op.
}

export async function upsertDocsChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  if (points.length === 0) return;
  const rows = points.map((p) => ({
    id: p.id,
    embedding: p.vector,
    ...sanitizePayload(p.payload),
  }));
  await vsUpsert(vsIndexName(DOCS_COLLECTION_NAME), rows);
}

export async function deleteAllDocsChunks() {
  // Delete by `page IN (known doc pages)` — preserves the original behaviour
  // of scoping the wipe to Octopus's documentation pages rather than the whole index.
  const knownPages = [
    "landing",
    "getting-started",
    "cli",
    "pricing",
    "integrations",
    "self-hosting",
    "faq",
    "glossary",
    "skills",
    "about",
    "octopusignore",
  ];
  try {
    await vsDeleteByFilter(vsIndexName(DOCS_COLLECTION_NAME), inFilter("page", knownPages));
  } catch {
    // Index may be empty.
  }
}

export async function searchDocsChunks(
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ title: string; text: string; page: string; section: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  if (queryText) warnHybridDisabledOnce();
  const rows = await vsQuery(vsIndexName(DOCS_COLLECTION_NAME), queryVector, {
    limit,
    columns: ["title", "text", "page", "section"],
  });
  return rows.map((r) => ({
    title: (r.payload.title as string) ?? "",
    text: (r.payload.text as string) ?? "",
    page: (r.payload.page as string) ?? "",
    section: (r.payload.section as string) ?? "",
    score: r.score,
  }));
}

export { DOCS_COLLECTION_NAME };

// Legacy re-exports for callers that import the constant directly.
export { VECTOR_SIZE, SPARSE_VECTOR_NAME };
// Keep dbxConfig reachable so eager-loading paths don't tree-shake the host check.
void dbxConfig;
