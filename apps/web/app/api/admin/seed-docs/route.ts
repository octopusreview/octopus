import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { docsContent } from "@/lib/docs-content";
import { createEmbeddings } from "@/lib/embeddings";
import {
  deleteAllDocsChunks,
  ensureDocsCollection,
  upsertDocsChunks,
} from "@/lib/qdrant";
import { generateSparseVector } from "@/lib/sparse-vector";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureDocsCollection();
  await deleteAllDocsChunks();

  const chunks: { page: string; title: string; section: string; text: string }[] = [];
  for (const doc of docsContent) {
    for (const section of doc.sections) {
      const text = section.text.trim();
      if (!text) continue;
      chunks.push({
        page: doc.page,
        title: doc.title,
        section: section.heading,
        text,
      });
    }
  }

  if (chunks.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embedInputs = batch.map((c) => `${c.title} — ${c.section}\n\n${c.text}`);
    const vectors = await createEmbeddings(embedInputs);

    const points = batch
      .map((c, idx) => {
        const vector = vectors[idx];
        if (!vector || vector.length === 0) return null;
        return {
          id: randomUUID(),
          vector,
          sparseVector: generateSparseVector(`${c.section} ${c.text}`),
          payload: {
            page: c.page,
            title: c.title,
            section: c.section,
            text: c.text,
          },
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (points.length > 0) {
      await upsertDocsChunks(points);
      inserted += points.length;
    }
  }

  return NextResponse.json({ ok: true, inserted, totalSections: chunks.length });
}
