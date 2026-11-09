-- Time to first repository
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per organisation that connected within 7 days; one result
-- row. Check: with a fixed cutoff and cohort start it reproduces the earlier
-- result for the same cohort.

WITH params AS (
  SELECT
    toDateTime(toStartOfWeek(now(), 1), 'UTC') AS cutoff,
    toDateTime('2026-01-01 00:00:00', 'UTC') AS cohort_start
),

orgs AS (
  SELECT o.organization_id, o.created_at
  FROM octopus_analyticspostgres_organizations_v1 o
  CROSS JOIN params p
  WHERE o.provisional_eligible
    AND o.created_at >= p.cohort_start
    AND o.created_at <= subtractDays(p.cutoff, 7)
),

first_repo AS (
  SELECT
    o.organization_id,
    o.created_at,
    min(r.connected_at) AS repository_at
  FROM orgs o
  JOIN octopus_analyticspostgres_repositories_v1 r ON r.organization_id = o.organization_id
  WHERE r.connected_at >= o.created_at
  GROUP BY o.organization_id, o.created_at
)

SELECT
  count() AS organisations,
  round(quantileExact(0.5)(dateDiff('minute', created_at, repository_at)) / 60, 2) AS median_hours,
  round(quantileExact(0.9)(dateDiff('minute', created_at, repository_at)) / 60, 2) AS p90_hours
FROM first_repo
WHERE repository_at < addDays(created_at, 7)
