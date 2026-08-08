#!/bin/bash
set -euo pipefail
umask 077

AWS_REGION=$(printf '%s' '${aws_region_base64}' | base64 --decode)
APPLICATION_SECRET_ARN=$(printf '%s' '${application_secret_arn_base64}' | base64 --decode)
export AWS_PAGER=""

for command_name in aws base64 docker dpkg python3; do
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

fetch_application_secret() {
  local attempt=1

  while [ "$attempt" -le 6 ]; do
    if aws secretsmanager get-secret-value \
      --region "$AWS_REGION" \
      --secret-id "$APPLICATION_SECRET_ARN" \
      --query SecretString \
      --output text \
      > "$TEMP_DIRECTORY/application.json" 2> "$TEMP_DIRECTORY/aws-error" && \
      [ -s "$TEMP_DIRECTORY/application.json" ]; then
      return 0
    fi
    : > "$TEMP_DIRECTORY/application.json"
    sleep "$((attempt * 2))"
    attempt=$((attempt + 1))
  done

  echo "Octopus runtime secret preflight failed: application secret is unavailable" >&2
  cat "$TEMP_DIRECTORY/aws-error" >&2 || true
  return 1
}

printf '%s' '${renderer_base64}' | base64 --decode > "$TEMP_DIRECTORY/render_runtime_env.py"
chmod 0700 "$TEMP_DIRECTORY/render_runtime_env.py"
fetch_application_secret
/usr/bin/python3 "$TEMP_DIRECTORY/render_runtime_env.py" \
  --validate-application-secret-only "$TEMP_DIRECTORY/application.json"
printf '%s' '${docker_compose_base64}' | base64 --decode > "$TEMP_DIRECTORY/docker-compose.yml"
: > "$TEMP_DIRECTORY/runtime.env"
OCTOPUS_RUNTIME_ENV_PATH="$TEMP_DIRECTORY/runtime.env" \
  docker compose -f "$TEMP_DIRECTORY/docker-compose.yml" config --quiet

echo "Octopus runtime secret preflight passed"
