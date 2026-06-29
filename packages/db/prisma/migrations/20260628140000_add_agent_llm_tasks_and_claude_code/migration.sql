-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "claudeCodeApiKey" TEXT,
ADD COLUMN     "claudeCodeAuthMode" TEXT;

-- CreateTable
CREATE TABLE "public"."agent_llm_tasks" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "modelId" TEXT NOT NULL,
    "system" TEXT,
    "messages" JSONB NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "resultText" TEXT,
    "resultUsage" JSONB,
    "errorMessage" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "agent_llm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_llm_tasks_organizationId_status_idx" ON "public"."agent_llm_tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_llm_tasks_agentId_status_idx" ON "public"."agent_llm_tasks"("agentId", "status");

-- AddForeignKey
ALTER TABLE "public"."agent_llm_tasks" ADD CONSTRAINT "agent_llm_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."local_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_llm_tasks" ADD CONSTRAINT "agent_llm_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
