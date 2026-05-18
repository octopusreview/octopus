-- Add per-org config for the three gateway/CLI providers:
--   acp / opencode  — OpenAI-compatible gateway base URL + key
--   claude-code     — auth mode + key (subscription mode needs no key)
ALTER TABLE "Organization"
  ADD COLUMN "acpBaseUrl"          TEXT,
  ADD COLUMN "acpApiKey"           TEXT,
  ADD COLUMN "opencodeBaseUrl"     TEXT,
  ADD COLUMN "opencodeApiKey"      TEXT,
  ADD COLUMN "claudeCodeAuthMode"  TEXT,
  ADD COLUMN "claudeCodeApiKey"    TEXT;
