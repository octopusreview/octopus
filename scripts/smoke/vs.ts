#!/usr/bin/env bun
/**
 * Vector Search smoke test.
 *
 * Inserts a single fake vector against `code_chunks` with `repoId="smoke"`,
 * queries top-5, asserts the chunk comes back, deletes it, re-queries to
 * confirm cleanup. Exits non-zero on any failure.
 *
 * Requires: DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET in env.
 */

import {
  upsertChunks,
  searchSimilarChunks,
  deleteRepoChunks,
  getRepoChunks,
} from "../../apps/web/lib/qdrant";

const REPO_ID = "smoke-test-repo";
const VECTOR_SIZE = 3072;

function randomVector(): number[] {
  const v = new Array<number>(VECTOR_SIZE);
  for (let i = 0; i < VECTOR_SIZE; i++) v[i] = Math.random();
  // Normalise (cosine similarity)
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  for (let i = 0; i < VECTOR_SIZE; i++) v[i] /= norm;
  return v;
}

async function main(): Promise<void> {
  const id = `smoke-${Date.now()}`;
  const vector = randomVector();
  const text = "hello world (smoke test)";

  console.log(`[smoke] upsert ${id} → code_chunks`);
  await upsertChunks([
    {
      id,
      vector,
      payload: {
        repoId: REPO_ID,
        filePath: "smoke.ts",
        text,
        startLine: 1,
        endLine: 1,
      },
    },
  ]);

  console.log(`[smoke] query top-5`);
  const hits = await searchSimilarChunks(REPO_ID, vector, 5);
  if (hits.length === 0) throw new Error("expected at least one hit");
  const found = hits.find((h) => h.text === text);
  if (!found) throw new Error(`smoke chunk not in top-5: got ${JSON.stringify(hits.map((h) => h.text))}`);
  console.log(`[smoke] ✅ found chunk (score=${found.score.toFixed(4)})`);

  console.log(`[smoke] cleanup deleteRepoChunks(${REPO_ID})`);
  await deleteRepoChunks(REPO_ID);

  // Confirm
  const remaining = await getRepoChunks(REPO_ID, 5);
  if (remaining.length > 0) throw new Error(`expected empty after delete; got ${remaining.length}`);
  console.log(`[smoke] ✅ clean`);
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
