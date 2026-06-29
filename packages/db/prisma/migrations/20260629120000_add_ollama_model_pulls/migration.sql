-- CreateTable
CREATE TABLE "public"."ollama_model_pulls" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "statusText" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ollama_model_pulls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ollama_model_pulls_model_key" ON "public"."ollama_model_pulls"("model");
