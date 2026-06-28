/**
 * Migration script: Recreate Qdrant collections with sparse vector support.
 *
 * Existing collections were created with unnamed single vectors which don't
 * support adding sparse vectors. This script:
 * 1. Creates a temporary collection with proper config (dense + sparse)
 * 2. Copies all points from old collection to new one
 * 3. Deletes old collection and renames new one
 *
 * Safe to re-run — skips collections that already have sparse vector config.
 *
 * Usage: QDRANT_URL=http://... bun run --cwd apps/web scripts/migrate-collections-sparse.ts
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { generateSparseVector } from "@/lib/sparse-vector";
import { getEmbedConfig } from "@/lib/embed-config";

// Match the dim the app uses (env-resolved via getEmbedConfig, default 3072)
// so a self-hoster on a non-default OCTOPUS_EMBED_DIM recreates collections
// at the right size instead of a hardcoded 3072.
const VECTOR_SIZE = getEmbedConfig().dim;
const SPARSE_VECTOR_NAME = "sparse";
const BATCH_SIZE = 100;

const COLLECTIONS = [
  {
    name: "code_chunks",
    textField: "text",
    indexes: [{ field: "repoId", schema: "keyword" as const }],
  },
  {
    name: "knowledge_chunks",
    textField: "text",
    indexes: [
      { field: "orgId", schema: "keyword" as const },
      { field: "documentId", schema: "keyword" as const },
    ],
  },
  {
    name: "review_chunks",
    textField: "text",
    indexes: [
      { field: "orgId", schema: "keyword" as const },
      { field: "repoId", schema: "keyword" as const },
      { field: "pullRequestId", schema: "keyword" as const },
    ],
  },
  {
    name: "chat_chunks",
    textField: "question",
    indexes: [
      { field: "orgId", schema: "keyword" as const },
      { field: "conversationId", schema: "keyword" as const },
      { field: "userId", schema: "keyword" as const },
    ],
  },
  {
    name: "flowchart_chunks",
    textField: "mermaidCode",
    indexes: [
      { field: "orgId", schema: "keyword" as const },
      { field: "repoId", schema: "keyword" as const },
      { field: "pullRequestId", schema: "keyword" as const },
      { field: "diagramType", schema: "keyword" as const },
    ],
  },
  {
    name: "feedback_patterns",
    textField: "title",
    indexes: [
      { field: "repoId", schema: "keyword" as const },
      { field: "orgId", schema: "keyword" as const },
      { field: "feedback", schema: "keyword" as const },
    ],
  },
];

function getTextForSparse(
  colName: string,
  payload: Record<string, unknown>,
  textField: string,
): string {
  if (colName === "feedback_patterns") {
    return `${(payload.title as string) ?? ""} ${(payload.description as string) ?? ""}`;
  }
  if (colName === "chat_chunks") {
    return `${(payload.question as string) ?? ""} ${(payload.answer as string) ?? ""}`;
  }
  return (payload[textField] as string) ?? "";
}

async function main() {
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });

  for (const col of COLLECTIONS) {
    console.log(`\n[migrate] === ${col.name} ===`);

    // Check if collection exists
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === col.name);
    if (!exists) {
      console.log(`  Collection doesn't exist, creating fresh with sparse support...`);
      await qdrant.createCollection(col.name, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
      for (const idx of col.indexes) {
        await qdrant.createPayloadIndex(col.name, {
          field_name: idx.field,
          field_schema: idx.schema,
        });
      }
      console.log(`  ✓ Created with sparse vectors`);
      continue;
    }

    // Check if already has sparse vectors by trying a query
    try {
      await qdrant.query(col.name, {
        prefetch: [
          {
            query: new Array(VECTOR_SIZE).fill(0),
            limit: 1,
          },
          {
            query: { indices: [1], values: [1.0] },
            using: SPARSE_VECTOR_NAME,
            limit: 1,
          },
        ],
        query: { fusion: "rrf" },
        limit: 1,
      });
      console.log(`  ✓ Already supports sparse vectors, skipping`);
      continue;
    } catch {
      // Needs migration
    }

    const tmpName = `${col.name}_tmp_migrate`;

    // Clean up any leftover tmp collection
    try {
      await qdrant.deleteCollection(tmpName);
    } catch {
      // doesn't exist, fine
    }

    // Create temp collection with sparse vector config
    console.log(`  Creating temp collection with sparse vectors...`);
    await qdrant.createCollection(tmpName, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });

    // Copy all points
    let offset: string | number | undefined = undefined;
    let total = 0;

    while (true) {
      const result = await qdrant.scroll(col.name, {
        limit: BATCH_SIZE,
        offset,
        with_payload: true,
        with_vector: true,
      });

      if (result.points.length === 0) break;

      const points = result.points.map((point) => {
        const text = getTextForSparse(
          col.name,
          (point.payload as Record<string, unknown>) ?? {},
          col.textField,
        );
        const sparseVector = generateSparseVector(text);
        const denseVector = Array.isArray(point.vector)
          ? point.vector
          : [];

        return {
          id: point.id,
          vector: {
            "": denseVector as number[],
            [SPARSE_VECTOR_NAME]: sparseVector,
          },
          payload: (point.payload as Record<string, unknown>) ?? {},
        };
      });

      await qdrant.upsert(tmpName, { points });
      total += points.length;

      if (total % 1000 === 0 || result.points.length < BATCH_SIZE) {
        console.log(`  Copied ${total} points...`);
      }

      offset = result.next_page_offset as string | number | undefined;
      if (!offset) break;
    }

    // Swap collections
    console.log(`  Deleting old collection...`);
    await qdrant.deleteCollection(col.name);

    // Qdrant doesn't support rename, so we need to copy back
    console.log(`  Creating new collection with original name...`);
    await qdrant.createCollection(col.name, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
    });

    // Create indexes
    for (const idx of col.indexes) {
      await qdrant.createPayloadIndex(col.name, {
        field_name: idx.field,
        field_schema: idx.schema,
      });
    }

    // Copy from tmp to final
    offset = undefined;
    let copied = 0;

    while (true) {
      const result = await qdrant.scroll(tmpName, {
        limit: BATCH_SIZE,
        offset,
        with_payload: true,
        with_vector: true,
      });

      if (result.points.length === 0) break;

      const points = result.points.map((point) => {
        const vector = point.vector as Record<string, unknown>;
        return {
          id: point.id,
          vector: {
            "": (vector[""] ?? []) as number[],
            [SPARSE_VECTOR_NAME]: vector[SPARSE_VECTOR_NAME] as {
              indices: number[];
              values: number[];
            },
          },
          payload: (point.payload as Record<string, unknown>) ?? {},
        };
      });

      await qdrant.upsert(col.name, { points });
      copied += points.length;

      if (copied % 1000 === 0 || result.points.length < BATCH_SIZE) {
        console.log(`  Restored ${copied}/${total} points...`);
      }

      offset = result.next_page_offset as string | number | undefined;
      if (!offset) break;
    }

    // Cleanup tmp
    await qdrant.deleteCollection(tmpName);
    console.log(`  ✓ Done — ${total} points migrated with sparse vectors`);
  }

  console.log("\n[migrate] All collections migrated!");
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
