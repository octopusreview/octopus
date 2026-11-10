#!/usr/bin/env bash
set -euo pipefail

task_container="octopus-qdrant-e2e-$(openssl rand -hex 10)"
started=false
cleanup() {
  if [[ "$started" == true ]]; then
    docker stop --time 3 "$task_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
unset QDRANT_API_KEY HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"

docker run --rm -d --name "$task_container" --label octopus.synthetic-index-test=true \
  -p 127.0.0.1::6333 qdrant/qdrant@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc >/dev/null
started=true
binding=$(docker port "$task_container" 6333/tcp)
if [[ ! "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
  echo "Disposable Qdrant is not bound to loopback" >&2
  exit 1
fi
export QDRANT_URL="http://$binding" OCTOPUS_QDRANT_TEST_CONTAINER="$task_container" RUN_INDEX_RATE_QDRANT_TESTS=1
ready=false
for _ in $(seq 1 40); do
  if curl --silent --fail --max-time 1 "$QDRANT_URL/readyz" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable Qdrant did not become ready" >&2
  exit 1
fi
bash scripts/test-github-index-rate-db.sh
