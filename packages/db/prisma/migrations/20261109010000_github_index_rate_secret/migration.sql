CREATE TABLE "github_index_rate_secret" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "secretEnc" TEXT NOT NULL,
    CONSTRAINT "github_index_rate_secret_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "github_index_rate_secret_singleton" CHECK ("id" = 1)
);
