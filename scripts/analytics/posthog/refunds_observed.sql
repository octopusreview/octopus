-- Refunds observed
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per organisation in the cohort; one result row. Organisations
-- created from 21 Sep 2026. Refunds are counted as events, never netted
-- against purchases, and a refunded organisation still counts as paid.
-- Checks: cohort_orgs = the sum of eligible_orgs in "Paid observed per sign-up
-- week"; all_refund_events_any_org (every refund before the cutoff, any
-- organisation) shows the refund filter finds rows even when the cohort has none.

WITH params AS (
  SELECT
    toDateTime(toStartOfWeek(now(), 1), 'UTC') AS cutoff,
    toDateTime('2026-09-21 00:00:00', 'UTC') AS cohort_start
),

orgs AS (
  SELECT o.organization_id, o.created_at, p.cutoff
  FROM octopus_analyticspostgres_organizations_v1 o
  CROSS JOIN params p
  WHERE o.provisional_eligible
    AND o.created_at >= p.cohort_start
    AND o.created_at < p.cutoff
),

refunds AS (
  SELECT
    c.organization_id,
    count() AS refund_events,
    1 AS has_refund
  FROM octopus_analyticspostgres_cash_events_v1 c
  JOIN orgs o ON c.organization_id = o.organization_id
  WHERE c.event_type = 'refund'
    AND c.occurred_at >= o.created_at
    AND c.occurred_at < o.cutoff
  GROUP BY c.organization_id
),

purchases AS (
  SELECT
    c.organization_id,
    1 AS has_purchase
  FROM octopus_analyticspostgres_cash_events_v1 c
  JOIN orgs o ON c.organization_id = o.organization_id
  WHERE c.event_type = 'purchase'
    AND c.occurred_at >= o.created_at
    AND c.occurred_at < o.cutoff
  GROUP BY c.organization_id
),

all_refunds AS (
  SELECT count() AS all_refund_events_any_org
  FROM octopus_analyticspostgres_cash_events_v1 c
  CROSS JOIN params p
  WHERE c.event_type = 'refund'
    AND c.occurred_at < p.cutoff
)

SELECT
  count() AS cohort_orgs,
  countIf(coalesce(r.has_refund, 0) = 1) AS refunded_orgs,
  sum(coalesce(r.refund_events, 0)) AS refund_events,
  countIf(coalesce(r.has_refund, 0) = 1
          AND coalesce(pu.has_purchase, 0) = 1) AS refunded_orgs_also_paid,
  max(a.all_refund_events_any_org) AS all_refund_events_any_org
FROM orgs o
LEFT JOIN refunds r ON o.organization_id = r.organization_id
LEFT JOIN purchases pu ON o.organization_id = pu.organization_id
CROSS JOIN all_refunds a
