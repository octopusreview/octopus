/**
 * Backfill script: Add sparse vectors to existing Qdrant points for hybrid search.
 *
 * Scrolls through all points in each collection, generates sparse vectors from
 * the text payload, and upserts back with both dense + sparse vectors.
 *
 * Safe to re-run (idempotent — upsert overwrites existing points).
 *
 * Usage: bun run --cwd apps/web scripts/backfill-sparse-vectors.ts
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { generateSparseVector } from "@/lib/sparse-vector";

const SPARSE_VECTOR_NAME = "sparse";
const BATCH_SIZE = 100;

const COLLECTIONS = [
  { name: "code_chunks", textField: "text" },
  { name: "knowledge_chunks", textField: "text" },
  { name: "review_chunks", textField: "text" },
  { name: "chat_chunks", textField: "question" }, // use question for sparse (more keyword-rich)
  { name: "flowchart_chunks", textField: "mermaidCode" },
  { name: "feedback_patterns", textField: "title" }, // title + description combined below
];

async function main() {
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });

  for (const col of COLLECTIONS) {
    console.log(`\n[backfill] Processing collection: ${col.name}`);

    // Ensure sparse vector config exists
    try {
      await qdrant.updateCollection(col.name, {
        sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
      });
      console.log(`  ✓ Sparse vector config added`);
    } catch {
      console.log(`  ✓ Sparse vector config already exists`);
    }

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
        // Extract text for sparse vector generation
        let text: string;
        if (col.name === "feedback_patterns") {
          text = `${(point.payload?.title as string) ?? ""} ${(point.payload?.description as string) ?? ""}`;
        } else if (col.name === "chat_chunks") {
          text = `${(point.payload?.question as string) ?? ""} ${(point.payload?.answer as string) ?? ""}`;
        } else {
          text = (point.payload?.[col.textField] as string) ?? "";
        }

        const sparseVector = generateSparseVector(text);

        // Get existing dense vector (unnamed default)
        const denseVector = Array.isArray(point.vector)
          ? point.vector
          : (point.vector as Record<string, number[]>)?.[""] ?? [];

        return {
          id: point.id,
          vector: {
            "": denseVector as number[],
            [SPARSE_VECTOR_NAME]: sparseVector,
          },
          payload: point.payload ?? {},
        };
      });

      await qdrant.upsert(col.name, { points });

      total += points.length;
      console.log(`  Processed ${total} points...`);

      offset = result.next_page_offset as string | number | undefined;
      if (!offset) break;
    }

    console.log(`  ✓ Done — ${total} points updated`);
  }

  console.log("\n[backfill] All collections updated with sparse vectors!");
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
