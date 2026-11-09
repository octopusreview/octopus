-- Repository connected within 7 days
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per Monday sign-up week. Weeks that aren't mature yet keep
-- their row, with 0 mature organisations.

WITH orgs AS (
  SELECT organization_id, created_at
  FROM octopus_analyticspostgres_organizations_v1
  WHERE provisional_eligible
    AND created_at < toDateTime(toStartOfWeek(now(), 1), 'UTC')
),

repositories AS (
  SELECT
    r.organization_id,
    min(r.connected_at) AS repository_at,
    1                   AS has_repository
  FROM octopus_analyticspostgres_repositories_v1 r
  JOIN orgs o ON r.organization_id = o.organization_id
  WHERE r.connected_at >= o.created_at
    AND r.connected_at <  toDateTime(toStartOfWeek(now(), 1), 'UTC')
  GROUP BY r.organization_id
)

SELECT
  toDate(toStartOfWeek(o.created_at, 1)) AS signup_week,
  countIf(o.created_at <= subtractDays(toDateTime(toStartOfWeek(now(), 1), 'UTC'), 7))
    AS mature_orgs,
  countIf(o.created_at <= subtractDays(toDateTime(toStartOfWeek(now(), 1), 'UTC'), 7)
          AND coalesce(r.has_repository, 0) = 1
          AND r.repository_at < addDays(o.created_at, 7))
    AS repo_within_7d,
  round(100.0 * repo_within_7d / nullIf(mature_orgs, 0), 1) AS repo_rate_7d
FROM orgs o
LEFT JOIN repositories r ON o.organization_id = r.organization_id
GROUP BY signup_week
ORDER BY signup_week
