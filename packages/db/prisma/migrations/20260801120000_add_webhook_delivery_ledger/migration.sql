-- SEC-06 shadow-mode foundation. The table stores only bounded metadata for
-- signature-verified webhook deliveries; raw payloads, signatures, and secrets
-- are deliberately excluded. IDs are snapshots rather than foreign keys so the
-- observation remains available after an organization or repository is removed.

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "deliveryIdSource" TEXT NOT NULL DEFAULT 'provider',
    "eventType" TEXT NOT NULL,
    "action" TEXT,
    "payloadSha256" TEXT NOT NULL,
    "providerInstallationId" TEXT,
    "providerRepositoryId" TEXT,
    "resolvedOrganizationId" TEXT,
    "resolvedRepositoryId" TEXT,
    "legacyOrganizationId" TEXT,
    "legacyRepositoryId" TEXT,
    "resolutionStatus" TEXT NOT NULL,
    "comparisonStatus" TEXT NOT NULL,
    "legacyCandidateCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "payloadHashCollisionCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_provider_deliveryId_key"
ON "webhook_deliveries"("provider", "deliveryId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_provider_providerInstallationId_firstSee_idx"
ON "webhook_deliveries"("provider", "providerInstallationId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_provider_comparisonStatus_firstSeenAt_idx"
ON "webhook_deliveries"("provider", "comparisonStatus", "firstSeenAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_resolvedOrganizationId_firstSeenAt_idx"
ON "webhook_deliveries"("resolvedOrganizationId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_lastSeenAt_idx"
ON "webhook_deliveries"("lastSeenAt");
