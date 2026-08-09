# Minimal example — copy this directory, fill in the values, and run:
#   terraform init && terraform plan && terraform apply
#
# For production (full control over every option), use terraform/stacks/aws-ec2/ instead.

module "octopus" {
  source = "../../stacks/aws-ec2"

  aws_region = var.aws_region

  # ── Required ──────────────────────────────────────────────────────────────
  app_image                    = "ghcr.io/your-org/octopus:latest" # see README Step 1
  app_domain                   = "octopus.example.com"
  application_secret_arn       = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123"
  runtime_secret_cutover_stage = "enforced"

  # Fresh deployments enforce the managed origin boundary immediately. The
  # ACM ARN must reference a certificate trusted by the edge (public ACM or
  # imported Cloudflare Origin CA for Full strict). Preflight is only for
  # upgrading an existing AWS stack.
  origin_tls_cutover_stage   = "enforced"
  origin_tls_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"

  # Operator-maintained Cloudflare example. Verify every range against the
  # authoritative provider list before deploy; Terraform does not fetch it.
  trusted_edge_ipv4_cidrs = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]

  # GitHub App (required for PR reviews) — see README Step 2
  github_app_id        = "123456"
  github_app_slug      = "your-app-slug"
  github_app_client_id = "your-github-app-client-id"
  github_client_id     = "your-github-oauth-client-id"

  admin_emails = "you@example.com"
}

output "public_ip" {
  description = "Diagnostic and pre-enforcement HTTP recovery address; never use as a Full (strict) origin."
  value       = module.octopus.public_ip
}

output "origin_dns_name" {
  description = "Application Load Balancer DNS name for the trusted edge origin."
  value       = module.octopus.origin_dns_name
}

output "origin_hosted_zone_id" {
  description = "Application Load Balancer hosted zone ID for an external alias record."
  value       = module.octopus.origin_hosted_zone_id
}

output "app_url" {
  value = module.octopus.app_url
}
