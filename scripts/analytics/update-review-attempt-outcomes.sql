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
    WHERE n.nspname = 'public' AND c.relname = 'review_attempt_outcomes' AND c.relkind IN ('r','p')
  ) THEN
    RAISE EXCEPTION 'Source table public.review_attempt_outcomes missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'pullRequestId'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."pullRequestId" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'repositoryId'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."repositoryId" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'organizationId'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."organizationId" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'requestVersion'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."requestVersion" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'kind'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."kind" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'outcome'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."outcome" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'firstTriedAt'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."firstTriedAt" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'finishedAt'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."finishedAt" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'publishedAt'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."publishedAt" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.review_attempt_outcomes') AND a.attname = 'tries'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.review_attempt_outcomes."tries" missing; apply migration 20261016120000_review_attempt_outcomes before this update';
  END IF;
  IF EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'octopus_analytics' AND c.relname = 'review_attempt_outcomes_v1' AND c.relkind <> 'v'
  ) THEN
    RAISE EXCEPTION 'Analytics review_attempt_outcomes_v1 already exists and is not a view; no changes applied';
  END IF;
END $$;

CREATE OR REPLACE VIEW octopus_analytics.review_attempt_outcomes_v1
WITH (security_barrier = true) AS
SELECT 'octopus:pr:' || "pullRequestId" AS pull_request_id,
  'octopus:repo:' || "repositoryId" AS repository_id,
  'octopus:org:' || "organizationId" AS organization_id,
  "requestVersion" AS request_version,
  CASE WHEN kind IN ('substantive','partial','incomplete','not_required','empty','not_assessed','unknown')
    THEN kind ELSE 'other' END AS kind,
  CASE WHEN outcome IN ('published','partially_published','uncertain','failed','superseded')
    THEN outcome WHEN outcome IS NULL THEN 'no_outcome' ELSE 'other' END AS outcome,
  "firstTriedAt" AS first_tried_at, "finishedAt" AS finished_at,
  "publishedAt" AS published_at, tries AS try_count
FROM public.review_attempt_outcomes;

REVOKE ALL ON octopus_analytics.review_attempt_outcomes_v1 FROM PUBLIC;
GRANT SELECT ON octopus_analytics.review_attempt_outcomes_v1 TO octopus_analytics_reader;
COMMIT;
