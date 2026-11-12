ALTER TABLE "ai_usages" ADD COLUMN "chargeKey" TEXT, ADD COLUMN "usageUnknown" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ai_usages_chargeKey_key" ON "ai_usages"("chargeKey");
ALTER TABLE "review_attempt_outcomes" ADD COLUMN "generationAttempts" INTEGER NOT NULL DEFAULT 0;
