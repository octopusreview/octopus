import { headers } from "next/headers";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createEmbeddings } from "@/lib/embeddings";
import { ensureDocsCollection, upsertDocsChunks, deleteAllDocsChunks } from "@/lib/qdrant";
import { generateSparseVector } from "@/lib/sparse-vector";
import { docsContent } from "@/lib/docs-content";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }

  return chunks;
}

function deterministicUUID(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  // Format as UUID v4-like: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminEmail(session.user.email)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    await ensureDocsCollection();

    // Delete existing docs chunks first
    await deleteAllDocsChunks();

    // Build all chunks with metadata
    const allChunks: { id: string; text: string; title: string; page: string; section: string }[] = [];

    for (const doc of docsContent) {
      for (const section of doc.sections) {
        const prefix = `# ${doc.title}\n## ${section.heading}\n\n`;
        const chunks = chunkText(section.text);

        for (let i = 0; i < chunks.length; i++) {
          const chunkContent = prefix + chunks[i];
          const id = deterministicUUID(`${doc.page}:${section.heading}:${i}`);
          allChunks.push({
            id,
            text: chunkContent,
            title: `${doc.title} - ${section.heading}`,
            page: doc.page,
            section: section.heading,
          });
        }
      }
    }

    // Create embeddings in batches
    const texts = allChunks.map((c) => c.text);
    const embeddings = await createEmbeddings(texts);

    // Build points with sparse vectors
    const points = allChunks.map((chunk, i) => ({
      id: chunk.id,
      vector: embeddings[i],
      payload: {
        title: chunk.title,
        text: chunk.text,
        page: chunk.page,
        section: chunk.section,
      },
      sparseVector: generateSparseVector(chunk.text),
    }));

    // Upsert to Qdrant
    await upsertDocsChunks(points);

    return Response.json({
      success: true,
      totalDocuments: docsContent.length,
      totalChunks: allChunks.length,
    });
  } catch (error) {
    console.error("[seed-docs] Error:", error);
    return Response.json(
      { error: "Failed to seed docs", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
