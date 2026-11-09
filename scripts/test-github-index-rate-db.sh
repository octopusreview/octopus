#!/usr/bin/env bash
set -euo pipefail

task_container="octopus-index-rate-test-$(openssl rand -hex 12)"
export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 24)
started=false
cleanup() {
  if [[ "$started" == true ]]; then
    docker stop --time 3 "$task_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker run --rm -d --name "$task_container" -e POSTGRES_PASSWORD -e POSTGRES_DB=octopus_index_rate_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
started=true
ready=false
for _ in $(seq 1 60); do
  if docker exec "$task_container" pg_isready -h 127.0.0.1 -U postgres -d octopus_index_rate_test >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable PostgreSQL did not become ready" >&2
  exit 1
fi

binding=$(docker port "$task_container" 5432/tcp)
if [[ ! "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
  echo "Disposable PostgreSQL is not bound to loopback" >&2
  exit 1
fi
port=${BASH_REMATCH[1]}

# Exercise the actual migration independently; db push alone skips SQL-only constraints.
docker exec "$task_container" psql -v ON_ERROR_STOP=1 -U postgres -d octopus_index_rate_test -c 'CREATE DATABASE octopus_index_migration_test' >/dev/null
docker exec "$task_container" psql -v ON_ERROR_STOP=1 -U postgres -d octopus_index_migration_test -c 'CREATE TABLE "organizations" ("id" TEXT PRIMARY KEY, "githubInstallationId" INTEGER, "deletedAt" TIMESTAMP(3), "bannedAt" TIMESTAMP(3), "autoDiscoverRepos" BOOLEAN NOT NULL DEFAULT true)' >/dev/null
docker exec "$task_container" psql -v ON_ERROR_STOP=1 -U postgres -d octopus_index_migration_test -c 'CREATE TABLE "repositories" ("id" TEXT PRIMARY KEY, "organizationId" TEXT, "fullName" TEXT, "defaultBranch" TEXT, "provider" TEXT, "installationId" INTEGER, "isActive" BOOLEAN NOT NULL DEFAULT true, "dismissedAt" TIMESTAMP(3), "indexStatus" TEXT NOT NULL, "indexAttemptId" TEXT, "totalFiles" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)' >/dev/null
docker exec -i "$task_container" psql -v ON_ERROR_STOP=1 -U postgres -d octopus_index_migration_test \
  < packages/db/prisma/migrations/20261109010000_github_index_rate_secret/migration.sql >/dev/null

export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:$port/octopus_index_migration_test"
bun run db:generate
cd apps/web
RUN_INDEX_RATE_DB_TESTS=1 bun test \
  lib/__tests__/github-index-rate-scope.db.test.ts \
  lib/__tests__/github-index-secret-rekey.db.test.ts \
  lib/__tests__/github-index-rate-state.db.test.ts \
  lib/__tests__/github-index-fetch.db.test.ts \
  lib/__tests__/github-index-app-token.db.test.ts \
  lib/__tests__/github-index-rate-integration.db.test.ts \
  lib/__tests__/github-deferred-index.db.test.ts \
  lib/__tests__/github-deferred-dispatch.db.test.ts \
  lib/__tests__/github-deferred-worker.db.test.ts
cd ../..
export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:$port/octopus_index_rate_test"
(cd packages/db && bunx prisma db push)
cd apps/web
RUN_FIRST_INDEX_DB_TESTS=1 bun test lib/__tests__/repository-index-completion.test.ts
