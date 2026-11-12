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
END $$;

CREATE OR REPLACE VIEW octopus_analytics.organization_signup_method_v1
WITH (security_barrier = true) AS
WITH creators AS (
  -- Both birth timestamps use the same transaction's now(); retain removed owners.
  SELECT o.id AS organization_id,
    CASE WHEN count(m.id) = 1 THEN min(m."userId") END AS creator_id
  FROM public.organizations o
  LEFT JOIN public.organization_members m
    ON m."organizationId" = o.id AND m.role = 'owner'
    AND m."createdAt" = o."createdAt"
    AND (o."creationSource" IS NULL OR o."creationSource" IN ('auto_default', 'user_created'))
  GROUP BY o.id
), account_times AS (
  -- Group once, rather than rescanning accounts for each organisation.
  SELECT "userId", min("createdAt") AS created_at
  FROM public.accounts GROUP BY "userId"
), first_accounts AS (
  SELECT a."userId", t.created_at,
    count(DISTINCT a."providerId") AS provider_count,
    min(a."providerId") AS provider
  FROM account_times t JOIN public.accounts a
    ON a."userId" = t."userId" AND a."createdAt" = t.created_at
  GROUP BY a."userId", t.created_at
), methods AS (
  SELECT c.organization_id, u.id AS creator_id,
    CASE WHEN u."signupMethod" IN ('github','google','microsoft','magic_link','password')
      THEN u."signupMethod" END AS recorded_method,
    CASE
      WHEN u.id IS NULL THEN 'unknown'
      WHEN a.created_at >= u."createdAt"
        AND a.created_at <= u."createdAt" + interval '60 seconds'
        AND a.provider_count > 1 THEN 'unknown'
      WHEN a.created_at >= u."createdAt"
        AND a.created_at <= u."createdAt" + interval '60 seconds'
        AND a.provider_count = 1
        AND a.provider IN ('github','google','microsoft','credential')
        THEN CASE WHEN a.provider = 'credential' THEN 'password' ELSE a.provider END
      ELSE 'magic_link_or_unknown'
    END AS inferred_method
  FROM creators c LEFT JOIN public.users u ON u.id = c.creator_id
  LEFT JOIN first_accounts a ON a."userId" = u.id
)
SELECT 'octopus:org:' || organization_id AS organization_id,
  CASE WHEN creator_id IS NULL THEN 'unknown'
    WHEN recorded_method IS NOT NULL THEN recorded_method
    WHEN inferred_method IN ('github','google','microsoft','password') THEN inferred_method
    ELSE 'magic_link_or_unknown' END AS signup_method,
  CASE WHEN creator_id IS NULL THEN 'no_creator'
    WHEN recorded_method IS NOT NULL THEN 'recorded'
    WHEN inferred_method IN ('github','google','microsoft','password') THEN 'inferred'
    ELSE 'no_login_method' END AS signup_method_evidence,
  inferred_method AS signup_method_inferred
FROM methods;

REVOKE ALL ON octopus_analytics.organization_signup_method_v1 FROM PUBLIC;
GRANT SELECT ON octopus_analytics.organization_signup_method_v1 TO octopus_analytics_reader;
COMMIT;
