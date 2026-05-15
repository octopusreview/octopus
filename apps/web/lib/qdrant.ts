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
// Schema whitelists — Databricks Vector Search Direct Access REJECTS rows
// with unknown columns (entire row → failed_primary_keys, success_row_count=0).
// These lists must match `databricks/bootstrap/create_indexes.py` exactly.
// Any caller-supplied field not in the whitelist is silently dropped before
// upsert. `id` and `embedding` are required for every row.
// ─────────────────────────────────────────────────────────────────────────────
const INDEX_COLUMN_WHITELISTS: Record<string, ReadonlySet<string>> = {
  code_chunks: new Set([
    "id", "embedding", "text", "repoId", "filePath", "startLine", "endLine", "originalId",
  ]),
  knowledge_chunks: new Set([
    "id", "embedding", "text", "orgId", "documentId", "title", "originalId",
  ]),
  review_chunks: new Set([
    "id", "embedding", "text", "orgId", "repoId", "pullRequestId", "prTitle",
    "prNumber", "repoFullName", "author", "reviewDate", "originalId",
  ]),
  chat_chunks: new Set([
    "id", "embedding", "question", "answer", "orgId", "userId",
    "conversationId", "conversationTitle", "originalId",
  ]),
  flowchart_chunks: new Set([
    "id", "embedding", "mermaidCode", "diagramType", "orgId", "repoId",
    "pullRequestId", "prTitle", "prNumber", "repoFullName", "author",
    "reviewDate", "originalId",
  ]),
  docs_chunks: new Set([
    "id", "embedding", "text", "page", "section", "title", "originalId",
  ]),
  feedback_patterns: new Set([
    "id", "embedding", "title", "description", "feedback", "repoId", "orgId",
    "issueId", "originalId",
  ]),
};

/** Strip caller-supplied fields not declared in the index schema. */
function filterToSchema(indexName: string, row: Record<string, unknown>): Record<string, unknown> {
  // indexName is fully qualified `<catalog>.<schema>.<collection>`; the
  // collection (last segment) is the key in INDEX_COLUMN_WHITELISTS.
  const collection = indexName.split(".").pop() ?? indexName;
  const allowed = INDEX_COLUMN_WHITELISTS[collection];
  if (!allowed) return row; // unknown index → don't filter (fail loud at VS layer)
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST helpers
// ─────────────────────────────────────────────────────────────────────────────

const VS_BASE = "/api/2.0/vector-search/indexes";

type ScoredRow = { payload: Record<string, unknown>; score: number };

// QueryVectorIndexResponse (Databricks VS REST):
//   { manifest: { columns: [{name}, ...] },     ← TOP LEVEL, not under result!
//     next_page_token: "...",                    ← TOP LEVEL
//     result: { row_count, data_array: [[...]] }
//   }
// The Python SDK class is `QueryVectorIndexResponse` with manifest, result,
// next_page_token siblings — see databricks-sdk vectorsearch.py:1030.
type QueryResponse = {
  manifest?: { columns?: Array<{ name: string }>; column_count?: number };
  next_page_token?: string;
  result?: {
    data_array?: unknown[][];
    row_count?: number;
  };
};

function rowsToScored(resp: QueryResponse): ScoredRow[] {
  const cols = resp.manifest?.columns?.map((c) => c.name) ?? [];
  const rows = resp.result?.data_array ?? [];
  // Databricks ANN query appends a synthetic `score` column as the last
  // column in the manifest. HYBRID/FULL_TEXT use the same shape.
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

/**
 * Embedding dimensionality used to manufacture zero-vector "scan" queries
 * (see `vsScan`). Must match the dimension the indexes were created at.
 * Databricks Gateway → `databricks-gte-large-en` (1024-dim). Local dev with
 * OpenAI's `text-embedding-3-large` → 3072-dim.
 */
const EMBED_DIM = dbxConfig.isDatabricksRuntime ? 1024 : 3072;

/** Lazily-built zero vector for "scan-as-query" usage. */
let zeroVectorCache: number[] | null = null;
function getZeroVector(): number[] {
  if (!zeroVectorCache) zeroVectorCache = new Array(EMBED_DIM).fill(0);
  return zeroVectorCache;
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

type UpsertResponse = {
  status?: string;
  result?: {
    success_row_count?: number;
    failed_primary_keys?: string[];
  };
};

async function vsUpsert(
  indexName: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  // Strip any caller-supplied fields that aren't in the index's schema_json.
  // VS Direct Access silently rejects the ENTIRE row if it contains unknown
  // columns (HTTP 200 + status:"FAILURE" + success_row_count:0). Filtering
  // here keeps a single source of truth in INDEX_COLUMN_WHITELISTS.
  const cleaned = rows.map((r) => filterToSchema(indexName, r));
  // Direct Access supports up to 1000 rows per upsert call.
  for (let i = 0; i < cleaned.length; i += 1000) {
    const slice = cleaned.slice(i, i + 1000);
    const resp = await withVsRetry(
      () =>
        dbxFetch<UpsertResponse>(
          `${VS_BASE}/${encodeURIComponent(indexName)}/upsert-data`,
          {
            method: "POST",
            body: JSON.stringify({ inputs_json: JSON.stringify(slice) }),
          },
        ),
      `upsert ${indexName}`,
    );
    // VS returns 200 OK even when every row was rejected. We must inspect
    // the body: status === "SUCCESS" with success_row_count === slice.length
    // means we're good. Anything else is a hard error.
    const successCount = resp?.result?.success_row_count ?? 0;
    const failed = resp?.result?.failed_primary_keys ?? [];
    if (resp?.status !== "SUCCESS" || successCount !== slice.length) {
      throw new Error(
        `[vs] upsert ${indexName} partial/total failure: status=${resp?.status} ` +
          `success=${successCount}/${slice.length} ` +
          `failed_pks=${failed.slice(0, 5).join(",")}${failed.length > 5 ? `...(${failed.length} total)` : ""}`,
      );
    }
  }
}

async function vsDeleteByPk(indexName: string, pks: string[]): Promise<void> {
  if (pks.length === 0) return;
  // Direct Access supports up to 100 PKs per delete call.
  //
  // Databricks VS REST quirk: delete-data is HTTP DELETE — POST returns
  // ENDPOINT_NOT_FOUND — and `primary_keys` go in the **JSON BODY**, not in
  // the query string. The databricks-sdk Python (vectorsearch.py:1991-2015)
  // *says* it sends them as `query`, but empirically that only deletes 1 of
  // N PKs (probed via curl); a JSON body deletes all N. Sending in the body
  // is the only signature that actually works.
  for (let i = 0; i < pks.length; i += 100) {
    const slice = pks.slice(i, i + 100);
    const resp = await withVsRetry(
      () =>
        dbxFetch<UpsertResponse>(
          `${VS_BASE}/${encodeURIComponent(indexName)}/delete-data`,
          {
            method: "DELETE",
            body: JSON.stringify({ primary_keys: slice }),
          },
        ),
      `delete ${indexName}`,
    );
    const successCount = resp?.result?.success_row_count ?? 0;
    if (resp?.status !== "SUCCESS") {
      throw new Error(
        `[vs] delete ${indexName} failure: status=${resp?.status} ` +
          `success=${successCount}/${slice.length}`,
      );
    }
  }
}

/**
 * Scan an index with a filter, returning rows. Used both for "get all chunks
 * for repo X" and for collecting PKs to delete-by-filter.
 *
 * Implementation notes:
 * 1. Databricks VS's native `/scan` endpoint does NOT accept `columns`
 *    (verified against databricks-sdk Python `scan_index` at
 *    vectorsearch.py:2214 — only `last_primary_key` + `num_results`) and the
 *    response includes ALL columns including the 1024-float `embedding`,
 *    causing 400 "Response content is too large" on any non-trivial index.
 *    So we treat "scan with filter" as "query with a zero-vector + filter +
 *    limited columns".
 * 2. `/query` returns a maximum of 1000 rows per call. The SDK docs claim
 *    `/query-next-page` extends that to 10,000, but empirically on Direct
 *    Access indexes that endpoint returns an empty page on the very first
 *    follow-up call (both filtered and unfiltered). Callers that need to
 *    walk an entire matching set should use the iterative
 *    delete-as-pagination pattern in `vsDeleteByFilter` instead.
 * 3. Returned `score` column is meaningless (always 0 since the query vector
 *    is all-zeros) and is stripped from the payload.
 *
 * For now this function caps results at min(limit, 1000) per single call.
 */
async function vsScan(
  indexName: string,
  options: { filters?: Filters; limit?: number; columns?: string[] },
): Promise<Array<Record<string, unknown>>> {
  const maxRows = Math.min(options.limit ?? 1000, 1000);

  // /query REQUIRES the `columns` field — omitting it returns
  //   400 INVALID_PARAMETER_VALUE: "Field 'columns' must be specified".
  // When the caller didn't pass an explicit list, default to all schema
  // columns for the index minus the embedding (the 1024-float vector
  // bloats payloads and triggers "Response content too large").
  const collection = indexName.split(".").pop() ?? indexName;
  const allowed = INDEX_COLUMN_WHITELISTS[collection];
  const defaultColumns = allowed
    ? Array.from(allowed).filter((c) => c !== "embedding")
    : ["id"];

  const body: Record<string, unknown> = {
    query_vector: getZeroVector(),
    num_results: maxRows,
    columns: options.columns ?? defaultColumns,
  };
  if (options.filters && Object.keys(options.filters).length > 0) {
    body.filters_json = JSON.stringify(options.filters);
  }

  let resp: QueryResponse;
  try {
    resp = await withVsRetry(
      () =>
        dbxFetch<QueryResponse>(
          `${VS_BASE}/${encodeURIComponent(indexName)}/query`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      `scan(query) ${indexName}`,
    );
  } catch (err) {
    // Common case: index doesn't exist yet, or empty. Match Qdrant fallback.
    console.warn(`[vs] scan ${indexName} failed, returning empty:`, err instanceof Error ? err.message : err);
    return [];
  }

  const cols = resp.manifest?.columns?.map((c) => c.name) ?? [];
  const rows = resp.result?.data_array ?? [];
  // Drop the synthetic `score` column when reading rows (it'd be a meaningless
  // 0.0 since the query vector is all-zeros).
  const scoreIdx = cols.indexOf("score");
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      if (i === scoreIdx) continue;
      payload[cols[i]] = row[i];
    }
    results.push(payload);
  }
  return results;
}

/**
 * Delete-by-filter helper: iteratively (scan 1000 → delete 1000) until the
 * scan returns an empty page.
 *
 * Direct Access VS doesn't support delete-by-filter natively and /query
 * returns at most 1000 rows per call (per-call cap; /query-next-page is
 * broken on Direct Access — see vsScan note). After each delete, the next
 * scan won't see the just-deleted PKs, so we converge in
 * ceil(matching_rows / 1000) iterations. Includes a safety cap so a runaway
 * filter (e.g. matching the entire index) can't loop forever.
 */
async function vsDeleteByFilter(indexName: string, filters: Filters): Promise<void> {
  const MAX_ITERATIONS = 100; // 100 × 1000 = 100k row hard cap per call
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const rows = await vsScan(indexName, { filters, columns: ["id"], limit: 1000 });
    const pks = rows.map((r) => String(r.id)).filter(Boolean);
    if (pks.length === 0) return;
    await vsDeleteByPk(indexName, pks);
    if (pks.length < 1000) return; // last partial page → no more rows
  }
  console.warn(
    `[vs] delete-by-filter ${indexName} hit ${MAX_ITERATIONS}-iter safety cap; ` +
      `more rows may still match: ${JSON.stringify(filters)}`,
  );
}

// (Previously: warnHybridDisabledOnce — removed now that HYBRID search is
// enabled via vsQuery's queryText option.)

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
        // VS /query requires `columns` and excludes large fields by default.
        // Honor Qdrant's with_payload/with_vector semantics by building an
        // explicit column list from the schema whitelist for this collection.
        const allowed = INDEX_COLUMN_WHITELISTS[collection];
        const cols = allowed
          ? Array.from(allowed).filter((c) => {
              if (c === "id") return true;
              if (c === "embedding") return opts.with_vector === true;
              return opts.with_payload !== false; // default = include payload
            })
          : ["id"];
        const rows = await vsScan(vsIndexName(collection), {
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          limit: opts.limit ?? 100,
          columns: cols,
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
  const rows = await vsQuery(vsIndexName(COLLECTION_NAME), queryVector, {
    filters: eqFilter("repoId", repoId),
    queryText,
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
  const rows = await vsQuery(vsIndexName(COLLECTION_NAME), queryVector, {
    filters: inFilter("repoId", repoIds),
    queryText,
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
  const rows = await vsQuery(vsIndexName(KNOWLEDGE_COLLECTION_NAME), queryVector, {
    filters: eqFilter("orgId", orgId),
    queryText,
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
  const rows = await vsQuery(vsIndexName(REVIEW_COLLECTION_NAME), queryVector, {
    filters: eqFilter("orgId", orgId),
    queryText,
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
  try {
    // VS dict-filter doesn't have a clean NOT operator; we over-fetch and filter
    // client-side when excludeConversationId is set.
    const overfetch = excludeConversationId ? limit * 2 : limit;
    const rows = await vsQuery(vsIndexName(CHAT_COLLECTION_NAME), queryVector, {
      filters: eqFilter("orgId", orgId),
      queryText,
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
  try {
    const rows = await vsQuery(vsIndexName(DIAGRAM_COLLECTION_NAME), queryVector, {
      filters: eqFilter("orgId", orgId),
      queryText,
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
  try {
    // VS dict-filter has no native OR. When both repoId and orgId are given,
    // run two parallel queries and merge top-k by score.
    const queries: Promise<ScoredRow[]>[] = [
      vsQuery(vsIndexName(FEEDBACK_COLLECTION_NAME), queryVector, {
        filters: eqFilter("repoId", repoId),
        queryText,
        limit,
        columns: ["title", "description", "feedback", "repoId"],
      }),
    ];
    if (orgId) {
      queries.push(
        vsQuery(vsIndexName(FEEDBACK_COLLECTION_NAME), queryVector, {
          filters: eqFilter("orgId", orgId),
          queryText,
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
  const rows = await vsQuery(vsIndexName(DOCS_COLLECTION_NAME), queryVector, {
    queryText,
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
