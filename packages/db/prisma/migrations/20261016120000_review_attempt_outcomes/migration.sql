CREATE TABLE "review_attempt_outcomes" (
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "pullRequestId" TEXT NOT NULL,
  "requestVersion" INTEGER NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('substantive', 'partial', 'incomplete', 'not_required', 'empty', 'not_assessed', 'unknown')),
  "outcome" TEXT CHECK ("outcome" IN ('published', 'partially_published', 'uncertain', 'failed', 'superseded')),
  "tries" INTEGER NOT NULL CHECK ("tries" >= 0),
  "firstTriedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "resultArchiveId" TEXT,
  CONSTRAINT "review_attempt_outcomes_pkey" PRIMARY KEY ("pullRequestId", "requestVersion"),
  CONSTRAINT "review_attempt_outcomes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "review_attempt_outcomes_organizationId_publishedAt_idx" ON "review_attempt_outcomes"("organizationId", "publishedAt");
