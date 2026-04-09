#!/bin/bash
set -euo pipefail

# ── System update ────────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git unzip awscli

# ── Docker ───────────────────────────────────────────────────────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker
systemctl start docker

# ── App directory ─────────────────────────────────────────────────────────────
mkdir -p /opt/octopus
cd /opt/octopus

# Write docker-compose.yml
cat > docker-compose.yml << 'COMPOSE_EOF'
${docker_compose_content}
COMPOSE_EOF

# Write .env
cat > .env << 'ENV_EOF'
${env_content}
ENV_EOF
chmod 600 .env

%{ if nginx_conf_content != "" ~}
# Write nginx.conf
cat > nginx.conf << 'NGINX_EOF'
${nginx_conf_content}
NGINX_EOF

# Write proxy_params
cat > proxy_params << 'PROXY_EOF'
${proxy_params_content}
PROXY_EOF
%{ endif ~}

# ── Registry authentication ───────────────────────────────────────────────────
%{ if ecr_registry_url != "" ~}
# Authenticate to AWS ECR using the attached IAM role (IMDSv2)
AWS_REGION=$(curl -sf \
  -H "X-aws-ec2-metadata-token: $(curl -sf -X PUT \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
    http://169.254.169.254/latest/api/token)" \
  http://169.254.169.254/latest/meta-data/placement/region)
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ecr_registry_url}"
%{ endif ~}

# ── Pull & start ──────────────────────────────────────────────────────────────
docker compose pull
docker compose up -d

# ── systemd service to keep it running across reboots ────────────────────────
cat > /etc/systemd/system/octopus.service << 'SERVICE_EOF'
[Unit]
Description=Octopus AI Code Review
After=docker.service
Requires=docker.service

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
