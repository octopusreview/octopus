-- CreateTable
CREATE TABLE "auto_reload_attempts" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initializing',
    "idempotencyKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT,
    "stripePaymentIntentId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "retryUntil" TIMESTAMP(3) NOT NULL,
    "lastSubmittedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "auto_reload_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_reload_attempts_idempotencyKey_key" ON "auto_reload_attempts"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "auto_reload_attempts_stripePaymentIntentId_key" ON "auto_reload_attempts"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "auto_reload_attempts_activeOrganizationId_key" ON "auto_reload_attempts"("activeOrganizationId");

-- CreateIndex
CREATE INDEX "auto_reload_attempts_organizationId_createdAt_idx" ON "auto_reload_attempts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "auto_reload_attempts_status_leaseExpiresAt_idx" ON "auto_reload_attempts"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "auto_reload_attempts" ADD CONSTRAINT "auto_reload_attempts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quiesce every legacy auto-reload before a rolling deploy. Old replicas do
-- not participate in the durable-attempt claim and could otherwise charge in
-- parallel with a new replica. Preserve the amounts and mark the pause so the
-- UI can ask the owner to review and explicitly re-enable once the rollout is
-- complete.
ALTER TABLE "auto_reload_configs"
ADD COLUMN "pausedForDurableUpgrade" BOOLEAN NOT NULL DEFAULT false;

UPDATE "auto_reload_configs"
SET
    "enabled" = false,
    "pausedForDurableUpgrade" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = true;
