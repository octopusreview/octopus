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
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "github_index_rate_windows_pkey" PRIMARY KEY ("scope")
);
