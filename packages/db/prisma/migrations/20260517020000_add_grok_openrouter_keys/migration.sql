-- AlterTable: BYOK keys for the Grok (xAI) and OpenRouter providers added
-- alongside the unified Provider registry refactor.
ALTER TABLE "public"."organizations" ADD COLUMN "grokApiKey" TEXT;
ALTER TABLE "public"."organizations" ADD COLUMN "openrouterApiKey" TEXT;
