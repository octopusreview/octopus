-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "autoDiscoverRepos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reposSyncedAt" TIMESTAMP(3);
