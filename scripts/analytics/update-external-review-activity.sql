\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $$
BEGIN
  IF to_regnamespace('octopus_analytics') IS NULL THEN
    RAISE EXCEPTION 'Analytics schema missing; install access.sql before this update';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'octopus_analytics_reader') THEN
    RAISE EXCEPTION 'Analytics reader role missing; install access.sql before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'octopus_analytics' AND c.relname = 'organizations_v1' AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'Analytics organizations_v1 view missing; install access.sql before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'external_review_activity' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'Source table public.external_review_activity missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'id'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."id" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'source'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."source" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'organizationId'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."organizationId" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'repositoryId'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."repositoryId" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'acceptedAt'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."acceptedAt" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'outcome'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."outcome" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.external_review_activity') AND a.attname = 'finishedAt'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.external_review_activity."finishedAt" missing; apply migration 20261022120000_external_review_activity before this update';
  END IF;
  IF EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'octopus_analytics' AND c.relname = 'external_review_activity_v1' AND c.relkind <> 'v'
  ) THEN
    RAISE EXCEPTION 'Analytics external_review_activity_v1 already exists and is not a view; no changes applied';
  END IF;
END $$;

CREATE OR REPLACE VIEW octopus_analytics.external_review_activity_v1
WITH (security_barrier = true) AS
SELECT 'octopus:external_review:' || id AS external_review_id,
  'octopus:org:' || "organizationId" AS organization_id,
  'octopus:repo:' || "repositoryId" AS repository_id,
  CASE WHEN source IS NULL THEN 'not_recorded'
       WHEN source IN ('github_action','cli_local','cli_repo') THEN source
       ELSE 'other' END AS source,
  CASE WHEN outcome IS NULL THEN 'no_outcome'
       WHEN outcome IN ('generated','failed') THEN outcome
       ELSE 'other' END AS outcome,
  "acceptedAt" AS accepted_at,
  "finishedAt" AS finished_at
FROM public.external_review_activity;

REVOKE ALL ON octopus_analytics.external_review_activity_v1 FROM PUBLIC;
GRANT SELECT ON octopus_analytics.external_review_activity_v1 TO octopus_analytics_reader;
COMMIT;
