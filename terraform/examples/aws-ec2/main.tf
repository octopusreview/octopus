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

  # GitHub App (required for PR reviews) — see README Step 2
  github_app_id        = "123456"
  github_app_slug      = "your-app-slug"
  github_app_client_id = "your-github-app-client-id"
  github_client_id     = "your-github-oauth-client-id"

  admin_emails = "you@example.com"
}

output "public_ip" {
  value = module.octopus.public_ip
}

output "app_url" {
  value = module.octopus.app_url
}
