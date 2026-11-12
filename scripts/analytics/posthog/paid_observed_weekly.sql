-- Paid observed per sign-up week
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per Monday sign-up week, from 21 Sep 2026 (payments are
-- recorded from 19 Sep). Check: the organisation count per week matches
-- "Eligible sign-ups per week".

WITH params AS (
  SELECT
    toDateTime(toStartOfWeek(now(), 1), 'UTC') AS cutoff,
    toDateTime('2026-09-21 00:00:00', 'UTC') AS cohort_start
),

orgs AS (
  SELECT o.organization_id, o.created_at
  FROM octopus_analyticspostgres_organizations_v1 o
  CROSS JOIN params p
  WHERE o.provisional_eligible
    AND o.created_at >= p.cohort_start
    AND o.created_at < p.cutoff
),

payments AS (
  SELECT
    c.organization_id,
    min(c.occurred_at) AS first_purchase_at,
    1 AS has_purchase
  FROM octopus_analyticspostgres_cash_events_v1 c
  JOIN orgs o ON c.organization_id = o.organization_id
  CROSS JOIN params p
  WHERE c.event_type = 'purchase'
    AND c.occurred_at >= o.created_at
    AND c.occurred_at < p.cutoff
  GROUP BY c.organization_id
)

SELECT
  toDate(toStartOfWeek(o.created_at, 1)) AS signup_week,
  count() AS eligible_orgs,
  countIf(coalesce(pay.has_purchase, 0) = 1) AS paid_observed
FROM orgs o
LEFT JOIN payments pay ON o.organization_id = pay.organization_id
GROUP BY signup_week
ORDER BY signup_week
