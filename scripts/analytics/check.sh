#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Local disposable Postgres only: no published port or network access.
image=${ANALYTICS_TEST_POSTGRES_IMAGE:-postgres:17-alpine}
container="octopus-analytics-check-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
for i in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_fixture() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_fixture <<'SQL'
CREATE TABLE organizations (id text PRIMARY KEY,"createdAt" timestamp,type int,"bannedAt" timestamp,"deletedAt" timestamp,"anthropicApiKey" text);
CREATE TABLE repositories (id text PRIMARY KEY,"organizationId" text,provider text,"createdAt" timestamp,"isActive" boolean,"autoReview" boolean,"indexStatus" text,"indexedAt" timestamp);
CREATE TABLE pull_requests (id text PRIMARY KEY,"repositoryId" text,"createdAt" timestamp,"firstReviewCompletedAt" timestamp,status text,"reviewBody" text);
CREATE TABLE marketing_conversions ("organizationId" text,environment text,status text,kind text,payload text);
INSERT INTO organizations VALUES ('one','2026-09-01',1,null,null,'DO-NOT-EXPORT'),('banned','2026-09-01',1,now(),null,'PRIVATE');
INSERT INTO repositories VALUES ('repo','one','github','2026-09-02',true,true,'indexed','2026-09-09');
INSERT INTO pull_requests VALUES ('pr','repo','2026-09-03','2026-09-04','completed','private source content');
INSERT INTO marketing_conversions VALUES ('one','live','delivered','purchase',json_build_object('schemaVersion',1,'eventId','payment_'||repeat('a',64),'eventType','purchase','currency','USD','amountMinor','1000','occurredAt','2026-09-05T00:00:00Z')::text);
INSERT INTO marketing_conversions SELECT * FROM marketing_conversions;
INSERT INTO marketing_conversions VALUES ('one','test','delivered','purchase','{}'),('one','live','pending','purchase','{}'),('one','live','delivered','purchase','bad json');
SQL
psql_fixture < access.sql
psql_fixture <<'SQL'
SET ROLE octopus_analytics_reader;
DO $$ BEGIN
  IF (SELECT count(*) FROM octopus_analytics.organizations_v1 WHERE provisional_eligible) <> 1 THEN RAISE EXCEPTION 'cohort'; END IF;
  IF (SELECT count(*) FROM octopus_analytics.cash_events_v1) <> 1 THEN RAISE EXCEPTION 'dedup'; END IF;
  IF (SELECT amount_minor FROM octopus_analytics.cash_events_v1) <> 1000 THEN RAISE EXCEPTION 'cash'; END IF;
  IF (SELECT substantive_activation_at FROM octopus_analytics.review_milestones_v1) IS NOT NULL THEN RAISE EXCEPTION 'false activation'; END IF;
  BEGIN PERFORM "anthropicApiKey" FROM public.organizations; RAISE EXCEPTION 'secret readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.organizations SET type=2; RAISE EXCEPTION 'source writable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE octopus_analytics.organizations_v1 SET organization_type=2; RAISE EXCEPTION 'view writable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN EXECUTE 'CREATE TABLE public.analytics_escape(id int)'; RAISE EXCEPTION 'schema writable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='octopus_analytics' AND column_name IN ('anthropicApiKey','reviewBody','payload')) THEN RAISE EXCEPTION 'unsafe projection'; END IF;
END $$;
RESET ROLE;
-- Same event ID with conflicting facts must disappear rather than pick a row.
INSERT INTO marketing_conversions VALUES ('one','live','delivered','purchase',json_build_object('schemaVersion',1,'eventId','payment_'||repeat('a',64),'eventType','purchase','currency','USD','amountMinor','2000','occurredAt','2026-09-05T00:00:00Z')::text);
DO $$ BEGIN
 IF (SELECT count(*) FROM octopus_analytics.cash_events_v1) <> 0 THEN RAISE EXCEPTION 'conflicting cash accepted'; END IF;
END $$;
SQL
# A repeated install refuses collisions and cannot reset a provisioned role.
if psql_fixture < access.sql >/dev/null 2>&1; then echo 'Repeated setup unexpectedly succeeded' >&2; exit 1; fi
baseline=$(psql_fixture -q --csv -v as_of=2026-10-01T00:00:00Z -c 'SET ROLE octopus_analytics_reader' -f /dev/stdin < funnel.sql)
ANALYTICS_TEST_RESULT="$baseline" python3 - <<'PYTEST'
import csv, io, os
rows=list(csv.DictReader(io.StringIO(os.environ['ANALYTICS_TEST_RESULT'])))
assert len(rows)==1, rows
row=rows[0]
for key in ('provisional_organizations','repository_connected_observed','publication_observed','mature_7d_organizations','publication_within_7d_observed'):
    assert row[key]=='1', (key,row)
assert row['paid_observed']=='0', row
assert float(row['median_hours_to_observed_publication'])==72, row
assert float(row['p90_hours_to_observed_publication'])==72, row
PYTEST
printf '%s\n' 'PASS: real PostgreSQL projections, privileges, cash dedup/conflicts, unknown activation and collision refusal'
