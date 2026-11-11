-- First repository provider
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per sign-up month and provider; each organisation counted
-- once, by the provider of its first repository connected at or after
-- creation.

WITH params AS (
  SELECT toDateTime(toStartOfWeek(now(), 1), 'UTC') AS cutoff
),

orgs AS (
  SELECT o.organization_id, o.created_at, p.cutoff
  FROM octopus_analyticspostgres_organizations_v1 o
  CROSS JOIN params p
  WHERE o.provisional_eligible
    AND o.created_at < p.cutoff
),

first_repo AS (
  SELECT
    r.organization_id,
    argMin(r.provider, r.connected_at) AS first_provider
  FROM octopus_analyticspostgres_repositories_v1 r
  JOIN orgs o ON r.organization_id = o.organization_id
  WHERE r.connected_at >= o.created_at
    AND r.connected_at <  o.cutoff
  GROUP BY r.organization_id
)

SELECT
  toStartOfMonth(o.created_at) AS signup_month,
  f.first_provider,
  count() AS organisations
FROM orgs o
JOIN first_repo f ON o.organization_id = f.organization_id
GROUP BY signup_month, f.first_provider
ORDER BY signup_month, organisations DESC
