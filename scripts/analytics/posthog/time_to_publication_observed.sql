-- Time to publication observed
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per organisation with a publication within 14 days; one
-- result row. Check: the organisation count equals the numerator of
-- "Publication observed within 14 days".

WITH orgs AS (
    SELECT
        organization_id,
        toDateTime(created_at) AS created_at
    FROM octopus_analyticspostgres_organizations_v1
    WHERE provisional_eligible
        AND created_at >= toDateTime('2026-09-21 00:00:00', 'UTC')
        AND created_at <= subtractDays(toDateTime(toStartOfWeek(now(), 1), 'UTC'), 14)
),

per_org AS (
    SELECT
        o.organization_id,
        o.created_at,
        dateDiff('minute', o.created_at, min(r.first_publication_recorded_at)) AS minutes_to_first_publication
    FROM orgs o
    LEFT JOIN octopus_analyticspostgres_review_milestones_v1 r ON o.organization_id = r.organization_id
    WHERE first_publication_recorded_at >= o.created_at
      AND first_publication_recorded_at < addDays(o.created_at, 14)
    GROUP BY o.organization_id, o.created_at
)

SELECT
    count() AS organisations,
    round(quantileExact(0.5)(minutes_to_first_publication)/60, 1) AS median_hours,
    round(quantileExact(0.9)(minutes_to_first_publication)/60, 1) AS p90_hours,
    round(max(minutes_to_first_publication/60), 1) AS max_hours
FROM per_org
