-- CreateTable
CREATE TABLE "incident_comms" (
    "id" TEXT NOT NULL,
    "incidentKey" TEXT NOT NULL,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "creditGrantedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "incident_comms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_comms_incidentKey_idx" ON "incident_comms"("incidentKey");

-- CreateIndex
CREATE UNIQUE INDEX "incident_comms_incidentKey_organizationId_key" ON "incident_comms"("incidentKey", "organizationId");

-- AddForeignKey
ALTER TABLE "incident_comms" ADD CONSTRAINT "incident_comms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

