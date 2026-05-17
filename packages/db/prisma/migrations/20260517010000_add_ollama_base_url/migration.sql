-- AlterTable: per-org override for the Ollama base URL. NULL means use the
-- OLLAMA_BASE_URL env (or the default http://localhost:11434).
ALTER TABLE "public"."organizations" ADD COLUMN "ollamaBaseUrl" TEXT;
