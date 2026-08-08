#!/bin/bash
set -euo pipefail
umask 077

mkdir -p /run/octopus /opt/octopus /usr/local/lib/octopus
exec 9>/run/octopus-runtime-install.lock
flock -x 9

if [ "$${OCTOPUS_BOOTSTRAP:-0}" != "1" ]; then
  touch /run/octopus/reconcile-required
fi

install_base64_file() {
  local encoded_value=$1
  local destination=$2
  local mode=$3
  local temporary_file
  temporary_file=$(mktemp "$(dirname "$destination")/.octopus-install.XXXXXX")
  printf '%s' "$encoded_value" | base64 --decode > "$temporary_file"
  chmod "$mode" "$temporary_file"
  mv -f "$temporary_file" "$destination"
}

install_base64_file '${renderer_base64}' /usr/local/lib/octopus/render_runtime_env.py 0700
install_base64_file '${refresh_script_base64}' /usr/local/sbin/octopus-refresh-secrets 0700
install_base64_file '${docker_compose_base64}' /opt/octopus/docker-compose.yml 0600

%{ if nginx_conf_base64 != "" ~}
install_base64_file '${nginx_conf_base64}' /opt/octopus/nginx.conf 0644
install_base64_file '${proxy_params_base64}' /opt/octopus/proxy_params 0644
%{ endif ~}

cat > /etc/systemd/system/octopus-secrets.service << 'SERVICE_EOF'
[Unit]
Description=Refresh Octopus runtime secrets
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/octopus-refresh-secrets
TimeoutStartSec=600
SERVICE_EOF

cat > /etc/systemd/system/octopus-secrets.timer << 'TIMER_EOF'
[Unit]
Description=Periodically refresh Octopus runtime secrets

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Persistent=true
Unit=octopus-secrets.service

[Install]
WantedBy=timers.target
TIMER_EOF

cat > /etc/systemd/system/octopus.service << 'SERVICE_EOF'
[Unit]
Description=Octopus AI Code Review
After=docker.service network-online.target octopus-secrets.service
Requires=docker.service octopus-secrets.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/octopus
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable octopus
# Start the retry path before the immediate refresh. If that refresh fails,
# systemd will retry with the durable reconciliation stamp on the next tick.
systemctl enable --now octopus-secrets.timer
if [ "$${OCTOPUS_BOOTSTRAP:-0}" = "1" ]; then
  OCTOPUS_BOOTSTRAP=1 /usr/local/sbin/octopus-refresh-secrets
else
  OCTOPUS_FORCE_RECREATE=1 /usr/local/sbin/octopus-refresh-secrets
fi

echo "Octopus runtime secret delivery installed"
