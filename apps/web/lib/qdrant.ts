import { QdrantClient } from "@qdrant/js-client-rest";
import { generateSparseVector } from "@/lib/sparse-vector";

function isSparseVectorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const errorData = typeof error === "object" && error !== null && "data" in error ? JSON.stringify((error as Record<string, unknown>).data) : "";
  const combined = `${message} ${errorData}`;
  return combined.includes("named vector") || combined.includes("sparse") || combined.includes("Wrong input") || combined.includes("Not existing vector name") || combined.includes("Bad Request");
}

const COLLECTION_NAME = "code_chunks";
const VECTOR_SIZE = 3072; // text-embedding-3-large
const SPARSE_VECTOR_NAME = "sparse";

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: process.env.QDRANT_URL!,
    });
  }
  return client;
}

export async function ensureCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { "": { size: VECTOR_SIZE, distance: "Cosine" } },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "repoId",
      field_schema: "keyword",
    });
  } else {
    // Add sparse vector config to existing collection
    try {
      await qdrant.updateCollection(COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  const qdrant = getQdrantClient();
  // Qdrant accepts max 100 points per request
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100).map((p) => ({
      id: p.id,
      vector: p.sparseVector
        ? { "": p.vector, [SPARSE_VECTOR_NAME]: p.sparseVector }
        : p.vector,
      payload: p.payload,
    }));
    try {
      await qdrant.upsert(COLLECTION_NAME, { points: batch });
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only upsert", { collection: COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      const denseBatch = points.slice(i, i + 100).map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));
      await qdrant.upsert(COLLECTION_NAME, { points: denseBatch });
    }
  }
}

export async function deleteRepoChunks(repoId: string) {
  const qdrant = getQdrantClient();
  await qdrant.delete(COLLECTION_NAME, {
    filter: {
      must: [{ key: "repoId", match: { value: repoId } }],
    },
  });
}

export async function deleteRepoFileChunks(repoId: string, filePaths: string[]) {
  if (filePaths.length === 0) return;
  const qdrant = getQdrantClient();
  await qdrant.delete(COLLECTION_NAME, {
    filter: {
      must: [
        { key: "repoId", match: { value: repoId } },
        { key: "filePath", match: { any: filePaths } },
      ],
    },
  });
}

export async function getRepoChunks(
  repoId: string,
  limit = 50,
): Promise<string[]> {
  const qdrant = getQdrantClient();
  const result = await qdrant.scroll(COLLECTION_NAME, {
    filter: {
      must: [{ key: "repoId", match: { value: repoId } }],
    },
    limit,
    with_payload: true,
    with_vector: false,
  });

  return result.points
    .map((p) => (p.payload?.text as string) ?? "")
    .filter(Boolean);
}

export async function searchSimilarChunks(
  repoId: string,
  queryVector: number[],
  limit = 20,
  queryText?: string,
): Promise<{ filePath: string; text: string; startLine: number; endLine: number; score: number }[]> {
  const qdrant = getQdrantClient();
  const filter = { must: [{ key: "repoId", match: { value: repoId } }] };

  let points: { payload?: Record<string, unknown> | null; score: number }[];

  if (queryText) {
    try {
      const sparseQuery = generateSparseVector(queryText);
      const result = await qdrant.query(COLLECTION_NAME, {
        prefetch: [
          { query: queryVector, limit: limit * 2, filter },
          { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      });
      points = result.points;
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only search", { collection: COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      points = await qdrant.search(COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }
  } else {
    points = await qdrant.search(COLLECTION_NAME, {
      vector: queryVector,
      filter,
      limit,
      with_payload: true,
    });
  }

  return points.map((point) => ({
    filePath: (point.payload?.filePath as string) ?? "",
    text: (point.payload?.text as string) ?? "",
    startLine: (point.payload?.startLine as number) ?? 0,
    endLine: (point.payload?.endLine as number) ?? 0,
    score: point.score,
  }));
}

export async function searchCodeChunksAcrossRepos(
  repoIds: string[],
  queryVector: number[],
  limit = 20,
  queryText?: string,
): Promise<{ filePath: string; text: string; startLine: number; endLine: number; repoId: string; score: number }[]> {
  if (repoIds.length === 0) return [];
  const qdrant = getQdrantClient();
  const filter = {
    should: repoIds.map((id) => ({
      key: "repoId",
      match: { value: id },
    })),
  };

  let points: { payload?: Record<string, unknown> | null; score: number }[];

  if (queryText) {
    try {
      const sparseQuery = generateSparseVector(queryText);
      const result = await qdrant.query(COLLECTION_NAME, {
        prefetch: [
          { query: queryVector, limit: limit * 2, filter },
          { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      });
      points = result.points;
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only search", { collection: COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      points = await qdrant.search(COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }
  } else {
    points = await qdrant.search(COLLECTION_NAME, {
      vector: queryVector,
      filter,
      limit,
      with_payload: true,
    });
  }

  return points.map((point) => ({
    filePath: (point.payload?.filePath as string) ?? "",
    text: (point.payload?.text as string) ?? "",
    startLine: (point.payload?.startLine as number) ?? 0,
    endLine: (point.payload?.endLine as number) ?? 0,
    repoId: (point.payload?.repoId as string) ?? "",
    score: point.score,
  }));
}

export { COLLECTION_NAME };

// --- Knowledge Chunks ---

const KNOWLEDGE_COLLECTION_NAME = "knowledge_chunks";

export async function ensureKnowledgeCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === KNOWLEDGE_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(KNOWLEDGE_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(KNOWLEDGE_COLLECTION_NAME, {
      field_name: "orgId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(KNOWLEDGE_COLLECTION_NAME, {
      field_name: "documentId",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(KNOWLEDGE_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertKnowledgeChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  const qdrant = getQdrantClient();
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100).map((p) => ({
      id: p.id,
      vector: p.sparseVector
        ? { "": p.vector, [SPARSE_VECTOR_NAME]: p.sparseVector }
        : p.vector,
      payload: p.payload,
    }));
    try {
      await qdrant.upsert(KNOWLEDGE_COLLECTION_NAME, { points: batch });
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only upsert", { collection: KNOWLEDGE_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      const denseBatch = points.slice(i, i + 100).map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));
      await qdrant.upsert(KNOWLEDGE_COLLECTION_NAME, { points: denseBatch });
    }
  }
}

export async function deleteKnowledgeDocumentChunks(documentId: string) {
  const qdrant = getQdrantClient();
  await qdrant.delete(KNOWLEDGE_COLLECTION_NAME, {
    filter: {
      must: [{ key: "documentId", match: { value: documentId } }],
    },
  });
}

export async function searchKnowledgeChunks(
  orgId: string,
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ title: string; text: string; score: number }[]> {
  const qdrant = getQdrantClient();
  const filter = { must: [{ key: "orgId", match: { value: orgId } }] };

  let points: { payload?: Record<string, unknown> | null; score: number }[];

  if (queryText) {
    try {
      const sparseQuery = generateSparseVector(queryText);
      const result = await qdrant.query(KNOWLEDGE_COLLECTION_NAME, {
        prefetch: [
          { query: queryVector, limit: limit * 2, filter },
          { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      });
      points = result.points;
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only search", { collection: KNOWLEDGE_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      points = await qdrant.search(KNOWLEDGE_COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }
  } else {
    points = await qdrant.search(KNOWLEDGE_COLLECTION_NAME, {
      vector: queryVector,
      filter,
      limit,
      with_payload: true,
    });
  }

  return points.map((point) => ({
    title: (point.payload?.title as string) ?? "",
    text: (point.payload?.text as string) ?? "",
    score: point.score,
  }));
}

export async function getKnowledgeChunksByOrg(
  orgId: string,
  limit = 20,
): Promise<string[]> {
  const qdrant = getQdrantClient();
  try {
    const result = await qdrant.scroll(KNOWLEDGE_COLLECTION_NAME, {
      filter: {
        must: [{ key: "orgId", match: { value: orgId } }],
      },
      limit,
      with_payload: true,
      with_vector: false,
    });

    return result.points
      .map((p) => (p.payload?.text as string) ?? "")
      .filter(Boolean);
  } catch {
    // Collection doesn't exist yet — no knowledge docs uploaded
    return [];
  }
}

export { KNOWLEDGE_COLLECTION_NAME };

// --- Review Chunks ---

const REVIEW_COLLECTION_NAME = "review_chunks";

export async function ensureReviewCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === REVIEW_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(REVIEW_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(REVIEW_COLLECTION_NAME, {
      field_name: "orgId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(REVIEW_COLLECTION_NAME, {
      field_name: "repoId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(REVIEW_COLLECTION_NAME, {
      field_name: "pullRequestId",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(REVIEW_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertReviewChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  const qdrant = getQdrantClient();
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100).map((p) => ({
      id: p.id,
      vector: p.sparseVector
        ? { "": p.vector, [SPARSE_VECTOR_NAME]: p.sparseVector }
        : p.vector,
      payload: p.payload,
    }));
    try {
      await qdrant.upsert(REVIEW_COLLECTION_NAME, { points: batch });
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only upsert", { collection: REVIEW_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      const denseBatch = points.slice(i, i + 100).map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));
      await qdrant.upsert(REVIEW_COLLECTION_NAME, { points: denseBatch });
    }
  }
}

export async function deleteReviewChunksByPR(pullRequestId: string) {
  const qdrant = getQdrantClient();
  await qdrant.delete(REVIEW_COLLECTION_NAME, {
    filter: {
      must: [{ key: "pullRequestId", match: { value: pullRequestId } }],
    },
  });
}

export async function searchReviewChunks(
  orgId: string,
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ text: string; prTitle: string; prNumber: number; repoFullName: string; author: string; reviewDate: string; score: number }[]> {
  const qdrant = getQdrantClient();
  const filter = { must: [{ key: "orgId", match: { value: orgId } }] };

  let points: { payload?: Record<string, unknown> | null; score: number }[];

  if (queryText) {
    try {
      const sparseQuery = generateSparseVector(queryText);
      const result = await qdrant.query(REVIEW_COLLECTION_NAME, {
        prefetch: [
          { query: queryVector, limit: limit * 2, filter },
          { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      });
      points = result.points;
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only search", { collection: REVIEW_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      points = await qdrant.search(REVIEW_COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }
  } else {
    points = await qdrant.search(REVIEW_COLLECTION_NAME, {
      vector: queryVector,
      filter,
      limit,
      with_payload: true,
    });
  }

  return points.map((point) => ({
    text: (point.payload?.text as string) ?? "",
    prTitle: (point.payload?.prTitle as string) ?? "",
    prNumber: (point.payload?.prNumber as number) ?? 0,
    repoFullName: (point.payload?.repoFullName as string) ?? "",
    author: (point.payload?.author as string) ?? "",
    reviewDate: (point.payload?.reviewDate as string) ?? "",
    score: point.score,
  }));
}

export { REVIEW_COLLECTION_NAME };

// --- Chat Chunks ---

const CHAT_COLLECTION_NAME = "chat_chunks";

export async function ensureChatCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === CHAT_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(CHAT_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(CHAT_COLLECTION_NAME, {
      field_name: "orgId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(CHAT_COLLECTION_NAME, {
      field_name: "conversationId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(CHAT_COLLECTION_NAME, {
      field_name: "userId",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(CHAT_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertChatChunk(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  const qdrant = getQdrantClient();
  const qdrantPoint = {
    id: point.id,
    vector: point.sparseVector
      ? { "": point.vector, [SPARSE_VECTOR_NAME]: point.sparseVector }
      : point.vector,
    payload: point.payload,
  };
  try {
    await qdrant.upsert(CHAT_COLLECTION_NAME, { points: [qdrantPoint] });
  } catch (error) {
    if (!isSparseVectorError(error)) throw error;
    console.warn("[qdrant] Falling back to dense-only upsert", { collection: CHAT_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
    await qdrant.upsert(CHAT_COLLECTION_NAME, { points: [{ id: point.id, vector: point.vector, payload: point.payload }] });
  }
}

export async function searchChatChunks(
  orgId: string,
  queryVector: number[],
  limit = 5,
  excludeConversationId?: string,
  queryText?: string,
): Promise<{ question: string; answer: string; conversationId: string; conversationTitle: string; score: number }[]> {
  const qdrant = getQdrantClient();
  try {
    const filter: Record<string, unknown> = {
      must: [{ key: "orgId", match: { value: orgId } }],
    };
    if (excludeConversationId) {
      (filter as { must_not?: unknown[] }).must_not = [
        { key: "conversationId", match: { value: excludeConversationId } },
      ];
    }

    let points: { payload?: Record<string, unknown> | null; score: number }[];

    if (queryText) {
      try {
        const sparseQuery = generateSparseVector(queryText);
        const result = await qdrant.query(CHAT_COLLECTION_NAME, {
          prefetch: [
            { query: queryVector, limit: limit * 2, filter },
            { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
          ],
          query: { fusion: "rrf" },
          limit,
          with_payload: true,
        });
        points = result.points;
      } catch (error) {
        if (!isSparseVectorError(error)) throw error;
        console.warn("[qdrant] Falling back to dense-only search", { collection: CHAT_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
        points = await qdrant.search(CHAT_COLLECTION_NAME, {
          vector: queryVector,
          filter,
          limit,
          with_payload: true,
        });
      }
    } else {
      points = await qdrant.search(CHAT_COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }

    return points.map((point) => ({
      question: (point.payload?.question as string) ?? "",
      answer: (point.payload?.answer as string) ?? "",
      conversationId: (point.payload?.conversationId as string) ?? "",
      conversationTitle: (point.payload?.conversationTitle as string) ?? "",
      score: point.score,
    }));
  } catch {
    return [];
  }
}

export async function deleteChatChunksByConversation(conversationId: string) {
  const qdrant = getQdrantClient();
  await qdrant.delete(CHAT_COLLECTION_NAME, {
    filter: {
      must: [{ key: "conversationId", match: { value: conversationId } }],
    },
  });
}

export { CHAT_COLLECTION_NAME };

// --- Diagram Chunks (collection name kept as flowchart_chunks to avoid migration) ---

const DIAGRAM_COLLECTION_NAME = "flowchart_chunks";

export async function ensureDiagramCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === DIAGRAM_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(DIAGRAM_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(DIAGRAM_COLLECTION_NAME, {
      field_name: "orgId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(DIAGRAM_COLLECTION_NAME, {
      field_name: "repoId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(DIAGRAM_COLLECTION_NAME, {
      field_name: "pullRequestId",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(DIAGRAM_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }

  // Add diagramType index (safe for existing collections)
  try {
    await qdrant.createPayloadIndex(DIAGRAM_COLLECTION_NAME, {
      field_name: "diagramType",
      field_schema: "keyword",
    });
  } catch {
    // Index may already exist
  }
}

export async function upsertDiagramChunk(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  const qdrant = getQdrantClient();
  const qdrantPoint = {
    id: point.id,
    vector: point.sparseVector
      ? { "": point.vector, [SPARSE_VECTOR_NAME]: point.sparseVector }
      : point.vector,
    payload: point.payload,
  };
  try {
    await qdrant.upsert(DIAGRAM_COLLECTION_NAME, { points: [qdrantPoint] });
  } catch (error) {
    if (!isSparseVectorError(error)) throw error;
    console.warn("[qdrant] Falling back to dense-only upsert", { collection: DIAGRAM_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
    await qdrant.upsert(DIAGRAM_COLLECTION_NAME, { points: [{ id: point.id, vector: point.vector, payload: point.payload }] });
  }
}

export async function deleteDiagramChunksByPR(pullRequestId: string) {
  const qdrant = getQdrantClient();
  await qdrant.delete(DIAGRAM_COLLECTION_NAME, {
    filter: {
      must: [{ key: "pullRequestId", match: { value: pullRequestId } }],
    },
  });
}

export async function searchDiagramChunks(
  orgId: string,
  queryVector: number[],
  limit = 3,
  queryText?: string,
): Promise<{ mermaidCode: string; diagramType: string; prTitle: string; prNumber: number; repoFullName: string; author: string; reviewDate: string; score: number }[]> {
  const qdrant = getQdrantClient();
  try {
    const filter = { must: [{ key: "orgId", match: { value: orgId } }] };

    let points: { payload?: Record<string, unknown> | null; score: number }[];

    if (queryText) {
      try {
        const sparseQuery = generateSparseVector(queryText);
        const result = await qdrant.query(DIAGRAM_COLLECTION_NAME, {
          prefetch: [
            { query: queryVector, limit: limit * 2, filter },
            { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
          ],
          query: { fusion: "rrf" },
          limit,
          with_payload: true,
        });
        points = result.points;
      } catch (error) {
        if (!isSparseVectorError(error)) throw error;
        console.warn("[qdrant] Falling back to dense-only search", { collection: DIAGRAM_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
        points = await qdrant.search(DIAGRAM_COLLECTION_NAME, {
          vector: queryVector,
          filter,
          limit,
          with_payload: true,
        });
      }
    } else {
      points = await qdrant.search(DIAGRAM_COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }

    return points.map((point) => ({
      mermaidCode: (point.payload?.mermaidCode as string) ?? "",
      diagramType: (point.payload?.diagramType as string) ?? "flowchart",
      prTitle: (point.payload?.prTitle as string) ?? "",
      prNumber: (point.payload?.prNumber as number) ?? 0,
      repoFullName: (point.payload?.repoFullName as string) ?? "",
      author: (point.payload?.author as string) ?? "",
      reviewDate: (point.payload?.reviewDate as string) ?? "",
      score: point.score,
    }));
  } catch {
    return [];
  }
}

export { DIAGRAM_COLLECTION_NAME };

// --- Feedback Patterns ---

const FEEDBACK_COLLECTION_NAME = "feedback_patterns";

export async function ensureFeedbackCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === FEEDBACK_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(FEEDBACK_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(FEEDBACK_COLLECTION_NAME, {
      field_name: "repoId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(FEEDBACK_COLLECTION_NAME, {
      field_name: "orgId",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(FEEDBACK_COLLECTION_NAME, {
      field_name: "feedback",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(FEEDBACK_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertFeedbackPattern(point: {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  sparseVector?: { indices: number[]; values: number[] };
}) {
  const qdrant = getQdrantClient();
  const qdrantPoint = {
    id: point.id,
    vector: point.sparseVector
      ? { "": point.vector, [SPARSE_VECTOR_NAME]: point.sparseVector }
      : point.vector,
    payload: point.payload,
  };
  try {
    await qdrant.upsert(FEEDBACK_COLLECTION_NAME, { points: [qdrantPoint] });
  } catch (error) {
    if (!isSparseVectorError(error)) throw error;
    console.warn("[qdrant] Falling back to dense-only upsert", { collection: FEEDBACK_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
    await qdrant.upsert(FEEDBACK_COLLECTION_NAME, { points: [{ id: point.id, vector: point.vector, payload: point.payload }] });
  }
}

export async function searchFeedbackPatterns(
  repoId: string,
  queryVector: number[],
  limit = 5,
  orgId?: string,
  queryText?: string,
): Promise<{ title: string; description: string; feedback: string; repoId: string; score: number }[]> {
  const qdrant = getQdrantClient();
  try {
    // Search repo-scoped patterns first
    const filter: Record<string, unknown> = orgId
      ? {
          should: [
            { key: "repoId", match: { value: repoId } },
            { key: "orgId", match: { value: orgId } },
          ],
        }
      : {
          must: [{ key: "repoId", match: { value: repoId } }],
        };

    let points: { payload?: Record<string, unknown> | null; score: number }[];

    if (queryText) {
      try {
        const sparseQuery = generateSparseVector(queryText);
        const result = await qdrant.query(FEEDBACK_COLLECTION_NAME, {
          prefetch: [
            { query: queryVector, limit: limit * 2, filter },
            { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2, filter },
          ],
          query: { fusion: "rrf" },
          limit,
          with_payload: true,
        });
        points = result.points;
      } catch (error) {
        if (!isSparseVectorError(error)) throw error;
        console.warn("[qdrant] Falling back to dense-only search", { collection: FEEDBACK_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
        points = await qdrant.search(FEEDBACK_COLLECTION_NAME, {
          vector: queryVector,
          filter,
          limit,
          with_payload: true,
        });
      }
    } else {
      points = await qdrant.search(FEEDBACK_COLLECTION_NAME, {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
      });
    }

    return points.map((point) => ({
      title: (point.payload?.title as string) ?? "",
      description: (point.payload?.description as string) ?? "",
      feedback: (point.payload?.feedback as string) ?? "",
      repoId: (point.payload?.repoId as string) ?? "",
      score: point.score,
    }));
  } catch {
    return [];
  }
}

export { FEEDBACK_COLLECTION_NAME };

// --- Docs Chunks (public landing page & documentation content) ---

const DOCS_COLLECTION_NAME = "docs_chunks";

export async function ensureDocsCollection() {
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === DOCS_COLLECTION_NAME,
  );

  if (!exists) {
    await qdrant.createCollection(DOCS_COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });
    await qdrant.createPayloadIndex(DOCS_COLLECTION_NAME, {
      field_name: "section",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(DOCS_COLLECTION_NAME, {
      field_name: "page",
      field_schema: "keyword",
    });
  } else {
    try {
      await qdrant.updateCollection(DOCS_COLLECTION_NAME, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
    } catch (err) {
      console.debug(`[qdrant] sparse vector config already exists or update failed:`, err);
    }
  }
}

export async function upsertDocsChunks(
  points: {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
    sparseVector?: { indices: number[]; values: number[] };
  }[],
) {
  const qdrant = getQdrantClient();
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100).map((p) => ({
      id: p.id,
      vector: p.sparseVector
        ? { "": p.vector, [SPARSE_VECTOR_NAME]: p.sparseVector }
        : p.vector,
      payload: p.payload,
    }));
    try {
      await qdrant.upsert(DOCS_COLLECTION_NAME, { points: batch });
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only upsert", { collection: DOCS_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      const denseBatch = points.slice(i, i + 100).map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      }));
      await qdrant.upsert(DOCS_COLLECTION_NAME, { points: denseBatch });
    }
  }
}

export async function deleteAllDocsChunks() {
  const qdrant = getQdrantClient();
  try {
    await qdrant.delete(DOCS_COLLECTION_NAME, {
      filter: { must: [{ key: "page", match: { any: ["landing", "getting-started", "cli", "pricing", "integrations", "self-hosting", "faq", "glossary", "skills", "about", "octopusignore"] } }] },
    });
  } catch {
    // Collection may not exist yet
  }
}

export async function searchDocsChunks(
  queryVector: number[],
  limit = 10,
  queryText?: string,
): Promise<{ title: string; text: string; page: string; section: string; score: number }[]> {
  const qdrant = getQdrantClient();

  let points: { payload?: Record<string, unknown> | null; score: number }[];

  if (queryText) {
    try {
      const sparseQuery = generateSparseVector(queryText);
      const result = await qdrant.query(DOCS_COLLECTION_NAME, {
        prefetch: [
          { query: queryVector, limit: limit * 2 },
          { query: { indices: sparseQuery.indices, values: sparseQuery.values }, using: SPARSE_VECTOR_NAME, limit: limit * 2 },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      });
      points = result.points;
    } catch (error) {
      if (!isSparseVectorError(error)) throw error;
      console.warn("[qdrant] Falling back to dense-only search", { collection: DOCS_COLLECTION_NAME, error: error instanceof Error ? error.message : error });
      points = await qdrant.search(DOCS_COLLECTION_NAME, {
        vector: queryVector,
        limit,
        with_payload: true,
      });
    }
  } else {
    points = await qdrant.search(DOCS_COLLECTION_NAME, {
      vector: queryVector,
      limit,
      with_payload: true,
    });
  }

  return points.map((point) => ({
    title: (point.payload?.title as string) ?? "",
    text: (point.payload?.text as string) ?? "",
    page: (point.payload?.page as string) ?? "",
    section: (point.payload?.section as string) ?? "",
    score: point.score,
  }));
}

export { DOCS_COLLECTION_NAME };
