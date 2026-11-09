-- Publication observed within 14 days
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. Cutoff: the most recent Monday 00:00 UTC.
-- To reproduce a documented result, replace the cutoff expression with that date.
--
-- Grain: one row per organisation in the cohort; one result row. Organisations
-- created from 21 Sep 2026, when publication data starts.

WITH orgs AS (
    SELECT organization_id, created_at
    FROM octopus_analyticspostgres_organizations_v1
    WHERE provisional_eligible
        AND created_at >= toDateTime('2026-09-21 00:00:00', 'UTC')
        AND created_at <= subtractDays(toDateTime(toStartOfWeek(now(), 1), 'UTC'), 14)
),

publications AS (
    SELECT
        p.organization_id,
        min(p.first_publication_recorded_at) AS first_publication_at,
        1 AS has_publication
    FROM octopus_analyticspostgres_review_milestones_v1 p
    JOIN orgs o ON p.organization_id = o.organization_id
    WHERE p.first_publication_recorded_at >= o.created_at
    GROUP BY p.organization_id
)

SELECT
    count() AS mature_orgs,
    countIf(coalesce(p.has_publication, 0) = 1
            AND p.first_publication_at < addDays(o.created_at, 14)) AS published_within_14d,
    round(100.0 * published_within_14d / nullIf(mature_orgs, 0), 1) AS rate_14d
FROM orgs o
LEFT JOIN publications p ON o.organization_id = p.organization_id
