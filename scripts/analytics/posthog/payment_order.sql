-- Payment order
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per paying organisation; one result row. Organisations
-- created from 21 Sep 2026, when publication data starts. Checks:
-- paid_orgs = paid_without_publication + paid_with_publication;
-- paid_with_publication = paid_before_publication + paid_at_or_after_publication;
-- paid_orgs = the sum of paid_observed in "Paid observed per sign-up week".

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

first_purchase AS (
  SELECT
    c.organization_id,
    min(c.occurred_at) AS first_purchase_at
  FROM octopus_analyticspostgres_cash_events_v1 c
  JOIN orgs o ON c.organization_id = o.organization_id
  WHERE c.event_type = 'purchase'
    AND c.occurred_at >= o.created_at
    AND c.occurred_at < o.cutoff
  GROUP BY c.organization_id
),

first_publication AS (
  SELECT
    m.organization_id,
    min(m.first_publication_recorded_at) AS first_publication_at,
    1 AS has_publication
  FROM octopus_analyticspostgres_review_milestones_v1 m
  JOIN orgs o ON m.organization_id = o.organization_id
  WHERE m.first_publication_recorded_at >= o.created_at
    AND m.first_publication_recorded_at < o.cutoff
  GROUP BY m.organization_id
)

SELECT
  count() AS paid_orgs,
  countIf(coalesce(pub.has_publication, 0) = 0) AS paid_without_publication,
  countIf(coalesce(pub.has_publication, 0) = 1) AS paid_with_publication,
  countIf(coalesce(pub.has_publication, 0) = 1
          AND pay.first_purchase_at < pub.first_publication_at) AS paid_before_publication,
  countIf(coalesce(pub.has_publication, 0) = 1
          AND pay.first_purchase_at >= pub.first_publication_at) AS paid_at_or_after_publication
FROM first_purchase pay
LEFT JOIN first_publication pub ON pay.organization_id = pub.organization_id
