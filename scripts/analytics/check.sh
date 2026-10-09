#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Local disposable Postgres only: no published port or network access.
image=postgres@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317
container="octopus-analytics-check-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --pull never --rm -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
for i in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_fixture() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_fixture <<'SQL'
DO $$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'PostgreSQL 17 required'; END IF;
END $$;
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
INSERT INTO marketing_conversions
SELECT 'one','live','delivered','purchase',payload FROM (VALUES
  ('[]'), ('null'), ('{"invalid":"\u0000"}'), ('{"invalid":1e1000000}'),
  (json_build_object('schemaVersion',1,'eventId','payment_'||repeat('b',64),'eventType','purchase','currency','USD','amountMinor','not money','occurredAt','2026-09-05T00:00:00Z')::text),
  (json_build_object('schemaVersion',1,'eventId','payment_'||repeat('c',64),'eventType','purchase','currency','USD','amountMinor','1000','occurredAt','not a date')::text)
) AS invalid(payload);
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
psql_fixture <<'SQL'
INSERT INTO organizations
SELECT 'scale-'||i, '2026-09-14', 1, NULL, NULL, 'PRIVATE' FROM generate_series(1,10000) i;
INSERT INTO organizations VALUES
  ('immature','2026-09-28',1,NULL,NULL,'PRIVATE'),
  ('cutoff','2026-10-01',1,NULL,NULL,'PRIVATE'),
  ('future','2026-10-02',1,NULL,NULL,'PRIVATE'),
  ('deleted','2026-09-14',1,NULL,'2026-09-15','PRIVATE'),
  ('nonstandard','2026-09-14',2,NULL,NULL,'PRIVATE');
INSERT INTO repositories
SELECT 'scale-repo-'||i||'-'||j, 'scale-'||i, 'github',
  CASE WHEN j=1 THEN timestamp '2026-09-13'
    WHEN i%5 IN (0,4) THEN timestamp '2026-10-01' ELSE timestamp '2026-09-14' END,
  true, true, 'indexed', NULL
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,2) j;
INSERT INTO repositories VALUES ('immature-repo','immature','github','2026-09-28',true,true,'pending',NULL);
INSERT INTO pull_requests
SELECT 'scale-pr-'||i||'-'||j, 'scale-repo-'||i||'-2', '2026-09-14',
  CASE WHEN j=1 THEN timestamp '2026-09-13'
    WHEN j=3 THEN NULL
    WHEN j>3 THEN timestamp '2026-10-02'
    WHEN i%5=0 THEN timestamp '2026-09-13'
    WHEN i%5=1 THEN timestamp '2026-09-14'
    WHEN i%5=2 THEN timestamp '2026-09-17'
    WHEN i%5=3 THEN timestamp '2026-09-21'
    ELSE timestamp '2026-10-01' END,
  'completed', 'PRIVATE'
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,10) j;
INSERT INTO pull_requests VALUES ('immature-pr','immature-repo','2026-09-28','2026-09-29','completed','PRIVATE');
INSERT INTO marketing_conversions
SELECT 'scale-'||i, 'live', 'delivered', CASE WHEN j=4 THEN 'refund' ELSE 'purchase' END,
  json_build_object('schemaVersion',1,
    'eventId',CASE WHEN j=4 THEN 'refund_' ELSE 'payment_' END||repeat(md5(i||'-'||j),2),
    'eventType',CASE WHEN j=4 THEN 'refund' ELSE 'purchase' END,
    'currency','USD','amountMinor','1000',
    'occurredAt',CASE WHEN j=1 THEN '2026-09-13T00:00:00Z'
      WHEN j=3 THEN '2026-10-02T00:00:00Z'
      WHEN j=4 THEN '2026-09-14T00:00:00Z'
      WHEN i%5=0 THEN '2026-09-13T00:00:00Z'
      WHEN i%5=1 THEN '2026-09-13T20:00:00-04:00'
      WHEN i%5=2 THEN '2026-09-15T00:00:00Z'
      WHEN i%5=3 THEN '2026-09-22T00:00:00Z'
      ELSE '2026-09-30T20:00:00-04:00' END)::text
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,4) j;
INSERT INTO marketing_conversions SELECT * FROM marketing_conversions WHERE "organizationId" LIKE 'scale-%';
ANALYZE;
SQL
baseline=$(psql_fixture -q --csv -v as_of=2026-09-30T20:00:00-04:00 -c "SET ROLE octopus_analytics_reader; SET TIME ZONE 'Pacific/Honolulu'" -f /dev/stdin < funnel.sql)
ANALYTICS_TEST_RESULT="$baseline" python3 - <<'PYTEST'
import csv, io, os
rows = list(csv.DictReader(io.StringIO(os.environ['ANALYTICS_TEST_RESULT'])))
assert [row['signup_week'] for row in rows] == ['2026-08-31', '2026-09-14', '2026-09-28'], rows
row = rows[1]
expected = {
    'provisional_organizations': 10000,
    'repository_connected_observed': 6000,
    'publication_observed': 6000,
    'mature_7d_organizations': 10000,
    'publication_within_7d_observed': 4000,
    'paid_observed': 6000,
    'observed_payment_after_publication': 4000,
    'observed_payment_before_publication': 2000,
    'median_hours_to_observed_publication': 72,
    'p90_hours_to_observed_publication': 168,
}
for key, value in expected.items():
    assert float(row[key]) == value, (key, row)
row = rows[2]
for key in ('provisional_organizations', 'repository_connected_observed', 'publication_observed'):
    assert row[key] == '1', (key, row)
for key in ('mature_7d_organizations', 'publication_within_7d_observed', 'paid_observed',
            'observed_payment_after_publication', 'observed_payment_before_publication'):
    assert row[key] == '0', (key, row)
assert float(row['median_hours_to_observed_publication']) == 24, row
PYTEST
plan=$({ printf '%s\n' 'EXPLAIN (ANALYZE, FORMAT JSON)'; tail -n +2 funnel.sql; } |
  psql_fixture -qAt -v as_of=2026-10-01T00:00:00Z -c 'SET ROLE octopus_analytics_reader' -f /dev/stdin)
ANALYTICS_TEST_PLAN="$plan" python3 - <<'PYTEST'
import json, os
plan = json.loads(os.environ['ANALYTICS_TEST_PLAN'])[0]
def check(node):
    if node.get('Parent Relationship') == 'SubPlan':
        assert node['Actual Loops'] <= 1, node
    for child in node.get('Plans', []):
        check(child)
check(plan['Plan'])
print(f"PASS: synthetic scale plan, execution {plan['Execution Time']} ms")
PYTEST
printf '%s\n' 'PASS: PostgreSQL 17 projections, privileges, cash safeguards, unknown activation, collision refusal and scaled UTC funnel'
