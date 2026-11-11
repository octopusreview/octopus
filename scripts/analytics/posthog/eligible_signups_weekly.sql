-- Eligible sign-ups per week
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per Monday week, from the first eligible sign-up to the
-- cutoff. Weeks with no sign-ups show 0, because a calendar of weeks is joined
-- to the counts. The number of weeks is rounded up, so a cutoff that isn't a
-- Monday keeps its last, partial week.

WITH params AS (
  SELECT toDateTime(toStartOfWeek(now(), 1), 'UTC') AS cutoff
),

orgs AS (
  SELECT o.organization_id, o.created_at
  FROM octopus_analyticspostgres_organizations_v1 o
  CROSS JOIN params p
  WHERE o.provisional_eligible
    AND o.created_at < p.cutoff
),

signups AS (
  SELECT
    toDate(toStartOfWeek(created_at, 1)) AS signup_week,
    count() AS eligible_signups
  FROM orgs
  GROUP BY signup_week
),

weeks AS (
  SELECT
    addWeeks(first_week, arrayJoin(range(toInt(intDiv(dateDiff('day', first_week, toDate(cutoff)) + 6, 7))))) AS signup_week
  FROM (
    SELECT
      min(toDate(toStartOfWeek(o.created_at, 1))) AS first_week,
      max(p.cutoff) AS cutoff
    FROM orgs o
    CROSS JOIN params p
  )
)

SELECT
  w.signup_week,
  coalesce(s.eligible_signups, 0) AS eligible_signups
FROM weeks w
LEFT JOIN signups s ON w.signup_week = s.signup_week
ORDER BY w.signup_week
