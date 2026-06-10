-- Add per-org config for the three gateway/CLI providers:
--   acp / opencode  — OpenAI-compatible gateway base URL + key
--   claude-code     — auth mode + key (subscription mode needs no key)
--
-- Note: the Prisma model `Organization` is @@map'd to the physical table
-- `organizations` (see schema.prisma). Postgres quoted identifiers are
-- case-sensitive, so this MUST be the lowercase mapped name — sibling
-- migrations (20260517010000, 20260517020000) use the same convention.
ALTER TABLE "public"."organizations"
  ADD COLUMN "acpBaseUrl"          TEXT,
  ADD COLUMN "acpApiKey"           TEXT,
  ADD COLUMN "opencodeBaseUrl"     TEXT,
  ADD COLUMN "opencodeApiKey"      TEXT,
  ADD COLUMN "claudeCodeAuthMode"  TEXT,
  ADD COLUMN "claudeCodeApiKey"    TEXT;
