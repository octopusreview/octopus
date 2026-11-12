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
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.organizations') AND a.attname = 'creationSource'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.organizations."creationSource" missing; apply creation-provenance migrations before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.organizations') AND a.attname = 'creatorFirstOrganization'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.organizations."creatorFirstOrganization" missing; apply creation-provenance migrations before this update';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.users') AND a.attname = 'arrivalSource'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Source column public.users."arrivalSource" missing; apply creation-provenance migrations before this update';
  END IF;
END $$;

CREATE OR REPLACE VIEW octopus_analytics.organization_provenance_v1
WITH (security_barrier = true) AS
WITH creators AS (
  -- See docs/product-analytics.md for timestamp matching; retain removed owners.
  SELECT o.id AS organization_id,
    CASE WHEN count(m.id) = 1 THEN min(m."userId") END AS creator_id
  FROM public.organizations o
  LEFT JOIN public.organization_members m
    ON m."organizationId" = o.id AND m.role = 'owner'
    AND m."createdAt" = o."createdAt"
    AND (o."creationSource" IS NULL OR o."creationSource" IN ('auto_default', 'user_created'))
  GROUP BY o.id
)
SELECT 'octopus:org:' || o.id AS organization_id,
  CASE WHEN o."creationSource" IN ('auto_default','user_created','community_bot','demo_seed')
    THEN o."creationSource" WHEN o."creationSource" IS NULL THEN 'not_recorded'
    ELSE 'other' END AS creation_source,
  CASE WHEN o."creatorFirstOrganization" THEN 'yes'
    WHEN o."creatorFirstOrganization" = false THEN 'no'
    ELSE 'not_recorded' END AS creator_first_membership,
  CASE WHEN u.id IS NULL THEN 'no_creator'
    WHEN u."arrivalSource" IN ('signup','invite','system') THEN u."arrivalSource"
    WHEN u."arrivalSource" IS NULL THEN 'not_recorded'
    ELSE 'other' END AS creator_arrival_source
FROM public.organizations o
JOIN creators c ON c.organization_id = o.id
LEFT JOIN public.users u ON u.id = c.creator_id;

REVOKE ALL ON octopus_analytics.organization_provenance_v1 FROM PUBLIC;
GRANT SELECT ON octopus_analytics.organization_provenance_v1 TO octopus_analytics_reader;
COMMIT;
