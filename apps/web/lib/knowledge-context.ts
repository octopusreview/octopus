import { prisma } from "@octopus/db";

const ALWAYS_INCLUDE_PER_DOC_CHAR_CAP = 8000;
const ALWAYS_INCLUDE_TOTAL_CHAR_CAP = 24000;

export type KnowledgeChunk = { title: string; text: string; score?: number };

export async function getAlwaysIncludeKnowledge(
  orgId: string,
): Promise<KnowledgeChunk[]> {
  const docs = await prisma.knowledgeDocument.findMany({
    where: {
      organizationId: orgId,
      alwaysInclude: true,
      deletedAt: null,
      status: "ready",
    },
    select: { title: true, content: true },
    orderBy: { createdAt: "asc" },
  });

  const chunks: KnowledgeChunk[] = [];
  let total = 0;
  for (const doc of docs) {
    if (total >= ALWAYS_INCLUDE_TOTAL_CHAR_CAP) break;
    const remainingTotal = ALWAYS_INCLUDE_TOTAL_CHAR_CAP - total;
    const cap = Math.min(ALWAYS_INCLUDE_PER_DOC_CHAR_CAP, remainingTotal);
    const truncated = doc.content.length > cap;
    const body = truncated
      ? doc.content.slice(0, cap) + "\n\n[...truncated]"
      : doc.content;
    chunks.push({
      title: doc.title,
      text: `[Knowledge: ${doc.title}]\n${body}`,
    });
    total += body.length;
  }
  return chunks;
}

/**
 * Merge always-include knowledge with similarity-search results.
 * Always-include chunks come first; similarity chunks are appended,
 * skipping any whose text already appears in always-include chunks.
 */
export function mergeKnowledgeChunks(
  alwaysInclude: KnowledgeChunk[],
  similarity: KnowledgeChunk[],
): KnowledgeChunk[] {
  const seenTitles = new Set(alwaysInclude.map((c) => c.title));
  const merged: KnowledgeChunk[] = [...alwaysInclude];
  for (const c of similarity) {
    if (seenTitles.has(c.title)) continue;
    merged.push(c);
  }
  return merged;
}
