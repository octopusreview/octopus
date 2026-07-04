-- AlterTable
ALTER TABLE "review_issues" ADD COLUMN     "signature" TEXT;

-- CreateIndex
CREATE INDEX "review_issues_pullRequestId_signature_idx" ON "review_issues"("pullRequestId", "signature");
