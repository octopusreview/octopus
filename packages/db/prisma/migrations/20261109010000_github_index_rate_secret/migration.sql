CREATE TABLE "github_index_rate_secret" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "secretEnc" TEXT NOT NULL,
    CONSTRAINT "github_index_rate_secret_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_index_rate_secret_singleton" CHECK ("id" = 1)
);

CREATE TABLE "github_index_rate_windows" (
    "scope" TEXT NOT NULL,
    "notBefore" TIMESTAMPTZ(3) NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 1,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "untrustedRetryDate" BOOLEAN NOT NULL DEFAULT false,
    "verifyPrimary" BOOLEAN NOT NULL DEFAULT false,
    "primaryResetMs" BIGINT,
    "primaryBaseline" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "github_index_rate_windows_pkey" PRIMARY KEY ("scope")
);

CREATE INDEX "github_index_rate_windows_updatedAt_idx" ON "github_index_rate_windows"("updatedAt");

CREATE TABLE "github_deferred_indexes" (
    "repositoryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "indexAttemptId" TEXT NOT NULL,
    "jobId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "github_deferred_indexes_pkey" PRIMARY KEY ("repositoryId"),
    CONSTRAINT "github_deferred_indexes_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "github_deferred_indexes_createdAt_repositoryId_idx" ON "github_deferred_indexes"("createdAt", "repositoryId");
