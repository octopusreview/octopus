-- Eligible organisation
-- Metric dictionary: docs/metric-dictionary.md
-- Language: PostHog HogQL. No cutoff: it shows the current state.
--
-- Grain: one row per combination of type, banned, deleted and eligible. Check:
-- the rows add up to all organisations, and provisional_eligible is true only
-- for standard organisations that are neither banned nor deleted.

SELECT
  organization_type,
  is_banned,
  is_deleted,
  provisional_eligible,
  count() AS organisations
FROM octopus_analyticspostgres_organizations_v1
GROUP BY organization_type, is_banned, is_deleted, provisional_eligible
ORDER BY organisations DESC
