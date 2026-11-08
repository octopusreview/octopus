#!/usr/bin/env bash
set -euo pipefail

name="octopus-community-persist-test-$(openssl rand -hex 12)"
export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 24)
started=false
cleanup() {
  if [[ "$started" == true ]]; then
    docker stop --time 3 "$name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker run --rm -d --name "$name" -e POSTGRES_PASSWORD -e POSTGRES_DB=octopus_community_persist_test \
  -p 127.0.0.1::5432 postgres:16 >/dev/null
started=true
ready=false
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d octopus_community_persist_test >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable PostgreSQL did not become ready" >&2
  exit 1
fi

binding=$(docker port "$name" 5432/tcp)
if [[ ! "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
  echo "Disposable PostgreSQL is not bound to loopback" >&2
  exit 1
fi
port=${BASH_REMATCH[1]}
export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:$port/octopus_community_persist_test"
bun run db:generate
(cd packages/db && bunx prisma db push)
cd apps/web
RUN_COMMUNITY_PERSIST_DB_TESTS=1 bun test lib/__tests__/community-persist-tenant.db.test.ts
