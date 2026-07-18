-- AlterTable
-- Cost snapshot for platform-key usage; null for own-key and pre-existing rows.
ALTER TABLE "ai_usages" ADD COLUMN "chargedCostUsd" DOUBLE PRECISION;
