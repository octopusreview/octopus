#!/bin/bash
set -euo pipefail
umask 077

AWS_REGION=$(printf '%s' '${aws_region_base64}' | base64 --decode)
APPLICATION_SECRET_ARN=$(printf '%s' '${application_secret_arn_base64}' | base64 --decode)
REDIS_SECRET_ARN=$(printf '%s' '${redis_secret_arn_base64}' | base64 --decode)
export AWS_PAGER=""

for command_name in aws base64 docker dpkg gzip python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Octopus runtime secret preflight failed: required command is unavailable" >&2
    exit 1
  fi
done

compose_version=$(docker compose version --short 2>/dev/null || true)
compose_version=$${compose_version#v}
if [ -z "$compose_version" ] || ! dpkg --compare-versions "$compose_version" ge 2.30.0; then
  echo "Octopus runtime secret preflight failed: Docker Compose 2.30.0 or newer is required" >&2
  exit 1
fi

TEMP_DIRECTORY=$(mktemp -d /run/octopus-secret-preflight.XXXXXX)
cleanup() {
  rm -rf -- "$TEMP_DIRECTORY"
}
trap cleanup EXIT

fetch_secret() {
  local secret_arn=$1
  local destination=$2
  local label=$3
  local attempt=1

  while [ "$attempt" -le 6 ]; do
    if aws secretsmanager get-secret-value \
      --region "$AWS_REGION" \
      --secret-id "$secret_arn" \
      --query SecretString \
      --output text \
      > "$destination" 2> "$TEMP_DIRECTORY/aws-error" && \
      [ -s "$destination" ]; then
      return 0
    fi
    : > "$destination"
    sleep "$((attempt * 2))"
    attempt=$((attempt + 1))
  done

  echo "Octopus runtime secret preflight failed: $label secret is unavailable" >&2
  cat "$TEMP_DIRECTORY/aws-error" >&2 || true
  return 1
}

printf '%s' '${renderer_base64}' | base64 --decode | gzip -d > "$TEMP_DIRECTORY/render_runtime_env.py"
chmod 0700 "$TEMP_DIRECTORY/render_runtime_env.py"
fetch_secret "$APPLICATION_SECRET_ARN" "$TEMP_DIRECTORY/application.json" application
/usr/bin/python3 "$TEMP_DIRECTORY/render_runtime_env.py" \
  --validate-application-secret-only "$TEMP_DIRECTORY/application.json"
if [ -n "$REDIS_SECRET_ARN" ]; then
  fetch_secret "$REDIS_SECRET_ARN" "$TEMP_DIRECTORY/redis.json" Redis
  /usr/bin/python3 "$TEMP_DIRECTORY/render_runtime_env.py" \
    --validate-redis-secret-only "$TEMP_DIRECTORY/redis.json"
fi
printf '%s' '${docker_compose_base64}' | base64 --decode | gzip -d > "$TEMP_DIRECTORY/docker-compose.yml"
: > "$TEMP_DIRECTORY/runtime.env"
OCTOPUS_RUNTIME_ENV_PATH="$TEMP_DIRECTORY/runtime.env" \
  docker compose -f "$TEMP_DIRECTORY/docker-compose.yml" config --quiet

echo "Octopus runtime secret preflight passed"
