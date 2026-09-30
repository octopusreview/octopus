import { createHash } from "node:crypto";
import type { ReviewFileInput, ReviewInput } from "@/lib/review-coverage";

const emptyBlob = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const fullSha = /^(?!0{40}$)[0-9a-f]{40}$/;
type Revision = Pick<ReviewInput, "provider" | "headSha" | "baseSha">;
export type EmptyFileEvidence = {
  provider: "github";
  headSha: string;
  baseSha: string;
  path: string;
  blobSha: string;
  rawSection: string;
  rawSectionSha256: string;
};

/** An added regular file with Git's empty-blob identity has no text hunks. */
export function createEmptyFileEvidence(file: ReviewFileInput, revision: Revision, section: string | undefined): EmptyFileEvidence | undefined {
  if (!section || revision.provider !== "github" || !revision.headSha || !revision.baseSha
    || !fullSha.test(revision.headSha) || !fullSha.test(revision.baseSha)
    || file.change !== "added" || file.previousPath !== undefined || file.patch !== undefined
    || file.unavailable !== undefined || file.additions !== 0 || file.deletions !== 0 || file.blobSha !== emptyBlob
    || file.path.length > 4096 || !/^[a-zA-Z0-9._/-]+$/.test(file.path)
    || file.path.split("/").some(part => !part || part === "." || part === "..")) return;
  const lines = section.split("\n");
  if (lines.length !== 4 || lines[3] !== "" || lines[0] !== `diff --git a/${file.path} b/${file.path}`
    || lines[1] !== "new file mode 100644") return;
  const index = /^index 0{7,40}\.\.([0-9a-f]{7,40})$/.exec(lines[2]);
  if (!index || !emptyBlob.startsWith(index[1])) return;
  return { provider: "github", headSha: revision.headSha, baseSha: revision.baseSha, path: file.path,
    blobSha: emptyBlob, rawSection: section, rawSectionSha256: createHash("sha256").update(section).digest("hex") };
}

/** Recheck persisted evidence before treating its declaration as supplied input. */
export function validateEmptyFileEvidence(file: ReviewFileInput, revision: Revision, evidence: EmptyFileEvidence | undefined): EmptyFileEvidence | undefined {
  if (!evidence || typeof evidence.rawSection !== "string") return;
  const verified = createEmptyFileEvidence(file, revision, evidence.rawSection);
  if (!verified || Object.keys(evidence).length !== Object.keys(verified).length
    || (Object.keys(verified) as (keyof EmptyFileEvidence)[]).some(key => evidence[key] !== verified[key])) return;
  return verified;
}
