\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

-- Refuse collisions rather than adopt an existing principal or schema.
CREATE ROLE octopus_analytics_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE octopus_analytics_reader SET default_transaction_read_only = on;
ALTER ROLE octopus_analytics_reader SET statement_timeout = '15s';
ALTER ROLE octopus_analytics_reader SET lock_timeout = '3s';
ALTER ROLE octopus_analytics_reader SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE octopus_analytics_reader SET search_path = octopus_analytics, pg_catalog;
CREATE SCHEMA octopus_analytics;
REVOKE ALL ON SCHEMA octopus_analytics FROM PUBLIC;

DO $$
BEGIN
  -- PUBLIC grants and executable SECURITY DEFINER functions could defeat a
  -- table allowlist. Refuse such installations; do not alter their privileges.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')
      AND (EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
        OR EXISTS (
          SELECT 1 FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) a
          WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
            AND a.grantee = 0
        ))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosecdef
      AND has_function_privilege('octopus_analytics_reader', p.oid, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_temp%'
      AND n.nspname NOT LIKE 'pg_toast%'
      AND has_schema_privilege('octopus_analytics_reader', n.oid, 'CREATE')
  ) OR has_database_privilege('octopus_analytics_reader', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Existing public privileges need operator review; no changes applied';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO octopus_analytics_reader', current_database());
END $$;

CREATE VIEW octopus_analytics.organizations_v1 WITH (security_barrier = true) AS
SELECT 'octopus:org:' || id AS organization_id, "createdAt" AS created_at,
  type AS organization_type, "bannedAt" IS NOT NULL AS is_banned,
  "deletedAt" IS NOT NULL AS is_deleted,
  -- Provisional cohort: internal/seeded-account provenance is not yet complete.
  type = 1 AND "bannedAt" IS NULL AND "deletedAt" IS NULL AS provisional_eligible,
  'octopus'::text AS product, 'production'::text AS environment
FROM public.organizations;

CREATE VIEW octopus_analytics.repositories_v1 WITH (security_barrier = true) AS
SELECT 'octopus:repo:' || id AS repository_id,
  'octopus:org:' || "organizationId" AS organization_id,
  CASE WHEN provider IN ('github','gitlab','bitbucket','forgejo') THEN provider ELSE 'other' END AS provider,
  "createdAt" AS connected_at, "isActive" AS is_active, "autoReview" AS auto_review,
  CASE WHEN "indexStatus" IN ('pending','indexing','indexed','failed') THEN "indexStatus" ELSE 'unknown' END AS index_status,
  "indexedAt" AS latest_index_at,
  "firstIndexedAt" AS first_index_at
FROM public.repositories;

CREATE VIEW octopus_analytics.review_milestones_v1 WITH (security_barrier = true) AS
SELECT 'octopus:pr:' || p.id AS pull_request_id,
  'octopus:repo:' || p."repositoryId" AS repository_id,
  'octopus:org:' || r."organizationId" AS organization_id,
  p."createdAt" AS first_pr_recorded_at,
  p."firstReviewCompletedAt" AS first_publication_recorded_at,
  CASE WHEN p.status IN ('pending','reviewing','completed','failed') THEN p.status ELSE 'unknown' END AS current_status,
  -- The publication marker also covers empty/skipped assessments. Never
  -- infer substantive activation from the current, mutable review body.
  NULL::timestamp AS substantive_activation_at,
  'substantive_classification_unavailable'::text AS activation_evidence
FROM public.pull_requests p JOIN public.repositories r ON r.id = p."repositoryId";

CREATE VIEW octopus_analytics.cash_events_v1 WITH (security_barrier = true) AS
WITH parsed AS (
  SELECT "organizationId", CASE WHEN payload IS JSON OBJECT AND pg_input_is_valid(payload, 'jsonb')
    THEN payload::jsonb ELSE '{}'::jsonb END AS p
  FROM public.marketing_conversions
  WHERE environment = 'live' AND status = 'delivered' AND kind IN ('purchase','refund')
    AND "organizationId" IS NOT NULL
), safe AS (
  SELECT p->>'eventId' AS event_id, 'octopus:org:' || "organizationId" AS organization_id,
    p->>'eventType' AS event_type, p->>'currency' AS currency,
    CASE WHEN p->>'amountMinor' ~ '^[0-9]{1,18}$' THEN (p->>'amountMinor')::numeric END AS amount_minor,
    CASE WHEN pg_input_is_valid(p->>'occurredAt', 'timestamp with time zone')
      THEN (p->>'occurredAt')::timestamptz END AS occurred_at
  FROM parsed WHERE p->>'schemaVersion' = '1' AND p->>'eventType' IN ('purchase','refund')
    AND p->>'eventId' ~ '^(payment|refund)_[0-9a-f]{64}$'
    AND p->>'currency' IN ('USD','GBP')
), distinct_events AS (
  SELECT DISTINCT * FROM safe WHERE amount_minor > 0 AND occurred_at IS NOT NULL
), counted_events AS (
  SELECT *, count(*) OVER (PARTITION BY event_id) AS fact_count FROM distinct_events
)
SELECT event_id, organization_id, event_type, currency, amount_minor, occurred_at
FROM counted_events WHERE fact_count = 1;

CREATE VIEW octopus_analytics.organization_provenance_v1
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

GRANT USAGE ON SCHEMA octopus_analytics TO octopus_analytics_reader;
GRANT SELECT ON octopus_analytics.organizations_v1,
  octopus_analytics.repositories_v1, octopus_analytics.review_milestones_v1,
  octopus_analytics.cash_events_v1, octopus_analytics.organization_provenance_v1 TO octopus_analytics_reader;
-- No future-object grants, source-table grants, password or LOGIN here.
COMMIT;
