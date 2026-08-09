# SEC-10 Redis RBAC regression tests.
# Runs entirely against a mocked AWS provider — no AWS credentials required:
#   terraform -chdir=terraform/modules/aws/elasticache-redis init -backend=false
#   terraform -chdir=terraform/modules/aws/elasticache-redis test

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
      arn        = "arn:aws:iam::123456789012:user/test"
      id         = "123456789012"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      dns_suffix = "amazonaws.com"
      partition  = "aws"
    }
  }

  mock_data "aws_region" {
    defaults = {
      name = "us-east-1"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn  = "arn:aws:iam::123456789012:role/octopus-redis-rbac-cloudformation"
      id   = "octopus-redis-rbac-cloudformation"
      name = "octopus-redis-rbac-cloudformation"
    }
  }
}

variables {
  name_prefix                   = "octopus"
  vpc_id                        = "vpc-00000000000000000"
  subnet_ids                    = ["subnet-00000000000000001", "subnet-00000000000000002"]
  redis_auth_secret_arn         = "arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/redis-auth-ABC123"
  redis_auth_secret_version_ids = ["11111111-2222-3333-4444-555555555555"]
  redis_auth_cutover_stage      = "preflight"
}

run "preflight_keeps_legacy_default_and_proves_password_auth" {
  command = plan

  assert {
    condition = (
      aws_elasticache_replication_group.this.transit_encryption_enabled &&
      aws_elasticache_replication_group.this.at_rest_encryption_enabled &&
      toset(aws_elasticache_replication_group.this.user_group_ids) == toset(["oct-5633c9b8af6d-users"])
    )
    error_message = "Preflight must attach the RBAC user group while retaining encrypted transport and storage."
  }

  assert {
    condition = (
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Type == "AWS::ElastiCache::User" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.UserId == "oct-5633c9b8af6d-app" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.UserName == "oct-5633c9b8af6d-app" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.UserName != "default" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AccessString == "on resetkeys resetchannels -@all +info (+incr +expire +ttl ~rl:invite:user:* ~rl:invite:org:* ~rl:avatar-upload:*) (+get +set ~mx:v1:*) (+set +del +expire +mget +zadd +zrem +zremrangebyscore +zrangebyscore ~presence:*) (+set ~gh:install:state:jti:*) (+publish +subscribe &octopus:cancel &octopus:probe)" &&
      !strcontains(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AccessString, "+scan") &&
      !strcontains(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AccessString, "+client") &&
      !strcontains(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AccessString, "+ping") &&
      !strcontains(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AccessString, "+unsubscribe") &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AuthenticationMode.Type == "password" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AuthenticationMode.Passwords == [
        "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/redis-auth-ABC123:SecretString:password::11111111-2222-3333-4444-555555555555}}",
      ]
    )
    error_message = "The app user must use a non-default username and only an exact-version Secrets Manager dynamic reference for its password."
  }

  assert {
    condition = (
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.DisabledDefaultUser.Type == "AWS::ElastiCache::User" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.DisabledDefaultUser.Properties.UserId == "oct-5633c9b8af6d-disabled" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.DisabledDefaultUser.Properties.UserName == "default" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.DisabledDefaultUser.Properties.AccessString == "off ~* -@all" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.DisabledDefaultUser.Properties.AuthenticationMode.Type == "no-password-required"
    )
    error_message = "The replacement default user must be permanently disabled without containing a password."
  }

  assert {
    condition = (
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.RedisUserGroup.Type == "AWS::ElastiCache::UserGroup" &&
      jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.RedisUserGroup.Properties.UserGroupId == "oct-5633c9b8af6d-users" &&
      jsonencode(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.RedisUserGroup.Properties.UserIds) == jsonencode([
        "default",
        { Ref = "ApplicationUser" },
      ]) &&
      !strcontains(jsonencode(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.RedisUserGroup.Properties.UserIds), "DisabledDefaultUser")
    )
    error_message = "Preflight must keep the built-in passwordless default and add the authenticated app user for live credential proof."
  }
}

run "enforced_disables_passwordless_default_and_supports_dual_password_rotation" {
  command = plan

  variables {
    redis_auth_cutover_stage = "enforced"
    redis_auth_secret_version_ids = [
      "11111111-2222-3333-4444-555555555555",
      "66666666-7777-8888-9999-000000000000",
    ]
  }

  assert {
    condition = (
      toset(aws_elasticache_replication_group.this.user_group_ids) == toset(["oct-5633c9b8af6d-users"]) &&
      jsonencode(jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.RedisUserGroup.Properties.UserIds) == jsonencode([
        { Ref = "DisabledDefaultUser" },
        { Ref = "ApplicationUser" },
      ])
    )
    error_message = "Enforcement must keep the attached group, replace the built-in default with the disabled default, and retain the app user."
  }

  assert {
    condition = jsondecode(aws_cloudformation_stack.redis_auth.template_body).Resources.ApplicationUser.Properties.AuthenticationMode.Passwords == [
      "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/redis-auth-ABC123:SecretString:password::11111111-2222-3333-4444-555555555555}}",
      "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/redis-auth-ABC123:SecretString:password::66666666-7777-8888-9999-000000000000}}",
    ]
    error_message = "Rotation must support exactly two explicit secret versions without resolving either password in Terraform."
  }
}

run "cloudformation_role_is_narrow_and_secret_safe" {
  command = plan

  assert {
    condition = (
      jsonencode(jsondecode(aws_iam_role.redis_auth_cloudformation.assume_role_policy).Statement) == jsonencode([{
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "cloudformation.amazonaws.com" }
      }]) &&
      aws_cloudformation_stack.redis_auth.iam_role_arn == aws_iam_role.redis_auth_cloudformation.arn
    )
    error_message = "Only CloudFormation may assume the dedicated Redis RBAC service role."
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "ReadExactRedisPasswordVersions"
      ]).Action == ["secretsmanager:GetSecretValue"] &&
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "ReadExactRedisPasswordVersions"
      ]).Resource == ["arn:aws:secretsmanager:us-east-1:123456789012:secret:octopus/redis-auth-ABC123"] &&
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "ManageExactRedisUsers"
        ]).Resource == [
        "arn:aws:elasticache:us-east-1:123456789012:user:oct-5633c9b8af6d-app",
        "arn:aws:elasticache:us-east-1:123456789012:user:oct-5633c9b8af6d-disabled",
      ] &&
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "ManageExactRedisUserGroup"
      ]).Resource == ["arn:aws:elasticache:us-east-1:123456789012:usergroup:oct-5633c9b8af6d-users"] &&
      toset(one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "ManageExactRedisUserGroupMembership"
        ]).Resource) == toset([
        "arn:aws:elasticache:us-east-1:123456789012:user:default",
        "arn:aws:elasticache:us-east-1:123456789012:user:oct-5633c9b8af6d-app",
        "arn:aws:elasticache:us-east-1:123456789012:user:oct-5633c9b8af6d-disabled",
        "arn:aws:elasticache:us-east-1:123456789012:usergroup:oct-5633c9b8af6d-users",
      ]) &&
      alltrue([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement :
        !contains(statement.Resource, "*")
      ])
    )
    error_message = "The CloudFormation role must read only the dedicated Redis secret and manage only the stable Redis users and group."
  }

  assert {
    condition = (
      !strcontains(aws_cloudformation_stack.redis_auth.template_body, "password-value") &&
      !contains(keys(aws_cloudformation_stack.redis_auth.parameters), "Password") &&
      output.application_username == "oct-5633c9b8af6d-app" &&
      output.user_group_id == "oct-5633c9b8af6d-users"
    )
    error_message = "Terraform state, parameters, and outputs must contain identifiers only, never a Redis password."
  }
}

run "customer_managed_secret_key_is_exactly_scoped" {
  command = plan

  variables {
    redis_auth_secret_kms_key_arn = "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555"
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "DecryptDedicatedRedisPasswordSecret"
      ]).Action == ["kms:Decrypt"] &&
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "DecryptDedicatedRedisPasswordSecret"
      ]).Resource == ["arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555"] &&
      one([
        for statement in jsondecode(aws_iam_role_policy.redis_auth_cloudformation.policy).Statement : statement
        if statement.Sid == "DecryptDedicatedRedisPasswordSecret"
        ]).Condition.StringEquals == {
        "kms:CallerAccount" = "123456789012"
        "kms:ViaService"    = "secretsmanager.us-east-1.amazonaws.com"
      }
    )
    error_message = "A customer-managed secret key must grant only kms:Decrypt on the exact key ARN."
  }
}

run "cross_region_secret_is_rejected" {
  command = plan

  variables {
    redis_auth_secret_arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:octopus/redis-auth-ABC123"
  }

  expect_failures = [aws_cloudformation_stack.redis_auth]
}

run "empty_secret_versions_are_rejected" {
  command = plan

  variables {
    redis_auth_secret_version_ids = []
  }

  expect_failures = [var.redis_auth_secret_version_ids]
}

run "more_than_two_secret_versions_are_rejected" {
  command = plan

  variables {
    redis_auth_secret_version_ids = [
      "11111111-2222-3333-4444-555555555555",
      "66666666-7777-8888-9999-000000000000",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ]
  }

  expect_failures = [var.redis_auth_secret_version_ids]
}

run "unknown_cutover_stage_is_rejected" {
  command = plan

  variables {
    redis_auth_cutover_stage = "disabled"
  }

  expect_failures = [var.redis_auth_cutover_stage]
}

run "legacy_long_prefix_derives_bounded_stable_auth_ids" {
  command = plan

  variables {
    name_prefix = "octopus-production-legacy-stack"
  }

  assert {
    condition = (
      output.application_username == "oct-${substr(sha256("octopus-production-legacy-stack"), 0, 12)}-app" &&
      output.user_group_id == "oct-${substr(sha256("octopus-production-legacy-stack"), 0, 12)}-users" &&
      length(output.application_username) <= 40 &&
      length(output.user_group_id) <= 40
    )
    error_message = "Valid legacy prefixes must derive stable Redis RBAC IDs without exceeding AWS limits."
  }
}

run "unsafe_name_prefix_is_rejected" {
  command = plan

  variables {
    name_prefix = "1_invalid"
  }

  expect_failures = [var.name_prefix]
}

run "redis_six_is_rejected_without_selector_support" {
  command = plan

  variables {
    engine_version = "6.2"
  }

  expect_failures = [var.engine_version]
}
