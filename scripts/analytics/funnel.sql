\set ON_ERROR_STOP on
-- UTC observation cutoff supplied by the operator; no identifiers in output.
WITH orgs AS (
  SELECT * FROM octopus_analytics.organizations_v1
  WHERE provisional_eligible AND created_at < :'as_of'::timestamptz AT TIME ZONE 'UTC'
), repositories AS (
  SELECT r.organization_id, min(r.connected_at) AS repository_at
  FROM octopus_analytics.repositories_v1 r JOIN orgs o USING (organization_id)
  WHERE r.connected_at >= o.created_at
    AND r.connected_at < :'as_of'::timestamptz AT TIME ZONE 'UTC'
  GROUP BY r.organization_id
), publications AS (
  SELECT p.organization_id, min(p.first_publication_recorded_at) AS publication_at
  FROM octopus_analytics.review_milestones_v1 p JOIN orgs o USING (organization_id)
  WHERE p.first_publication_recorded_at >= o.created_at
    AND p.first_publication_recorded_at < :'as_of'::timestamptz AT TIME ZONE 'UTC'
  GROUP BY p.organization_id
), payments AS (
  SELECT c.organization_id, min(c.occurred_at AT TIME ZONE 'UTC') AS paid_observed_at
  FROM octopus_analytics.cash_events_v1 c JOIN orgs o USING (organization_id)
  WHERE c.event_type = 'purchase' AND c.occurred_at >= o.created_at AT TIME ZONE 'UTC'
    AND c.occurred_at < :'as_of'::timestamptz
  GROUP BY c.organization_id
), milestones AS (
  SELECT o.organization_id, o.created_at, r.repository_at, p.publication_at, c.paid_observed_at
  FROM orgs o
  LEFT JOIN repositories r USING (organization_id)
  LEFT JOIN publications p USING (organization_id)
  LEFT JOIN payments c USING (organization_id)
)
SELECT date_trunc('week', created_at)::date AS signup_week,
  count(*) AS provisional_organizations,
  count(repository_at) AS repository_connected_observed,
  count(publication_at) AS publication_observed,
  count(*) FILTER (WHERE created_at <= (:'as_of'::timestamptz AT TIME ZONE 'UTC') - interval '7 days') AS mature_7d_organizations,
  count(*) FILTER (WHERE created_at <= (:'as_of'::timestamptz AT TIME ZONE 'UTC') - interval '7 days'
    AND publication_at < created_at + interval '7 days') AS publication_within_7d_observed,
  count(paid_observed_at) AS paid_observed,
  count(*) FILTER (WHERE paid_observed_at >= publication_at) AS observed_payment_after_publication,
  count(*) FILTER (WHERE paid_observed_at < publication_at) AS observed_payment_before_publication,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM publication_at-created_at)/3600)
    AS median_hours_to_observed_publication,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM publication_at-created_at)/3600)
    AS p90_hours_to_observed_publication
FROM milestones GROUP BY 1 ORDER BY 1;
