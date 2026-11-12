CREATE TABLE "external_review_activity" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('github_action', 'cli_local', 'cli_repo')),
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "reportedPrNumber" INTEGER,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT CHECK ("outcome" IN ('generated', 'failed')),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "external_review_activity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_review_activity_repository_check" CHECK (
    ("source" = 'cli_local' AND "repositoryId" IS NULL) OR
    ("source" IN ('github_action', 'cli_repo') AND "repositoryId" IS NOT NULL)
  ),
  CONSTRAINT "external_review_activity_pr_check" CHECK (
    "reportedPrNumber" IS NULL OR ("source" = 'github_action' AND "reportedPrNumber" > 0)
  ),
  CONSTRAINT "external_review_activity_finish_check" CHECK (
    ("outcome" IS NULL AND "finishedAt" IS NULL) OR
    ("outcome" IS NOT NULL AND "finishedAt" IS NOT NULL AND "finishedAt" >= "acceptedAt")
  ),
  CONSTRAINT "external_review_activity_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "external_review_activity_organizationId_acceptedAt_idx"
  ON "external_review_activity"("organizationId", "acceptedAt");
