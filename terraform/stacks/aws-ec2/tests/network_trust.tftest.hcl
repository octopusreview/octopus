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
mock_provider "random" {}

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

variables {
  app_image  = "ghcr.io/example/octopus:test"
  app_domain = "octopus.example.com"
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
    name_prefix                = "octopus"
    vpc_id                     = "vpc-00000000000000000"
    subnet_ids                 = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids = ["sg-appdata0000000001"]
    allowed_cidr_blocks        = []
    db_password                = "mock-password-123456"
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
}

# ── RDS module, compat inputs (stage-1 cutover): identity SG plus legacy CIDR ─
run "rds_module_compat_keeps_cidr_and_identity" {
  command = apply

  module {
    source = "../../modules/aws/rds-postgres"
  }

  variables {
    name_prefix                = "octopus"
    vpc_id                     = "vpc-00000000000000000"
    subnet_ids                 = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_ids = ["sg-appdata0000000001"]
    allowed_cidr_blocks        = ["10.0.0.0/16"]
    db_password                = "mock-password-123456"
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

# ── EC2 module: the instance carries the extra identity SG ────────────────────
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
    app_domain                    = "octopus.example.com"
    docker_compose_content        = "services: {}"
    env_content                   = ""
    nginx_conf_content            = ""
    proxy_params_content          = ""
    additional_security_group_ids = ["sg-appdata0000000001"]
  }

  assert {
    condition     = contains(aws_instance.this.vpc_security_group_ids, "sg-appdata0000000001")
    error_message = "The EC2 application instance must carry the data-access identity SG."
  }

  assert {
    condition     = contains(aws_instance.this.vpc_security_group_ids, aws_security_group.this.id)
    error_message = "Attaching the identity SG must not displace the app's own security group."
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
