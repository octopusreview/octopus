-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN "planTier" TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN "planRenewsAt" TIMESTAMP(3),
  ADD COLUMN "planCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
