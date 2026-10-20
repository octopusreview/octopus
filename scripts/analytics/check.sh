#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Default remains the pinned Docker fixture. The local backend creates its own
# socket-only cluster; it never accepts a connection URL or reuses a server.
if [[ "${ANALYTICS_TEST_BACKEND:-docker}" != local && "${ANALYTICS_TEST_BACKEND:-docker}" != docker ]]; then
  echo 'ANALYTICS_TEST_BACKEND must be local or docker' >&2; exit 1
fi
if [[ "${ANALYTICS_TEST_BACKEND:-docker}" == local ]]; then
  fixture_dir=$(mktemp -d /tmp/octp-analytics.XXXXXX)
  cleanup_fixture() {
    pg_ctl -D "$fixture_dir/data" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$fixture_dir"
  }
  trap cleanup_fixture EXIT
  initdb -D "$fixture_dir/data" -U postgres --auth-local=trust --auth-host=reject --no-locale >"$fixture_dir/init.log" 2>&1
  pg_ctl -D "$fixture_dir/data" -l "$fixture_dir/server.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$fixture_dir'" -w start >/dev/null 2>&1
  psql_fixture() {
    env -i PATH="$PATH" LC_ALL=C psql -X -h "$fixture_dir" -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  }
  psql_fixture <<'SQL'
DO $$
DECLARE local_major int := current_setting('server_version_num')::int / 10000;
BEGIN
  IF local_major < 17 THEN RAISE EXCEPTION 'PostgreSQL 17 or newer required'; END IF;
  IF local_major <> 17 THEN
    RAISE WARNING 'Local PostgreSQL major version % differs from pinned PostgreSQL 17; this run does not validate the pinned Docker version', local_major;
  END IF;
END $$;
SQL
else
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
SQL
fi
psql_fixture <<'SQL'
CREATE TABLE organizations (id text PRIMARY KEY,"createdAt" timestamp NOT NULL DEFAULT now(),type int,"bannedAt" timestamp,"deletedAt" timestamp,"anthropicApiKey" text,"creationSource" text);
CREATE TABLE users (id text PRIMARY KEY,"createdAt" timestamp NOT NULL DEFAULT now(),"signupMethod" text);
CREATE TABLE organization_members (id text PRIMARY KEY,"organizationId" text NOT NULL,"userId" text NOT NULL,role text NOT NULL,"createdAt" timestamp NOT NULL DEFAULT now(),"deletedAt" timestamp, UNIQUE ("organizationId","userId"));
CREATE INDEX organization_members_userId_idx ON organization_members ("userId");
CREATE TABLE accounts (id text PRIMARY KEY,"userId" text NOT NULL,"providerId" text NOT NULL,"createdAt" timestamp NOT NULL DEFAULT now());
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
# The creation paths use nested owner INSERTs inside one transaction. Verify
# transaction-stable PostgreSQL defaults, even across separate statements.
psql_fixture <<'SQL'
BEGIN;
INSERT INTO organizations (id) VALUES ('timestamp-probe');
DO $$ BEGIN PERFORM pg_sleep(0.01); END $$;
INSERT INTO organization_members (id,"organizationId","userId",role)
VALUES ('timestamp-probe','timestamp-probe','timestamp-probe','owner');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM organizations o JOIN organization_members m ON m."organizationId"=o.id
    WHERE o.id='timestamp-probe' AND o."createdAt"=m."createdAt"
  ) THEN RAISE EXCEPTION 'creator birth timestamps differ'; END IF;
END $$;
ROLLBACK;
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
printf '%s\n' 'PASS: PostgreSQL fresh and upgraded first-index projection, repeat update, retained grants and deny checks, cash safeguards, unknown activation, collision refusal and scaled UTC funnel'

# Signup-method cases contain synthetic identifiers and bounded categories only.
psql_fixture <<'SQL'
CREATE TABLE signup_cases (
  id text PRIMARY KEY, recorded text, provider text, offset_seconds int,
  expected_method text, expected_evidence text, expected_inferred text
);
INSERT INTO signup_cases VALUES
 ('recorded-disagrees','google','github',5,'google','recorded','github'),
 ('recorded-no-account','magic_link',NULL,NULL,'magic_link','recorded','magic_link_or_unknown'),
 ('recorded-password','password','google',5,'password','recorded','google'),
 ('recorded-github','github','credential',5,'github','recorded','password'),
 ('recorded-microsoft','microsoft','github',5,'microsoft','recorded','github'),
 ('invalid-recorded','unlisted','microsoft',5,'microsoft','inferred','microsoft'),
 ('five',NULL,'github',5,'github','inferred','github'),
 ('zero',NULL,'microsoft',0,'microsoft','inferred','microsoft'),
 ('sixty',NULL,'google',60,'google','inferred','google'),
 ('late',NULL,'github',120,'magic_link_or_unknown','no_login_method','magic_link_or_unknown'),
 ('negative',NULL,'github',-1,'magic_link_or_unknown','no_login_method','magic_link_or_unknown'),
 ('credential',NULL,'credential',5,'password','inferred','password'),
 ('ambiguous',NULL,'github',5,'magic_link_or_unknown','no_login_method','unknown'),
 ('recorded-ambiguous','google','github',5,'google','recorded','unknown'),
 ('same-provider',NULL,'google',5,'google','inferred','google'),
 ('no-account',NULL,NULL,NULL,'magic_link_or_unknown','no_login_method','magic_link_or_unknown'),
 ('earliest-outside',NULL,'github',-1,'magic_link_or_unknown','no_login_method','magic_link_or_unknown'),
 ('earliest-unlisted',NULL,'unlisted',1,'magic_link_or_unknown','no_login_method','magic_link_or_unknown'),
 ('soft-owner',NULL,'github',5,'github','inferred','github'),
 ('two-owners','google','github',5,'unknown','no_creator','unknown'),
 ('owner-late','google','github',5,'unknown','no_creator','unknown'),
 ('owner-before','google','github',5,'unknown','no_creator','unknown'),
 ('community','google','github',5,'unknown','no_creator','unknown'),
 ('seed','google','github',5,'unknown','no_creator','unknown'),
 ('other-source','google','github',5,'unknown','no_creator','unknown'),
 ('no-owner','google','github',5,'unknown','no_creator','unknown');
INSERT INTO users
SELECT 'signup-'||id, timestamp '2026-09-01', recorded FROM signup_cases;
INSERT INTO organizations (id,"createdAt","creationSource")
SELECT 'signup-'||id, timestamp '2026-09-02',
  CASE id WHEN 'community' THEN 'community_bot' WHEN 'seed' THEN 'demo_seed'
    WHEN 'other-source' THEN 'unlisted' WHEN 'five' THEN 'auto_default'
    WHEN 'zero' THEN 'user_created' END
FROM signup_cases;
INSERT INTO organization_members
SELECT 'signup-'||id, 'signup-'||id, 'signup-'||id, 'owner',
  timestamp '2026-09-02' + CASE id WHEN 'owner-late' THEN interval '6 seconds'
    WHEN 'owner-before' THEN interval '-1 second' ELSE interval '0' END,
  CASE WHEN id='soft-owner' THEN timestamp '2026-09-03' END
FROM signup_cases WHERE id <> 'no-owner';
INSERT INTO organization_members VALUES
 ('signup-second-owner','signup-two-owners','signup-five','owner','2026-09-02',NULL);
INSERT INTO accounts
SELECT 'signup-'||id, 'signup-'||id, provider,
  timestamp '2026-09-01' + offset_seconds * interval '1 second'
FROM signup_cases WHERE provider IS NOT NULL;
INSERT INTO accounts VALUES
 ('signup-tie','signup-ambiguous','google','2026-09-01 00:00:05'),
 ('signup-recorded-tie','signup-recorded-ambiguous','google','2026-09-01 00:00:05'),
 ('signup-same','signup-same-provider','google','2026-09-01 00:00:05'),
 ('signup-outside-later','signup-earliest-outside','google','2026-09-01 00:00:05'),
 ('signup-unlisted-later','signup-earliest-unlisted','google','2026-09-01 00:00:05');
CREATE TABLE signup_fresh AS
SELECT pg_get_viewdef(c.oid) AS definition, c.relowner, c.relacl, c.reloptions,
  (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
FROM pg_class c WHERE c.oid='octopus_analytics.organization_signup_method_v1'::regclass;
SQL
check_signup() {
  psql_fixture <<'SQL'
SET ROLE octopus_analytics_reader;
DO $$ BEGIN
  IF EXISTS (
    SELECT FROM public.signup_cases c
    LEFT JOIN octopus_analytics.organization_signup_method_v1 v ON v.organization_id='octopus:org:signup-'||c.id
    WHERE v.signup_method IS DISTINCT FROM c.expected_method
      OR v.signup_method_evidence IS DISTINCT FROM c.expected_evidence
      OR v.signup_method_inferred IS DISTINCT FROM c.expected_inferred
  ) THEN RAISE EXCEPTION 'signup value rules'; END IF;
  IF EXISTS (
    SELECT FROM octopus_analytics.organization_signup_method_v1
    WHERE signup_method IS NULL OR signup_method NOT IN
      ('github','google','microsoft','magic_link','password','magic_link_or_unknown','unknown')
      OR signup_method_evidence IS NULL OR signup_method_evidence NOT IN
      ('recorded','inferred','no_login_method','no_creator')
      OR signup_method_inferred IS NULL OR signup_method_inferred NOT IN
      ('github','google','microsoft','password','magic_link_or_unknown','unknown')
  ) THEN RAISE EXCEPTION 'signup allowlist'; END IF;
  IF (SELECT array_agg(column_name::text ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema='octopus_analytics'
        AND table_name='organization_signup_method_v1') IS DISTINCT FROM
    ARRAY['organization_id','signup_method','signup_method_evidence','signup_method_inferred']
    THEN RAISE EXCEPTION 'signup column contract'; END IF;
  BEGIN PERFORM id FROM public.users; RAISE EXCEPTION 'users readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM "providerId" FROM public.accounts; RAISE EXCEPTION 'accounts readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM "userId" FROM public.organization_members; RAISE EXCEPTION 'members readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM id FROM public.organizations; RAISE EXCEPTION 'organizations readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM octopus_analytics.organization_signup_method_v1) <> (SELECT count(*) FROM organizations)
    OR (SELECT count(DISTINCT organization_id) FROM octopus_analytics.organization_signup_method_v1) <> (SELECT count(*) FROM organizations)
    THEN RAISE EXCEPTION 'signup cardinality'; END IF;
END $$;
SQL
}
# Expected results are synthetic test data, never production grants or rows.
psql_fixture -c 'GRANT SELECT ON signup_cases TO octopus_analytics_reader'
check_signup
psql_fixture <<'SQL'
SELECT signup_method_evidence, count(*) AS synthetic_cases,
  round(100.0*count(*)/sum(count(*)) OVER (),2) AS percent
FROM octopus_analytics.organization_signup_method_v1
WHERE organization_id LIKE 'octopus:org:signup-%'
GROUP BY signup_method_evidence ORDER BY signup_method_evidence;
-- Simulate the pre-feature installation.
DROP VIEW octopus_analytics.organization_signup_method_v1;
SQL
for prerequisite in schema role view; do
  # Transaction-local renames leave every installed object intact on failure.
  case "$prerequisite" in
    schema) setup='ALTER SCHEMA octopus_analytics RENAME TO signup_saved_schema;' ;;
    role) setup='ALTER ROLE octopus_analytics_reader RENAME TO signup_saved_role;' ;;
    view) setup='ALTER VIEW octopus_analytics.organizations_v1 RENAME TO signup_saved_view;' ;;
  esac
  if output=$({ printf 'BEGIN;\n%s\n' "$setup"; cat update-organization-signup-method.sql; } | psql_fixture 2>&1); then
    echo 'Signup update unexpectedly accepted a missing prerequisite' >&2; exit 1
  fi
  case "$prerequisite" in
    schema) [[ "$output" == *'Analytics schema missing;'* ]] ;;
    role) [[ "$output" == *'Analytics reader role missing;'* ]] ;;
    view) [[ "$output" == *'Analytics organizations_v1 view missing;'* ]] ;;
  esac
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF to_regclass('octopus_analytics.organization_signup_method_v1') IS NOT NULL
    OR to_regclass('octopus_analytics.organizations_v1') IS NULL
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='octopus_analytics_reader')
  THEN RAISE EXCEPTION 'failed signup update changed installed objects'; END IF;
END $$;
SQL
done
for iteration in 1 2; do
  if [[ "$iteration" == 2 ]]; then
    psql_fixture -c "CREATE TABLE signup_previous AS SELECT oid,relowner,relacl,reloptions FROM pg_class WHERE oid='octopus_analytics.organization_signup_method_v1'::regclass"
    # An explicit PUBLIC grant is removed by the repeat update.
    psql_fixture -c 'GRANT SELECT ON octopus_analytics.organization_signup_method_v1 TO PUBLIC'
  fi
  psql_fixture < update-organization-signup-method.sql
  psql_fixture <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class c CROSS JOIN signup_fresh f
    WHERE c.oid='octopus_analytics.organization_signup_method_v1'::regclass
      AND c.relowner=f.relowner AND c.relacl IS NOT DISTINCT FROM f.relacl
      AND c.reloptions IS NOT DISTINCT FROM f.reloptions
      AND 'security_barrier=true'=ANY(c.reloptions)
      AND pg_get_viewdef(c.oid)=f.definition
      AND (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)=f.columns
      AND NOT EXISTS (SELECT FROM aclexplode(c.relacl) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION 'signup fresh/update definition, owner, grants or barrier'; END IF;
END $$;
SQL
  if [[ "$iteration" == 2 ]]; then
    psql_fixture <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class c CROSS JOIN signup_previous p
    WHERE c.oid='octopus_analytics.organization_signup_method_v1'::regclass
      AND c.oid=p.oid AND c.relowner=p.relowner
      AND c.relacl IS NOT DISTINCT FROM p.relacl
      AND c.reloptions IS NOT DISTINCT FROM p.reloptions
  ) THEN RAISE EXCEPTION 'repeat signup update lost identity or grants'; END IF;
END $$;
DROP TABLE signup_previous;
SQL
  fi
  check_signup
done
psql_fixture <<'SQL'
REVOKE SELECT ON signup_cases FROM octopus_analytics_reader;
-- Reuse the funnel's ten thousand synthetic organisations with four cohorts.
INSERT INTO users
SELECT 'scale-user-'||i, timestamp '2026-09-01', CASE WHEN i%4=0 THEN 'github' END
FROM generate_series(1,10000) i;
INSERT INTO organization_members
SELECT 'scale-member-'||i, 'scale-'||i, 'scale-user-'||i, 'owner', '2026-09-14', NULL
FROM generate_series(1,10000) i WHERE i%4<>3;
INSERT INTO accounts
SELECT 'scale-account-'||i||'-'||j, 'scale-user-'||i,
  CASE WHEN j=1 THEN 'google' ELSE 'github' END,
  timestamp '2026-09-01' + j*interval '5 seconds'
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,3) j WHERE i%4 IN (0,1);
ANALYZE;
SET ROLE octopus_analytics_reader;
SELECT signup_method_evidence, count(*) AS synthetic_organizations,
  round(100.0*count(*)/sum(count(*)) OVER (),2) AS percent
FROM octopus_analytics.organization_signup_method_v1
WHERE organization_id LIKE 'octopus:org:scale-%'
GROUP BY signup_method_evidence ORDER BY signup_method_evidence;
RESET ROLE;
SQL
signup_plan=$(psql_fixture -qAt -c 'SET ROLE octopus_analytics_reader' -c 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM octopus_analytics.organization_signup_method_v1')
ANALYTICS_TEST_PLAN="$signup_plan" python3 - <<'PYTEST'
import json, os
p = json.loads(os.environ['ANALYTICS_TEST_PLAN'])[0]
def visit(n, depth=0):
    if n.get('Relation Name') in ('accounts','organization_members'):
        assert n['Actual Loops'] == 1, 'repeated source scan'
    if n.get('Parent Relationship') == 'SubPlan':
        assert n['Actual Loops'] <= 1, 'per-organisation subplan'
    print('  '*depth + f"{n['Node Type']} {n.get('Relation Name', '')}: rows={n['Actual Rows']}, loops={n['Actual Loops']}")
    for child in n.get('Plans', []): visit(child, depth+1)
visit(p['Plan'])
print(f"PASS: synthetic signup plan, execution {p['Execution Time']} ms")
PYTEST
psql_fixture <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM octopus_analytics.organization_signup_method_v1) <> (SELECT count(*) FROM organizations)
    THEN RAISE EXCEPTION 'scaled signup cardinality'; END IF;
  IF EXISTS (
    SELECT FROM octopus_analytics.organization_signup_method_v1
    WHERE organization_id LIKE 'octopus:org:scale-%'
    GROUP BY signup_method_evidence HAVING count(*)<>2500
  ) THEN RAISE EXCEPTION 'scaled signup cohorts'; END IF;
END $$;
DROP TABLE signup_fresh, signup_cases;
SQL
printf '%s\n' 'PASS: signup rules, privacy allowlists, source denials, missing prerequisites, fresh/update parity, repeated update and scaled plan'
