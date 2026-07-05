-- AlterTable
ALTER TABLE "blog_api_tokens" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- Backfill existing tokens with the minimal scopes matching current behavior
-- (create + edit; NOT delete). Deny-by-default: an empty scopes array stays inert.
UPDATE "blog_api_tokens"
SET "scopes" = ARRAY['blog:read','blog:create','blog:update']
WHERE cardinality("scopes") = 0;
