#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Local disposable Postgres only: no published port or network access.
image=postgres@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317
container=$(docker run --pull never --rm -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$image")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
for _ in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_fixture() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_fixture <<'SQL'
DO $$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'PostgreSQL 17 required'; END IF;
END $$;
CREATE TABLE organizations (id text PRIMARY KEY,"createdAt" timestamp,type int,"bannedAt" timestamp,"deletedAt" timestamp,"anthropicApiKey" text,"creationSource" text,"creatorFirstOrganization" boolean);
CREATE TABLE users (id text PRIMARY KEY,"arrivalSource" text);
CREATE TABLE organization_members (id text PRIMARY KEY,"organizationId" text NOT NULL,"userId" text NOT NULL,role text NOT NULL,"createdAt" timestamp NOT NULL,"deletedAt" timestamp, UNIQUE ("organizationId","userId"));
CREATE INDEX organization_members_userId_idx ON organization_members ("userId");
CREATE TABLE repositories (id text PRIMARY KEY,"organizationId" text,provider text,"createdAt" timestamp,"isActive" boolean,"autoReview" boolean,"indexStatus" text,"indexedAt" timestamp,"firstIndexedAt" timestamp);
CREATE TABLE pull_requests (id text PRIMARY KEY,"repositoryId" text,"createdAt" timestamp,"firstReviewCompletedAt" timestamp,status text,"reviewBody" text);
CREATE TABLE marketing_conversions ("organizationId" text,environment text,status text,kind text,payload text);
INSERT INTO organizations (id,"createdAt",type,"bannedAt","deletedAt","anthropicApiKey") VALUES ('one','2026-09-01',1,null,null,'DO-NOT-EXPORT'),('banned','2026-09-01',1,now(),null,'PRIVATE');
INSERT INTO repositories VALUES ('repo','one','github','2026-09-02',true,true,'indexed','2026-09-09','2026-09-09');
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
# Updates must refuse missing prerequisites without installing anything.
if output=$(psql_fixture < update-repositories-first-index.sql 2>&1); then
  echo 'Update unexpectedly accepted a missing schema' >&2; exit 1
fi
[[ "$output" == *'Analytics schema missing; install access.sql before this update'* ]]
psql_fixture -c 'CREATE SCHEMA octopus_analytics'
if output=$(psql_fixture < update-repositories-first-index.sql 2>&1); then
  echo 'Update unexpectedly accepted a missing view' >&2; exit 1
fi
[[ "$output" == *'Analytics repositories_v1 view missing; install access.sql before this update'* ]]
psql_fixture -c 'DROP SCHEMA octopus_analytics'
# Column grants must reject installation and roll back its role and schema.
psql_fixture -c 'GRANT SELECT ("anthropicApiKey") ON organizations TO PUBLIC'
if output=$(psql_fixture < access.sql 2>&1); then
  echo 'PUBLIC column grant unexpectedly accepted' >&2; exit 1
fi
[[ "$output" == *'Existing public privileges need operator review; no changes applied'* ]]
psql_fixture <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'octopus_analytics_reader')
    OR to_regnamespace('octopus_analytics') IS NOT NULL THEN RAISE EXCEPTION 'installation not rolled back'; END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE att.attrelid = 'organizations'::regclass AND att.attname = 'anthropicApiKey'
      AND a.grantee = 0 AND a.privilege_type = 'SELECT'
  ) THEN RAISE EXCEPTION 'existing column grant changed'; END IF;
END $$;
REVOKE SELECT ("anthropicApiKey") ON organizations FROM PUBLIC;
SQL
psql_fixture < access.sql
check_reader() {
  psql_fixture <<'SQL'
SET ROLE octopus_analytics_reader;
DO $$ BEGIN
  IF (SELECT count(*) FROM octopus_analytics.organizations_v1 WHERE provisional_eligible) <> 1 THEN RAISE EXCEPTION 'cohort'; END IF;
  IF (SELECT first_index_at FROM octopus_analytics.repositories_v1 WHERE repository_id='octopus:repo:repo')
    IS DISTINCT FROM timestamp '2026-09-09' THEN RAISE EXCEPTION 'first index projection'; END IF;
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
SQL
}
# Fresh installs expose the new column and retain all deny checks.
check_reader
psql_fixture <<'SQL'
CREATE TABLE analytics_fixture_fresh_view AS
SELECT pg_get_viewdef(c.oid) AS definition, c.relowner, c.relacl, c.reloptions,
  (SELECT jsonb_agg(jsonb_build_array(a.attname, a.atttypid, a.atttypmod, a.attcollation) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
FROM pg_class c WHERE c.oid='octopus_analytics.repositories_v1'::regclass;
-- Restore the previous installed view and its existing table-level reader grant.
DROP VIEW octopus_analytics.repositories_v1;
CREATE VIEW octopus_analytics.repositories_v1 WITH (security_barrier = true) AS
SELECT 'octopus:repo:' || id AS repository_id,
  'octopus:org:' || "organizationId" AS organization_id,
  CASE WHEN provider IN ('github','gitlab','bitbucket','forgejo') THEN provider ELSE 'other' END AS provider,
  "createdAt" AS connected_at, "isActive" AS is_active, "autoReview" AS auto_review,
  CASE WHEN "indexStatus" IN ('pending','indexing','indexed','failed') THEN "indexStatus" ELSE 'unknown' END AS index_status,
  "indexedAt" AS latest_index_at
FROM public.repositories;
GRANT SELECT ON octopus_analytics.repositories_v1 TO octopus_analytics_reader;
CREATE TABLE analytics_fixture_upgrade_view AS
SELECT oid AS view_oid, relowner, relacl, reloptions FROM pg_class
WHERE oid='octopus_analytics.repositories_v1'::regclass;
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema='octopus_analytics'
    AND table_name='repositories_v1' AND column_name='first_index_at') THEN
    RAISE EXCEPTION 'previous view already exposes first_index_at';
  END IF;
END $$;
SQL
for _ in 1 2; do
  psql_fixture < update-repositories-first-index.sql
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class c CROSS JOIN analytics_fixture_fresh_view fresh
      CROSS JOIN analytics_fixture_upgrade_view previous
    WHERE c.oid='octopus_analytics.repositories_v1'::regclass AND c.oid=previous.view_oid
      AND c.relowner=previous.relowner AND c.relacl IS NOT DISTINCT FROM previous.relacl
      AND c.reloptions IS NOT DISTINCT FROM previous.reloptions
      AND c.relowner=fresh.relowner AND c.relacl IS NOT DISTINCT FROM fresh.relacl
      AND c.reloptions IS NOT DISTINCT FROM fresh.reloptions
      AND 'security_barrier=true'=ANY(c.reloptions)
      AND pg_get_viewdef(c.oid)=fresh.definition
      AND (SELECT jsonb_agg(jsonb_build_array(a.attname, a.atttypid, a.atttypmod, a.attcollation) ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=fresh.columns
  ) THEN RAISE EXCEPTION 'upgraded view differs or lost identity, owner, barrier or grants'; END IF;
END $$;
SQL
  check_reader
done
psql_fixture -c 'DROP TABLE analytics_fixture_fresh_view, analytics_fixture_upgrade_view'
psql_fixture <<'SQL'
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
INSERT INTO organizations (id,"createdAt",type,"bannedAt","deletedAt","anthropicApiKey")
SELECT 'scale-'||i, '2026-09-14', 1, NULL, NULL, 'PRIVATE' FROM generate_series(1,10000) i;
INSERT INTO organizations (id,"createdAt",type,"bannedAt","deletedAt","anthropicApiKey") VALUES
  ('immature','2026-09-28',1,NULL,NULL,'PRIVATE'),
  ('cutoff','2026-10-01',1,NULL,NULL,'PRIVATE'),
  ('future','2026-10-02',1,NULL,NULL,'PRIVATE'),
  ('deleted','2026-09-14',1,NULL,'2026-09-15','PRIVATE'),
  ('nonstandard','2026-09-14',2,NULL,NULL,'PRIVATE');
INSERT INTO repositories
SELECT 'scale-repo-'||i||'-'||j, 'scale-'||i, 'github',
  CASE WHEN j=1 THEN timestamp '2026-09-13'
    WHEN i%5 IN (0,4) THEN timestamp '2026-10-01' ELSE timestamp '2026-09-14' END,
  true, true, 'indexed', NULL, NULL
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,2) j;
INSERT INTO repositories VALUES ('immature-repo','immature','github','2026-09-28',true,true,'pending',NULL,NULL);
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
printf '%s\n' 'PASS: PostgreSQL 17 fresh and upgraded first-index projection, repeat update, retained grants and deny checks, cash safeguards, unknown activation, collision refusal and scaled UTC funnel'

# Provenance cases are synthetic identifiers and bounded categories only.
psql_fixture <<'SQL'
CREATE TABLE provenance_cases (
  id text PRIMARY KEY, source text, first_membership boolean, arrival text,
  expected_source text NOT NULL, expected_first text NOT NULL, expected_arrival text NOT NULL
);
INSERT INTO provenance_cases VALUES
 ('signup','auto_default',true,'signup','auto_default','yes','signup'),
 ('invite','user_created',false,'invite','user_created','no','invite'),
 ('system',NULL,NULL,'system','not_recorded','not_recorded','system'),
 ('legacy',NULL,NULL,NULL,'not_recorded','not_recorded','not_recorded'),
 ('null-arrival','auto_default',NULL,NULL,'auto_default','not_recorded','not_recorded'),
 ('other-arrival','user_created',true,'unexpected','user_created','yes','other'),
 ('removed','auto_default',false,'signup','auto_default','no','signup'),
 ('two-owners','auto_default',true,'invite','auto_default','yes','no_creator'),
 ('late-owner','user_created',false,'system','user_created','no','no_creator'),
 ('no-owner',NULL,NULL,NULL,'not_recorded','not_recorded','no_creator'),
 ('community','community_bot',NULL,'signup','community_bot','not_recorded','no_creator'),
 ('demo','demo_seed',NULL,'signup','demo_seed','not_recorded','no_creator'),
 ('other-source','auto-default',NULL,'signup','other','not_recorded','no_creator'),
 ('missing-user','auto_default',NULL,'signup','auto_default','not_recorded','no_creator');
INSERT INTO organizations (id,"createdAt",type,"creationSource","creatorFirstOrganization")
SELECT 'provenance-'||id, timestamp '2026-09-02', 1, source, first_membership FROM provenance_cases;
INSERT INTO users SELECT 'provenance-'||id, arrival FROM provenance_cases WHERE id <> 'missing-user';
INSERT INTO organization_members
SELECT 'provenance-'||id, 'provenance-'||id, 'provenance-'||id, 'owner',
  timestamp '2026-09-02' + CASE WHEN id='late-owner' THEN interval '1 second' ELSE interval '0' END,
  CASE WHEN id='removed' THEN timestamp '2026-09-03' END
FROM provenance_cases WHERE id <> 'no-owner';
INSERT INTO organization_members VALUES
 ('provenance-second-owner','provenance-two-owners','provenance-signup','owner','2026-09-02',NULL),
 ('provenance-non-owner','provenance-signup','provenance-invite','member','2026-09-02',NULL);
CREATE TABLE provenance_fresh AS
SELECT pg_get_viewdef(c.oid) AS definition, c.relowner, c.relacl, c.reloptions,
  (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
FROM pg_class c WHERE c.oid='octopus_analytics.organization_provenance_v1'::regclass;
SQL
check_provenance() {
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF EXISTS (
    SELECT FROM provenance_cases c LEFT JOIN octopus_analytics.organization_provenance_v1 v
      ON v.organization_id='octopus:org:provenance-'||c.id
    WHERE v.creation_source IS DISTINCT FROM c.expected_source
      OR v.creator_first_membership IS DISTINCT FROM c.expected_first
      OR v.creator_arrival_source IS DISTINCT FROM c.expected_arrival
  ) THEN RAISE EXCEPTION 'provenance label or creator rules'; END IF;
  IF EXISTS (SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid='octopus_analytics.organization_provenance_v1'::regclass AND a.grantee=0)
    THEN RAISE EXCEPTION 'provenance PUBLIC access'; END IF;
END $$;
SET ROLE octopus_analytics_reader;
DO $$ BEGIN
  IF (SELECT array_agg(column_name::text ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema='octopus_analytics'
        AND table_name='organization_provenance_v1') IS DISTINCT FROM
    ARRAY['organization_id','creation_source','creator_first_membership','creator_arrival_source']
    THEN RAISE EXCEPTION 'provenance column contract'; END IF;
  IF (SELECT count(*) FROM octopus_analytics.organization_provenance_v1)
      <> (SELECT count(*) FROM octopus_analytics.organizations_v1)
    OR (SELECT count(DISTINCT organization_id) FROM octopus_analytics.organization_provenance_v1)
      <> (SELECT count(*) FROM octopus_analytics.organizations_v1)
    THEN RAISE EXCEPTION 'provenance cardinality'; END IF;
  IF EXISTS (SELECT FROM octopus_analytics.organization_provenance_v1
    WHERE creation_source IS NULL OR creator_first_membership IS NULL OR creator_arrival_source IS NULL
      OR creation_source NOT IN ('auto_default','user_created','community_bot','demo_seed','not_recorded','other')
      OR creator_first_membership NOT IN ('yes','no','not_recorded')
      OR creator_arrival_source NOT IN ('signup','invite','system','not_recorded','other','no_creator'))
    THEN RAISE EXCEPTION 'provenance label allowlist'; END IF;
  BEGIN PERFORM id FROM public.organizations; RAISE EXCEPTION 'organizations readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM id FROM public.users; RAISE EXCEPTION 'users readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM id FROM public.organization_members; RAISE EXCEPTION 'members readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SQL
}
check_provenance
psql_fixture <<'SQL'
-- Removing only this new view simulates an existing pre-feature installation.
DROP VIEW octopus_analytics.organization_provenance_v1;
CREATE TABLE provenance_baseline AS
SELECT c.oid,c.relname,c.relowner,c.relacl,c.reloptions,pg_get_viewdef(c.oid) AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='octopus_analytics' AND c.relkind='v';
SQL
for prerequisite in schema role view creationSource creatorFirstOrganization arrivalSource; do
  case "$prerequisite" in
    schema) setup='ALTER SCHEMA octopus_analytics RENAME TO provenance_saved_schema;'; message='Analytics schema missing;' ;;
    role) setup='ALTER ROLE octopus_analytics_reader RENAME TO provenance_saved_role;'; message='Analytics reader role missing;' ;;
    view) setup='ALTER VIEW octopus_analytics.organizations_v1 RENAME TO provenance_saved_view;'; message='Analytics organizations_v1 view missing;' ;;
    creationSource|creatorFirstOrganization)
      setup="ALTER TABLE public.organizations RENAME COLUMN \"$prerequisite\" TO provenance_saved_column;"
      message="Source column public.organizations.\"$prerequisite\" missing;" ;;
    arrivalSource) setup='ALTER TABLE public.users RENAME COLUMN "arrivalSource" TO provenance_saved_column;'; message='Source column public.users."arrivalSource" missing;' ;;
  esac
  # Failure closes the session and rolls back the transaction-local rename too.
  if output=$({ printf 'BEGIN;\n%s\n' "$setup"; cat update-organization-provenance.sql; } | psql_fixture 2>&1); then
    echo "Provenance update unexpectedly accepted missing $prerequisite" >&2; exit 1
  fi
  [[ "$output" == *"$message"* ]]
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF to_regclass('octopus_analytics.organization_provenance_v1') IS NOT NULL
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='octopus_analytics_reader')
    OR EXISTS (
      SELECT FROM provenance_baseline b LEFT JOIN pg_class c ON c.oid=b.oid
      WHERE c.oid IS NULL OR c.relname IS DISTINCT FROM b.relname
        OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl
        OR c.reloptions IS DISTINCT FROM b.reloptions OR pg_get_viewdef(c.oid) IS DISTINCT FROM b.definition
    ) OR (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.organizations'::regclass AND attname IN ('creationSource','creatorFirstOrganization')
        AND attnum>0 AND NOT attisdropped) <> 2
    OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid='public.users'::regclass
      AND attname='arrivalSource' AND attnum>0 AND NOT attisdropped)
    THEN RAISE EXCEPTION 'failed provenance update changed installed objects'; END IF;
END $$;
SQL
  printf 'PASS: provenance missing %s stops and rolls back\n' "$prerequisite"
done
for iteration in 1 2; do
  if [[ "$iteration" == 2 ]]; then
    psql_fixture -c "CREATE TABLE provenance_previous AS SELECT oid,relowner,relacl,reloptions FROM pg_class WHERE oid='octopus_analytics.organization_provenance_v1'::regclass"
    psql_fixture -c 'GRANT SELECT ON octopus_analytics.organization_provenance_v1 TO PUBLIC'
  fi
  psql_fixture < update-organization-provenance.sql
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class c CROSS JOIN provenance_fresh f
    WHERE c.oid='octopus_analytics.organization_provenance_v1'::regclass
      AND c.relowner=f.relowner AND c.relacl IS NOT DISTINCT FROM f.relacl
      AND c.reloptions IS NOT DISTINCT FROM f.reloptions
      AND 'security_barrier=true'=ANY(c.reloptions)
      AND pg_get_viewdef(c.oid)=f.definition
      AND (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=f.columns
  ) THEN RAISE EXCEPTION 'provenance fresh/update definition, columns, owner, grants or barrier'; END IF;
END $$;
SQL
  if [[ "$iteration" == 2 ]]; then
    psql_fixture <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_class c CROSS JOIN provenance_previous p
    WHERE c.oid='octopus_analytics.organization_provenance_v1'::regclass AND c.oid=p.oid
      AND c.relowner=p.relowner AND c.relacl IS NOT DISTINCT FROM p.relacl
      AND c.reloptions IS NOT DISTINCT FROM p.reloptions)
    THEN RAISE EXCEPTION 'repeat provenance update changed identity, owner, grants or barrier'; END IF;
END $$;
DROP TABLE provenance_previous;
SQL
  fi
  check_provenance
  printf 'PASS: provenance update %s matches fresh install and retains contract/privileges\n' "$iteration"
done
psql_fixture <<'SQL'
-- Reuse the existing 10,000 synthetic organisations after all funnel assertions.
INSERT INTO users
SELECT 'provenance-scale-user-'||i,
  CASE i%4 WHEN 0 THEN 'signup' WHEN 1 THEN 'invite' WHEN 2 THEN 'system' END
FROM generate_series(1,10000) i;
INSERT INTO organization_members
SELECT 'provenance-scale-member-'||i, 'scale-'||i, 'provenance-scale-user-'||i,
  'owner', timestamp '2026-09-14', NULL FROM generate_series(1,10000) i;
ANALYZE;
SQL
check_provenance
provenance_plan=$(psql_fixture -qAt -c "SET ROLE octopus_analytics_reader; SET statement_timeout = '15s'" -c 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM octopus_analytics.organization_provenance_v1')
ANALYTICS_TEST_PLAN="$provenance_plan" python3 - <<'PYTEST'
import json, os
p = json.loads(os.environ['ANALYTICS_TEST_PLAN'])[0]
scans = {}
def visit(n, depth=0):
    relation = n.get('Relation Name')
    if relation in ('organizations', 'organization_members', 'users'):
        assert n['Actual Loops'] == 1, 'repeated source scan'
        scans[relation] = scans.get(relation, 0) + 1
    if n.get('Parent Relationship') == 'SubPlan':
        assert n['Actual Loops'] <= 1, 'per-organisation subplan'
    print('  '*depth + f"{n['Node Type']} {relation or ''}: rows={n['Actual Rows']}, loops={n['Actual Loops']}")
    for child in n.get('Plans', []): visit(child, depth+1)
visit(p['Plan'])
assert scans.get('organization_members') == 1, scans
assert scans.get('users') == 1, scans
assert p['Execution Time'] < 15000, p['Execution Time']
print(f"PASS: synthetic provenance plan, execution {p['Execution Time']} ms / 15000 ms timeout")
PYTEST
psql_fixture <<'SQL'
SET ROLE octopus_analytics_reader;
DO $$ BEGIN
  IF (SELECT count(*) FROM octopus_analytics.organization_provenance_v1
    WHERE organization_id LIKE 'octopus:org:scale-%') <> 10000
    OR (SELECT count(DISTINCT creator_arrival_source) FROM octopus_analytics.organization_provenance_v1
      WHERE organization_id LIKE 'octopus:org:scale-%') <> 4
    OR EXISTS (SELECT FROM octopus_analytics.organization_provenance_v1
      WHERE organization_id LIKE 'octopus:org:scale-%'
      GROUP BY creator_arrival_source HAVING count(*)<>2500)
    THEN RAISE EXCEPTION 'scaled provenance labels'; END IF;
END $$;
RESET ROLE;
DROP TABLE provenance_fresh, provenance_baseline, provenance_cases;
SQL
printf '%s\n' 'PASS: provenance labels, creator rules, four-column contract, all-organisation cardinality, source denials, PUBLIC denial, fresh/update parity, repeat update and 10000-organisation plan'
