CREATE TABLE "queue_drain" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'claiming',
    "requestedAt" TIMESTAMPTZ(3),
    "requestedBy" TEXT,
    "deadlineAt" TIMESTAMPTZ(3),
    "leaseUntil" TIMESTAMPTZ(3),
    "quiescentAt" TIMESTAMPTZ(3),
    "resumedAt" TIMESTAMPTZ(3),
    "resumeReason" TEXT,
    CONSTRAINT "queue_drain_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "queue_drain_singleton" CHECK ("id" = 1)
);

CREATE TABLE "queue_worker_instances" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "workersEnabled" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedGeneration" INTEGER,
    "ackedAt" TIMESTAMPTZ(3),
    "inlineActive" INTEGER NOT NULL DEFAULT 0,
    "retiringAt" TIMESTAMPTZ(3),
    CONSTRAINT "queue_worker_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "queue_worker_instances_heartbeatAt_idx" ON "queue_worker_instances"("heartbeatAt");
