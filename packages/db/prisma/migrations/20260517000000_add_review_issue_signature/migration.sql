-- AlterTable: add content-derived signature for cross-review merging.
-- Nullable so existing rows (which predate WS6.5) are accepted as-is.
ALTER TABLE "public"."review_issues" ADD COLUMN "signature" TEXT;

-- CreateIndex: speeds up the (pullRequestId, signature) lookup used by the
-- merge step on every re-review of a PR.
CREATE INDEX "review_issues_pullRequestId_signature_idx"
  ON "public"."review_issues"("pullRequestId", "signature");
