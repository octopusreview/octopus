#!/bin/bash
set -euo pipefail

# ── Setup logging ─────────────────────────────────────────────────────────────
# All output (stdout + stderr) is mirrored to /var/log/octopus-setup.log.
# On failure: sudo cat /var/log/octopus-setup.log
exec > >(tee /var/log/octopus-setup.log) 2>&1
echo "=== Octopus setup started at $(date -u) ==="

# ── System update ────────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git gzip unzip awscli python3

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

# ── Runtime configuration ────────────────────────────────────────────────────
# This payload contains only non-secret configuration and secret ARNs. Secret
# values are fetched with the instance role and rendered atomically under /run.
runtime_installer=$(mktemp /tmp/octopus-runtime-install.XXXXXX)
trap 'rm -f "$runtime_installer"' EXIT
printf '%s' '${runtime_installer_base64}' | base64 --decode | gzip -d > "$runtime_installer"
chmod 0700 "$runtime_installer"
OCTOPUS_BOOTSTRAP=1 "$runtime_installer"
rm -f "$runtime_installer"
trap - EXIT

# ── Pull & start ──────────────────────────────────────────────────────────────
cd /opt/octopus
docker compose pull
systemctl enable --now octopus

echo "=== Octopus setup completed at $(date -u) ==="
