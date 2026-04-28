import { prisma } from "@octopus/db";

const STALE_MS = 10 * 60 * 1000;

export async function reconcileStaleRepoStates() {
  const cutoff = new Date(Date.now() - STALE_MS);

  try {
    const indexing = await prisma.repository.updateMany({
      where: { indexStatus: "indexing", updatedAt: { lt: cutoff } },
      data: { indexStatus: "pending" },
    });
    const analyzing = await prisma.repository.updateMany({
      where: { analysisStatus: "analyzing", updatedAt: { lt: cutoff } },
      data: { analysisStatus: "none" },
    });

    if (indexing.count || analyzing.count) {
      console.log(
        `[boot-reconciler] reset stale rows: indexing=${indexing.count} analyzing=${analyzing.count}`,
      );
    }
  } catch (err) {
    console.error("[boot-reconciler] failed:", err);
  }
}
