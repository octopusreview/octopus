# SEC-10 network-trust regression tests.
# Runs entirely against mocked providers — no AWS credentials required:
#   terraform -chdir=terraform/stacks/aws-ec2 init -backend=false
#   terraform -chdir=terraform/stacks/aws-ec2 test
#
# terraform test cannot address resources inside child modules (only their
# outputs), so rule-level assertions run against the rds-postgres,
# elasticache-redis, and ec2-app modules directly with the same inputs the
# stack wires up in main.tf. Stack-level runs cover the root identity SG and
# the ssh_cidr_blocks validation.

mock_provider "aws" {}

override_data {
  target = module.vpc.data.aws_availability_zones.available
  values = {
    names = ["us-east-1a", "us-east-1b", "us-east-1c"]
  }
}

override_data {
  target = module.ec2.data.aws_ami.ubuntu
  values = {
    id = "ami-00000000000000000"
  }
}

override_resource {
  target = module.rds.aws_db_instance.this
  values = {
    address  = "db.internal"
    port     = 5432
    db_name  = "octopus"
    username = "octopus"
    master_user_secret = [{
      kms_key_id    = ""
      secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-ABC123"
      secret_status = "active"
    }]
  }
}

override_resource {
  target = module.ec2.aws_ssm_document.runtime_secrets
  values = {
    default_version = "1"
  }
}

variables {
  app_image                    = "ghcr.io/example/octopus:test"
  app_domain                   = "octopus.example.com"
  application_secret_arn       = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123"
  runtime_secret_cutover_stage = "enforced"
}

# ── Stack: the app identity SG exists and carries no rules of its own ─────────
run "stack_app_data_access_sg_is_identity_only" {
  command = apply

  variables {
    enable_redis = true
  }

  assert {
    condition     = length(aws_security_group.app_data_access.ingress) == 0 && length(aws_security_group.app_data_access.egress) == 0
    error_message = "The app data-access SG must be identity-only: no ingress or egress rules of its own."
  }
}

# ── RDS module, restricted inputs (stack default): identity-only ingress ──────
run "rds_module_restricted_to_identity_sg" {
  command = apply

  module {
    source = "../../modules/aws/rds-postgres"
  }

  variables {
    name_prefix                 = "octopus"
    vpc_id                      = "vpc-00000000000000000"
    subnet_ids                  = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids  = ["sg-appdata0000000001"]
    allowed_cidr_blocks         = []
    manage_master_user_password = true
  }

  override_resource {
    target = aws_db_instance.this
    values = {
      master_user_secret = [{
        kms_key_id    = ""
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-ABC123"
        secret_status = "active"
      }]
    }
  }

  assert {
    condition     = length(aws_security_group.this.ingress) == 1
    error_message = "Restricted RDS must have exactly one ingress rule (the app-identity rule)."
  }

  assert {
    condition = anytrue([
      for r in aws_security_group.this.ingress :
      try(contains(r.security_groups, "sg-appdata0000000001"), false) && r.from_port == 5432
    ])
    error_message = "RDS ingress must reference the app data-access SG on port 5432."
  }

  assert {
    condition = alltrue([
      for r in aws_security_group.this.ingress : r.cidr_blocks == null || length(r.cidr_blocks) == 0
    ])
    error_message = "Restricted RDS must not allow any CIDR-based ingress (no VPC-wide trust)."
  }

  assert {
    condition     = aws_db_instance.this.manage_master_user_password && aws_db_instance.this.password == null
    error_message = "RDS must use a Secrets Manager-managed master password and never receive a plaintext password."
  }
}

# ── RDS preflight: retain legacy access and leave password management alone ───
run "rds_module_preflight_keeps_cidr_and_password_unmanaged" {
  command = apply

  module {
    source = "../../modules/aws/rds-postgres"
  }

  variables {
    name_prefix                 = "octopus"
    vpc_id                      = "vpc-00000000000000000"
    subnet_ids                  = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids  = ["sg-appdata0000000001"]
    allowed_cidr_blocks         = ["10.0.0.0/16"]
    manage_master_user_password = false
  }

  override_resource {
    target = aws_db_instance.this
    values = {
      master_user_secret = [{
        kms_key_id    = ""
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-ABC123"
        secret_status = "active"
      }]
    }
  }

  assert {
    condition     = length(aws_security_group.this.ingress) == 2
    error_message = "Compat mode must keep the legacy VPC-CIDR rule alongside the new app-identity rule on RDS."
  }

  assert {
    condition = anytrue([
      for r in aws_security_group.this.ingress : try(contains(r.cidr_blocks, "10.0.0.0/16"), false)
    ])
    error_message = "Compat mode must retain VPC-CIDR ingress to RDS so the running app is not interrupted."
  }

  assert {
    condition = anytrue([
      for r in aws_security_group.this.ingress : try(contains(r.security_groups, "sg-appdata0000000001"), false)
    ])
    error_message = "Compat mode must already attach the app-identity ingress to RDS."
  }

  assert {
    condition     = !aws_db_instance.this.manage_master_user_password
    error_message = "Preflight must not switch RDS to a Secrets Manager-managed master password."
  }
}

# ── Redis module, restricted inputs (stack default): identity-only ingress ────
run "redis_module_restricted_to_identity_sg" {
  command = apply

  module {
    source = "../../modules/aws/elasticache-redis"
  }

  variables {
    name_prefix                = "octopus"
    vpc_id                     = "vpc-00000000000000000"
    subnet_ids                 = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids = ["sg-appdata0000000001"]
    allowed_cidr_blocks        = []
  }

  assert {
    condition     = length(aws_security_group.this.ingress) == 1
    error_message = "Restricted Redis must have exactly one ingress rule (the app-identity rule)."
  }

  assert {
    condition = anytrue([
      for r in aws_security_group.this.ingress :
      try(contains(r.security_groups, "sg-appdata0000000001"), false) && r.from_port == 6379
    ])
    error_message = "Redis ingress must reference the app data-access SG on port 6379."
  }

  assert {
    condition = alltrue([
      for r in aws_security_group.this.ingress : r.cidr_blocks == null || length(r.cidr_blocks) == 0
    ])
    error_message = "Restricted Redis must not allow any CIDR-based ingress (no VPC-wide trust)."
  }
}

# ── Redis module, compat inputs: identity SG plus legacy CIDR ─────────────────
run "redis_module_compat_keeps_cidr_and_identity" {
  command = apply

  module {
    source = "../../modules/aws/elasticache-redis"
  }

  variables {
    name_prefix                = "octopus"
    vpc_id                     = "vpc-00000000000000000"
    subnet_ids                 = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids = ["sg-appdata0000000001"]
    allowed_cidr_blocks        = ["10.0.0.0/16"]
  }

  assert {
    condition     = length(aws_security_group.this.ingress) == 2
    error_message = "Compat mode must keep the legacy VPC-CIDR rule alongside the new app-identity rule on Redis."
  }

  assert {
    condition = anytrue([
      for r in aws_security_group.this.ingress : try(contains(r.cidr_blocks, "10.0.0.0/16"), false)
    ])
    error_message = "Compat mode must retain VPC-CIDR ingress to Redis so the running app is not interrupted."
  }
}

# ── EC2 preflight: IAM can read only the pre-provisioned application secret ──
run "ec2_module_preflight_reads_only_application_secret" {
  command = apply

  module {
    source = "../../modules/aws/ec2-app"
  }

  variables {
    name_prefix                   = "octopus"
    vpc_id                        = "vpc-00000000000000000"
    subnet_id                     = "subnet-00000000000000001"
    ami_id                        = "ami-00000000000000000"
    aws_region                    = "us-east-1"
    docker_compose_content        = "services: {}"
    application_secret_arn        = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123"
    database_secret_arn           = ""
    runtime_secret_preflight_only = true
    runtime_environment           = { NEXT_PUBLIC_APP_URL = "https://octopus.example.com" }
    database_config               = { host = "db.internal", port = 5432, database = "octopus" }
    nginx_conf_content            = ""
    proxy_params_content          = ""
    additional_security_group_ids = ["sg-appdata0000000001"]
  }

  override_resource {
    target = aws_ssm_document.runtime_secrets
    values = {
      default_version = "1"
    }
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(aws_iam_role_policy.runtime_secrets.policy).Statement : statement
      if statement.Sid == "ReadRuntimeSecrets"
      ]).Resource) == toset([
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123",
    ])
    error_message = "Preflight IAM must restrict GetSecretValue to the application secret and omit the unavailable RDS secret."
  }
}

# ── EC2 enforced: the instance carries the identity SG and both secret ARNs ───
run "ec2_module_attaches_additional_identity_sg" {
  command = apply

  module {
    source = "../../modules/aws/ec2-app"
  }

  variables {
    name_prefix                   = "octopus"
    vpc_id                        = "vpc-00000000000000000"
    subnet_id                     = "subnet-00000000000000001"
    ami_id                        = "ami-00000000000000000"
    aws_region                    = "us-east-1"
    docker_compose_content        = "services: {}"
    application_secret_arn        = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123"
    database_secret_arn           = "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-ABC123"
    runtime_secret_preflight_only = false
    runtime_secret_kms_key_arns   = ["arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555"]
    runtime_environment           = { NEXT_PUBLIC_APP_URL = "https://octopus.example.com" }
    database_config               = { host = "db.internal", port = 5432, database = "octopus" }
    nginx_conf_content            = ""
    proxy_params_content          = ""
    additional_security_group_ids = ["sg-appdata0000000001"]
  }

  override_resource {
    target = aws_ssm_document.runtime_secrets
    values = {
      default_version = "1"
    }
  }

  assert {
    condition     = contains(aws_instance.this.vpc_security_group_ids, "sg-appdata0000000001")
    error_message = "The EC2 application instance must carry the data-access identity SG."
  }

  assert {
    condition     = contains(aws_instance.this.vpc_security_group_ids, aws_security_group.this.id)
    error_message = "Attaching the identity SG must not displace the app's own security group."
  }

  assert {
    condition     = length(aws_instance.this.user_data_base64) <= 21848
    error_message = "Compressed EC2 user data must stay within AWS's 16 KiB decoded limit."
  }

  assert {
    condition     = length(aws_ssm_document.runtime_secrets.content) <= 65536
    error_message = "The runtime installer must stay within the SSM document size limit."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(aws_iam_role_policy.runtime_secrets.policy).Statement : statement
      if statement.Sid == "ReadRuntimeSecrets"
    ]).Action) == toset(["secretsmanager:GetSecretValue"])
    error_message = "The instance role must only read secret values; it must not list, create, update, or rotate secrets."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(aws_iam_role_policy.runtime_secrets.policy).Statement : statement
      if statement.Sid == "ReadRuntimeSecrets"
      ]).Resource) == toset([
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds!db-ABC123",
    ])
    error_message = "The instance role must restrict GetSecretValue to the exact application and database secret ARNs."
  }

  assert {
    condition = one([
      for statement in jsondecode(aws_iam_role_policy.runtime_secrets.policy).Statement : statement
      if statement.Sid == "DecryptRuntimeSecrets"
    ]).Condition.StringEquals["kms:ViaService"] == "secretsmanager.us-east-1.amazonaws.com"
    error_message = "Customer-managed KMS decrypt permission must be constrained to Secrets Manager in the deployment region."
  }
}

# ── SSH: internet-wide CIDR is rejected at validation time ────────────────────
run "ssh_internet_wide_cidr_rejected" {
  command = plan

  variables {
    key_name        = "ops-keypair"
    ssh_cidr_blocks = ["0.0.0.0/0"]
  }

  expect_failures = [var.ssh_cidr_blocks]
}

# ── SSH: malformed CIDR is rejected at validation time ────────────────────────
run "ssh_malformed_cidr_rejected" {
  command = plan

  variables {
    key_name        = "ops-keypair"
    ssh_cidr_blocks = ["203.0.113.5"]
  }

  expect_failures = [var.ssh_cidr_blocks]
}
