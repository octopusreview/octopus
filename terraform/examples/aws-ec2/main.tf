# Minimal example — copy this directory, fill in the values, and run:
#   terraform init && terraform plan && terraform apply
#
# For production (more control over every option), use terraform/stacks/aws-ec2/ instead.

module "octopus" {
  source = "../../stacks/aws-ec2"

  aws_region = var.aws_region

  # ── Required ──────────────────────────────────────────────────────────────
  app_image          = "ghcr.io/your-org/octopus:latest" # see README step 1
  app_domain         = "octopus.example.com"
  db_password        = "change-me-strong-password"
  better_auth_secret = "change-me-32-char-minimum-secret"

  # GitHub App (required for PR reviews)
  github_app_id          = "123456"
  github_app_private_key = "-----BEGIN RSA PRIVATE KEY-----\n..."
  github_webhook_secret  = "change-me"
  github_app_slug        = "your-app-slug"
  github_client_id       = "your-github-oauth-client-id"
  github_client_secret   = "your-github-oauth-client-secret"

  # LLM (at least one required)
  openai_api_key    = "sk-..."
  anthropic_api_key = "sk-ant-..."
}

output "public_ip" {
  value = module.octopus.public_ip
}

output "app_url" {
  value = module.octopus.app_url
}
