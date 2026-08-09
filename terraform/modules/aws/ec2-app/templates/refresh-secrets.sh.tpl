#!/bin/bash
set -euo pipefail
umask 077

AWS_REGION=$(printf '%s' '${aws_region_base64}' | base64 --decode)
APPLICATION_SECRET_ARN=$(printf '%s' '${application_secret_arn_base64}' | base64 --decode)
DATABASE_SECRET_ARN=$(printf '%s' '${database_secret_arn_base64}' | base64 --decode)
REDIS_SECRET_ARN=$(printf '%s' '${redis_secret_arn_base64}' | base64 --decode)
PUBLIC_ENVIRONMENT_BASE64='${public_environment_base64}'
DATABASE_CONFIG_BASE64='${database_config_base64}'
REDIS_CONFIG_BASE64='${redis_config_base64}'
REDIS_PROBE_BASE64='${redis_probe_base64}'
REDIS_AUTH_ENFORCED='${redis_auth_enforced}'
RUNTIME_DIRECTORY=/run/octopus
RUNTIME_ENV=$RUNTIME_DIRECTORY/runtime.env
RECONCILE_STAMP=$RUNTIME_DIRECTORY/reconcile-required
APP_DIRECTORY=/opt/octopus
export AWS_PAGER=""

mkdir -p "$RUNTIME_DIRECTORY"
exec 9>"$RUNTIME_DIRECTORY/secret-refresh.lock"
flock -x 9

TEMP_DIRECTORY=$(mktemp -d "$RUNTIME_DIRECTORY/.secret-refresh.XXXXXX")
cleanup() {
  rm -rf -- "$TEMP_DIRECTORY"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1; then
  echo "Octopus runtime secret refresh failed: Docker and dpkg are required" >&2
  exit 1
fi

compose_version=$(docker compose version --short 2>/dev/null || true)
compose_version=$${compose_version#v}
if [ -z "$compose_version" ] || ! dpkg --compare-versions "$compose_version" ge 2.30.0; then
  echo "Octopus runtime secret refresh failed: Docker Compose 2.30.0 or newer is required" >&2
  exit 1
fi

fetch_secret() {
  local secret_arn=$1
  local destination=$2
  local attempt=1

  while [ "$attempt" -le 6 ]; do
    if aws secretsmanager get-secret-value \
      --region "$AWS_REGION" \
      --secret-id "$secret_arn" \
      --query SecretString \
      --output text \
      > "$destination" 2> "$TEMP_DIRECTORY/aws-error" && [ -s "$destination" ]; then
      return 0
    fi
    : > "$destination"
    sleep "$((attempt * 2))"
    attempt=$((attempt + 1))
  done

  echo "Octopus runtime secret retrieval failed" >&2
  cat "$TEMP_DIRECTORY/aws-error" >&2 || true
  return 1
}

printf '%s' "$PUBLIC_ENVIRONMENT_BASE64" | base64 --decode > "$TEMP_DIRECTORY/public.json"
printf '%s' "$DATABASE_CONFIG_BASE64" | base64 --decode > "$TEMP_DIRECTORY/database-config.json"
printf '%s' "$REDIS_CONFIG_BASE64" | base64 --decode > "$TEMP_DIRECTORY/redis-config.json"
fetch_secret "$APPLICATION_SECRET_ARN" "$TEMP_DIRECTORY/application.json"
fetch_secret "$DATABASE_SECRET_ARN" "$TEMP_DIRECTORY/database.json"
if [ -n "$REDIS_SECRET_ARN" ]; then
  fetch_secret "$REDIS_SECRET_ARN" "$TEMP_DIRECTORY/redis.json"
fi

renderer_args=(
  --public-environment "$TEMP_DIRECTORY/public.json"
  --application-secret "$TEMP_DIRECTORY/application.json"
  --database-secret "$TEMP_DIRECTORY/database.json"
  --database-config "$TEMP_DIRECTORY/database-config.json"
  --redis-config "$TEMP_DIRECTORY/redis-config.json"
  --output "$TEMP_DIRECTORY/runtime.env"
)
if [ -n "$REDIS_SECRET_ARN" ]; then
  renderer_args+=(--redis-secret "$TEMP_DIRECTORY/redis.json")
fi
/usr/bin/python3 /usr/local/lib/octopus/render_runtime_env.py "$${renderer_args[@]}"

had_runtime_env=0
secrets_changed=1
database_changed=1
if [ -f "$RUNTIME_ENV" ]; then
  had_runtime_env=1
  if cmp -s "$TEMP_DIRECTORY/runtime.env" "$RUNTIME_ENV"; then
    echo "Octopus runtime secrets are unchanged"
    secrets_changed=0
  fi
  sed -n '/^DATABASE_URL=/p' "$RUNTIME_ENV" > "$TEMP_DIRECTORY/previous-database-url"
  sed -n '/^DATABASE_URL=/p' "$TEMP_DIRECTORY/runtime.env" > "$TEMP_DIRECTORY/candidate-database-url"
  if cmp -s "$TEMP_DIRECTORY/previous-database-url" "$TEMP_DIRECTORY/candidate-database-url"; then
    database_changed=0
  fi
fi

# Keep a durable retry signal for changed secrets or installer/config updates.
# Bootstrap is completed by user data after ECR authentication and image pull.
if [ "$secrets_changed" -eq 1 ] && [ "$${OCTOPUS_BOOTSTRAP:-0}" != "1" ]; then
  touch "$RECONCILE_STAMP"
fi

# Validate the candidate through Compose before replacing the last-good file.
if ! OCTOPUS_RUNTIME_ENV_PATH="$TEMP_DIRECTORY/runtime.env" \
  docker compose -f "$APP_DIRECTORY/docker-compose.yml" config --quiet; then
  if [ "$database_changed" -eq 1 ]; then
    # The RDS rotation has invalidated the old URL. Keep the current credential
    # available for the timer/operator after the Compose issue is corrected.
    mv -f "$TEMP_DIRECTORY/runtime.env" "$RUNTIME_ENV"
    chmod 0600 "$RUNTIME_ENV"
    echo "Octopus Compose validation failed; the current database environment was retained for retry" >&2
  fi
  exit 1
fi

# The public health route intentionally excludes optional Redis. Before a
# candidate is promoted or a stopped stack is recovered, prove the restricted
# user can execute every command family and pub/sub path Octopus relies on.
redis_probe_required=0
if [ -n "$REDIS_SECRET_ARN" ] && [ "$${OCTOPUS_BOOTSTRAP:-0}" != "1" ]; then
  if [ "$secrets_changed" -eq 1 ] || \
    [ "$${OCTOPUS_FORCE_RECREATE:-0}" = "1" ] || \
    [ -f "$RECONCILE_STAMP" ]; then
    redis_probe_required=1
  elif ! docker compose -f "$APP_DIRECTORY/docker-compose.yml" \
    ps --status running --services 2>/dev/null | grep -qx web; then
    redis_probe_required=1
  fi
fi

if [ "$redis_probe_required" -eq 1 ]; then
  if ! printf '%s' "$REDIS_PROBE_BASE64" | base64 --decode | gzip -d | \
    OCTOPUS_RUNTIME_ENV_PATH="$TEMP_DIRECTORY/runtime.env" \
    docker compose -f "$APP_DIRECTORY/docker-compose.yml" \
      run --rm --no-deps -T \
      -e OCTOPUS_REDIS_PROBE_RUN=1 \
      -e OCTOPUS_REDIS_AUTH_ENFORCED="$REDIS_AUTH_ENFORCED" \
      web node - \
      > "$TEMP_DIRECTORY/redis-probe-output" 2>&1; then
    echo "Octopus authenticated Redis probe failed" >&2
    exit 1
  fi
fi

if [ "$secrets_changed" -eq 1 ]; then
  if [ "$had_runtime_env" -eq 1 ]; then
    cp "$RUNTIME_ENV" "$TEMP_DIRECTORY/previous-runtime.env"
    chmod 0600 "$TEMP_DIRECTORY/previous-runtime.env"
  fi
  mv -f "$TEMP_DIRECTORY/runtime.env" "$RUNTIME_ENV"
  chmod 0600 "$RUNTIME_ENV"
fi

if [ "$${OCTOPUS_BOOTSTRAP:-0}" = "1" ]; then
  rm -f -- "$RECONCILE_STAMP"
  echo "Octopus runtime secrets prepared for bootstrap"
  exit 0
fi

stack_running=0
docker compose -f "$APP_DIRECTORY/docker-compose.yml" config --services \
  | sort > "$TEMP_DIRECTORY/expected-services"
docker compose -f "$APP_DIRECTORY/docker-compose.yml" \
  ps --status running --services 2>/dev/null \
  | sort > "$TEMP_DIRECTORY/running-services"
if [ -s "$TEMP_DIRECTORY/expected-services" ] && \
  cmp -s "$TEMP_DIRECTORY/expected-services" "$TEMP_DIRECTORY/running-services"; then
  stack_running=1
fi

reconcile_required=0
if [ "$secrets_changed" -eq 1 ] || \
  [ "$${OCTOPUS_FORCE_RECREATE:-0}" = "1" ] || \
  [ -f "$RECONCILE_STAMP" ] || \
  [ "$stack_running" -eq 0 ]; then
  reconcile_required=1
fi

if [ "$reconcile_required" -eq 0 ]; then
  exit 0
fi

reconcile_compose() {
  # Converge the complete stack on every retry. Unchanged dependencies are not
  # recreated, while a prior partial start cannot be mistaken for recovery.
  docker compose -f "$APP_DIRECTORY/docker-compose.yml" up -d >/dev/null &&
    docker compose -f "$APP_DIRECTORY/docker-compose.yml" \
      up -d --no-deps --force-recreate --wait --wait-timeout 120 web >/dev/null &&
    docker compose -f "$APP_DIRECTORY/docker-compose.yml" \
      up -d --wait --wait-timeout 180 >/dev/null
}

touch "$RECONCILE_STAMP"
if ! reconcile_compose; then
  restored_previous_environment=0
  if [ "$secrets_changed" -eq 1 ] && \
    [ "$had_runtime_env" -eq 1 ] && \
    [ "$database_changed" -eq 0 ]; then
    mv -f "$TEMP_DIRECTORY/previous-runtime.env" "$RUNTIME_ENV"
    chmod 0600 "$RUNTIME_ENV"
    restored_previous_environment=1
    reconcile_compose >/dev/null 2>&1 || true
  fi
  if [ "$restored_previous_environment" -eq 1 ]; then
    echo "Octopus web reconciliation failed; the previous runtime environment was restored" >&2
  else
    # RDS invalidates the prior password when it rotates. Retaining the new
    # candidate lets the timer retry instead of restoring a known-bad URL.
    echo "Octopus web reconciliation failed; the current database environment was retained for retry" >&2
  fi
  exit 1
fi

rm -f -- "$RECONCILE_STAMP"
if [ "$secrets_changed" -eq 1 ]; then
  echo "Octopus runtime secrets refreshed"
fi
echo "Octopus web service reconciled with runtime secrets"
