# SEC-10 origin-TLS and trusted-edge regression tests.
# Runs entirely against mocked providers — no AWS credentials required:
#   terraform -chdir=terraform/stacks/aws-ec2 init -backend=false
#   terraform -chdir=terraform/stacks/aws-ec2 test
#
# The root-stack runs prove the ALB/ACM/edge boundary. The EC2 module run
# inspects the application security group directly because Terraform tests
# cannot address resources inside a child module from a root-stack run.

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

override_resource {
  target = aws_lb.origin
  values = {
    arn      = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/octopus-origin/50dc6c495c0c9188"
    dns_name = "octopus-origin-123456.us-east-1.elb.amazonaws.com"
    zone_id  = "Z35SXDOTRQ7X7K"
  }
}

override_resource {
  target = aws_lb_target_group.app
  values = {
    arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/octopus-app/6d0ecf831eec9f09"
  }
}

override_resource {
  target = aws_lb_listener.https
  values = {
    arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/octopus-origin/50dc6c495c0c9188/f2f7dc8efc522ab2"
  }
}

variables {
  app_image                    = "ghcr.io/example/octopus:test"
  app_domain                   = "octopus.example.com"
  application_secret_arn       = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/application-ABC123"
  runtime_secret_cutover_stage = "enforced"
  redis_auth_cutover_stage     = "preflight"

  origin_tls_cutover_stage   = "preflight"
  origin_tls_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
  trusted_edge_ipv4_cidrs = [
    "173.245.48.0/20",
    "103.21.244.0/22",
  ]
}

run "preflight_provisions_managed_tls_without_removing_rollback_path" {
  command = apply

  variables {
    origin_tls_cutover_stage = "preflight"
  }

  assert {
    condition = (
      aws_lb.origin.name == local.origin_lb_name &&
      length(aws_lb.origin.name) <= 32 &&
      !aws_lb.origin.internal &&
      aws_lb.origin.load_balancer_type == "application" &&
      toset(aws_lb.origin.subnets) == toset(module.vpc.public_subnet_ids) &&
      contains(aws_lb.origin.security_groups, aws_security_group.origin_edge.id)
    )
    error_message = "Origin TLS must use an internet-facing ALB across both public subnets with only the dedicated edge security group."
  }

  assert {
    condition = (
      length(local.legacy_origin_ingress_rules) == 2 &&
      length(local.ingress_rules) == 3 &&
      one([
        for rule in local.ingress_rules : rule
        if rule.from_port == 80 && contains(rule.cidr_blocks, "0.0.0.0/0")
      ]).to_port == 80 &&
      one([
        for rule in local.ingress_rules : rule
        if rule.from_port == 443 && contains(rule.cidr_blocks, "0.0.0.0/0")
      ]).to_port == 443 &&
      one([
        for rule in local.ingress_rules : rule
        if rule.from_port == 80 && contains(rule.security_groups, aws_security_group.origin_edge.id)
      ]).to_port == 80
    )
    error_message = "Preflight must retain the pre-cutover public HTTP and HTTPS compatibility ingress and add ALB-to-EC2 port 80."
  }

  assert {
    condition = (
      aws_lb.origin.idle_timeout >= 900 &&
      aws_lb.origin.preserve_host_header &&
      aws_lb.origin.drop_invalid_header_fields
    )
    error_message = "The ALB must preserve the Host header, reject invalid headers, and retain long-running reviews with a 900-second-or-longer idle timeout."
  }

  assert {
    condition = (
      aws_lb_listener.https.load_balancer_arn == aws_lb.origin.arn &&
      aws_lb_listener.https.port == 443 &&
      aws_lb_listener.https.protocol == "HTTPS" &&
      aws_lb_listener.https.certificate_arn == var.origin_tls_certificate_arn &&
      aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06" &&
      one(aws_lb_listener.https.default_action).type == "fixed-response" &&
      one(one(aws_lb_listener.https.default_action).fixed_response).status_code == "403" &&
      aws_lb_listener_rule.app_host.listener_arn == aws_lb_listener.https.arn &&
      one(aws_lb_listener_rule.app_host.action).target_group_arn == aws_lb_target_group.app.arn &&
      toset(one(one(aws_lb_listener_rule.app_host.condition).host_header).values) == toset([var.app_domain])
    )
    error_message = "The HTTPS listener must use the exact ACM certificate, reject unknown hosts, and forward only app_domain to the app target group."
  }

  assert {
    condition = (
      length(aws_vpc_security_group_ingress_rule.origin_https) == length(var.trusted_edge_ipv4_cidrs) &&
      alltrue([
        for rule in values(aws_vpc_security_group_ingress_rule.origin_https) :
        rule.security_group_id == aws_security_group.origin_edge.id &&
        rule.ip_protocol == "tcp" &&
        rule.from_port == 443 &&
        rule.to_port == 443 &&
        contains(var.trusted_edge_ipv4_cidrs, rule.cidr_ipv4)
      ])
    )
    error_message = "ALB HTTPS ingress must contain exactly one port-443 rule per trusted edge CIDR and no public catch-all."
  }

  assert {
    condition = (
      aws_vpc_security_group_egress_rule.origin_to_app.security_group_id == aws_security_group.origin_edge.id &&
      aws_vpc_security_group_egress_rule.origin_to_app.ip_protocol == "tcp" &&
      aws_vpc_security_group_egress_rule.origin_to_app.from_port == 80 &&
      aws_vpc_security_group_egress_rule.origin_to_app.to_port == 80 &&
      aws_vpc_security_group_egress_rule.origin_to_app.referenced_security_group_id == module.ec2.security_group_id
    )
    error_message = "The ALB may send only HTTP port 80 to the application security group."
  }

  assert {
    condition = (
      aws_lb_target_group.app.name == local.origin_tg_name &&
      length(aws_lb_target_group.app.name) <= 32 &&
      aws_lb_target_group.app.protocol == "HTTP" &&
      aws_lb_target_group.app.port == 80 &&
      aws_lb_target_group.app.target_type == "instance" &&
      one(aws_lb_target_group.app.health_check).path == "/api/health" &&
      one(aws_lb_target_group.app.health_check).matcher == "200" &&
      one(aws_lb_target_group.app.health_check).timeout >= 4 &&
      one(aws_lb_target_group.app.health_check).unhealthy_threshold >= 2
    )
    error_message = "The ALB target group must health-gate the instance on HTTP /api/health with bounds above the application's two-second DB probe."
  }

  assert {
    condition = (
      aws_lb_target_group_attachment.app.target_group_arn == aws_lb_target_group.app.arn &&
      aws_lb_target_group_attachment.app.target_id == module.ec2.instance_id &&
      aws_lb_target_group_attachment.app.port == 80
    )
    error_message = "The current EC2 instance must be registered on target port 80 without replacement."
  }

  assert {
    condition = (
      output.origin_dns_name == aws_lb.origin.dns_name &&
      output.origin_hosted_zone_id == aws_lb.origin.zone_id
    )
    error_message = "The stack must output the ALB DNS name and hosted-zone ID used for the edge DNS cutover."
  }
}

run "enforced_keeps_the_managed_tls_boundary" {
  command = apply

  variables {
    origin_tls_cutover_stage = "enforced"
  }

  assert {
    condition = (
      aws_lb_listener.https.protocol == "HTTPS" &&
      length(aws_vpc_security_group_ingress_rule.origin_https) == length(var.trusted_edge_ipv4_cidrs) &&
      length(local.legacy_origin_ingress_rules) == 0 &&
      length(local.ingress_rules) == 1 &&
      one(local.ingress_rules).from_port == 80 &&
      one(local.ingress_rules).to_port == 80 &&
      length(one(local.ingress_rules).cidr_blocks) == 0 &&
      contains(one(local.ingress_rules).security_groups, aws_security_group.origin_edge.id) &&
      alltrue([
        for rule in local.ingress_rules :
        !contains(rule.cidr_blocks, "0.0.0.0/0")
      ])
    )
    error_message = "Enforcement must retain trusted-edge HTTPS while removing public EC2 web ingress and leaving only ALB-to-EC2 port 80."
  }
}

run "ec2_module_enforced_origin_is_alb_only" {
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
    redis_auth_cutover_stage      = "preflight"
    runtime_secret_preflight_only = false
    runtime_environment           = { NEXT_PUBLIC_APP_URL = "https://octopus.example.com" }
    database_config               = { host = "db.internal", port = 5432, database = "octopus" }
    nginx_conf_content            = ""
    proxy_params_content          = ""
    ingress_rules = [{
      description     = "HTTP from managed origin load balancer"
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      cidr_blocks     = []
      security_groups = ["sg-origin0000000001"]
    }]
  }

  override_resource {
    target = aws_ssm_document.runtime_secrets
    values = {
      default_version = "1"
    }
  }

  assert {
    condition = (
      length(aws_security_group.this.ingress) == 1 &&
      one(aws_security_group.this.ingress).from_port == 80 &&
      one(aws_security_group.this.ingress).to_port == 80 &&
      contains(one(aws_security_group.this.ingress).security_groups, "sg-origin0000000001") &&
      try(length(one(aws_security_group.this.ingress).cidr_blocks), 0) == 0
    )
    error_message = "Enforced EC2 application ingress must be only ALB-security-group traffic on port 80, with no public CIDR path."
  }
}

run "invalid_cutover_stage_is_rejected" {
  command = plan

  variables {
    origin_tls_cutover_stage = "disabled"
  }

  expect_failures = [var.origin_tls_cutover_stage]
}

run "non_acm_certificate_arn_is_rejected" {
  command = plan

  variables {
    origin_tls_certificate_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:not-a-certificate"
  }

  expect_failures = [var.origin_tls_certificate_arn]
}

run "wrong_region_certificate_arn_is_rejected" {
  command = plan

  variables {
    origin_tls_certificate_arn = "arn:aws:acm:eu-west-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
  }

  expect_failures = [var.origin_tls_certificate_arn]
}

run "legacy_long_prefix_derives_safe_origin_names" {
  command = plan

  variables {
    name_prefix = "octopus-production-eu-west"
  }

  assert {
    condition = (
      startswith(aws_lb.origin.name, "oct-origin-") &&
      startswith(aws_lb_target_group.app.name, "oct-app-") &&
      length(aws_lb.origin.name) <= 32 &&
      length(aws_lb_target_group.app.name) <= 32
    )
    error_message = "Legacy long prefixes must remain plannable while deriving deterministic ALB-safe names."
  }
}

run "internet_wide_edge_cidr_is_rejected" {
  command = plan

  variables {
    trusted_edge_ipv4_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.trusted_edge_ipv4_cidrs]
}

run "malformed_edge_cidr_is_rejected" {
  command = plan

  variables {
    trusted_edge_ipv4_cidrs = ["173.245.48.1"]
  }

  expect_failures = [var.trusted_edge_ipv4_cidrs]
}

run "host_bits_edge_cidr_is_rejected" {
  command = plan

  variables {
    trusted_edge_ipv4_cidrs = ["173.245.48.1/20"]
  }

  expect_failures = [var.trusted_edge_ipv4_cidrs]
}

run "empty_edge_cidr_set_is_rejected" {
  command = plan

  variables {
    trusted_edge_ipv4_cidrs = []
  }

  expect_failures = [var.trusted_edge_ipv4_cidrs]
}
