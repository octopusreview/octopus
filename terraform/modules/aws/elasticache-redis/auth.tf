data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_region" "current" {}

locals {
  # RBAC IDs have a 40-character limit. Derive a stable suffix so an existing
  # valid replication-group prefix up to its 34-character limit remains usable.
  redis_auth_id_prefix                = "oct-${substr(sha256(var.name_prefix), 0, 12)}"
  redis_auth_app_user_id              = "${local.redis_auth_id_prefix}-app"
  redis_auth_app_username             = "${local.redis_auth_id_prefix}-app"
  redis_auth_app_access_string        = "on resetkeys resetchannels -@all +info (+incr +expire +ttl ~rl:invite:user:* ~rl:invite:org:* ~rl:avatar-upload:*) (+get +set ~mx:v1:*) (+set +del +expire +mget +zadd +zrem +zremrangebyscore +zrangebyscore ~presence:*) (+set ~gh:install:state:jti:*) (+publish +subscribe &octopus:cancel &octopus:probe)"
  redis_auth_disabled_default_user_id = "${local.redis_auth_id_prefix}-disabled"
  redis_auth_user_group_id            = "${local.redis_auth_id_prefix}-users"

  redis_auth_secret_arn_parts         = split(":", var.redis_auth_secret_arn)
  redis_auth_secret_kms_key_arn_parts = split(":", var.redis_auth_secret_kms_key_arn)
  redis_auth_password_references = [
    for version_id in var.redis_auth_secret_version_ids :
    "{{resolve:secretsmanager:${var.redis_auth_secret_arn}:SecretString:password::${version_id}}}"
  ]

  # Encode each branch first so Terraform can represent CloudFormation's
  # intentionally heterogeneous string/intrinsic-function array.
  redis_auth_user_ids = jsondecode(var.redis_auth_cutover_stage == "preflight" ? jsonencode([
    "default",
    { Ref = "ApplicationUser" },
    ]) : jsonencode([
    { Ref = "DisabledDefaultUser" },
    { Ref = "ApplicationUser" },
  ]))

  redis_auth_resource_tags = [
    for key in sort(keys(merge({ Name = "${var.name_prefix}-redis-rbac" }, var.tags))) : {
      Key   = key
      Value = merge({ Name = "${var.name_prefix}-redis-rbac" }, var.tags)[key]
    }
  ]

  redis_auth_user_arns = [
    "arn:${data.aws_partition.current.partition}:elasticache:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:user:${local.redis_auth_app_user_id}",
    "arn:${data.aws_partition.current.partition}:elasticache:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:user:${local.redis_auth_disabled_default_user_id}",
  ]
  redis_auth_builtin_default_user_arn = "arn:${data.aws_partition.current.partition}:elasticache:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:user:default"
  redis_auth_user_group_arn           = "arn:${data.aws_partition.current.partition}:elasticache:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:usergroup:${local.redis_auth_user_group_id}"

  redis_auth_template = {
    AWSTemplateFormatVersion = "2010-09-09"
    Description              = "Octopus Redis RBAC users managed without exposing passwords to Terraform"
    Resources = {
      ApplicationUser = {
        Type = "AWS::ElastiCache::User"
        Properties = {
          AccessString = local.redis_auth_app_access_string
          AuthenticationMode = {
            Passwords = local.redis_auth_password_references
            Type      = "password"
          }
          Engine   = "redis"
          Tags     = local.redis_auth_resource_tags
          UserId   = local.redis_auth_app_user_id
          UserName = local.redis_auth_app_username
        }
      }
      DisabledDefaultUser = {
        Type = "AWS::ElastiCache::User"
        Properties = {
          AccessString = "off ~* -@all"
          AuthenticationMode = {
            Type = "no-password-required"
          }
          Engine   = "redis"
          Tags     = local.redis_auth_resource_tags
          UserId   = local.redis_auth_disabled_default_user_id
          UserName = "default"
        }
      }
      RedisUserGroup = {
        Type = "AWS::ElastiCache::UserGroup"
        Properties = {
          Engine      = "redis"
          Tags        = local.redis_auth_resource_tags
          UserGroupId = local.redis_auth_user_group_id
          UserIds     = local.redis_auth_user_ids
        }
      }
    }
    Outputs = {
      AppUserName = {
        Value = local.redis_auth_app_username
      }
      UserGroupId = {
        Value = local.redis_auth_user_group_id
      }
    }
  }
}

resource "aws_iam_role" "redis_auth_cloudformation" {
  name = "${var.name_prefix}-redis-rbac-cloudformation"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "cloudformation.amazonaws.com" }
    }]
  })

  tags = merge({ Name = "${var.name_prefix}-redis-rbac-cloudformation" }, var.tags)
}

resource "aws_iam_role_policy" "redis_auth_cloudformation" {
  name = "${var.name_prefix}-redis-rbac"
  role = aws_iam_role.redis_auth_cloudformation.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "ReadExactRedisPasswordVersions"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.redis_auth_secret_arn]
      },
      {
        Sid    = "ManageExactRedisUsers"
        Effect = "Allow"
        Action = [
          "elasticache:CreateUser",
          "elasticache:DeleteUser",
          "elasticache:DescribeUsers",
          "elasticache:ModifyUser",
        ]
        Resource = local.redis_auth_user_arns
      },
      {
        Sid    = "ManageExactRedisUserGroup"
        Effect = "Allow"
        Action = [
          "elasticache:DeleteUserGroup",
          "elasticache:DescribeUserGroups",
        ]
        Resource = [local.redis_auth_user_group_arn]
      },
      {
        Sid    = "ManageExactRedisUserGroupMembership"
        Effect = "Allow"
        Action = [
          "elasticache:CreateUserGroup",
          "elasticache:ModifyUserGroup",
        ]
        Resource = concat(local.redis_auth_user_arns, [
          local.redis_auth_builtin_default_user_arn,
          local.redis_auth_user_group_arn,
        ])
      },
      {
        Sid    = "TagExactRedisAuthResources"
        Effect = "Allow"
        Action = [
          "elasticache:AddTagsToResource",
          "elasticache:ListTagsForResource",
          "elasticache:RemoveTagsFromResource",
        ]
        Resource = concat(local.redis_auth_user_arns, [local.redis_auth_user_group_arn])
      },
      ], var.redis_auth_secret_kms_key_arn == "" ? [] : [
      {
        Sid      = "DecryptDedicatedRedisPasswordSecret"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.redis_auth_secret_kms_key_arn]
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = data.aws_caller_identity.current.account_id
            "kms:ViaService"    = "secretsmanager.${data.aws_region.current.name}.${data.aws_partition.current.dns_suffix}"
          }
        }
      },
    ])
  })
}

resource "aws_cloudformation_stack" "redis_auth" {
  name               = "${var.name_prefix}-redis-rbac"
  iam_role_arn       = aws_iam_role.redis_auth_cloudformation.arn
  template_body      = jsonencode(local.redis_auth_template)
  parameters         = {}
  on_failure         = "ROLLBACK"
  timeout_in_minutes = 30

  tags = merge({ Name = "${var.name_prefix}-redis-rbac" }, var.tags)

  depends_on = [aws_iam_role_policy.redis_auth_cloudformation]

  lifecycle {
    precondition {
      condition = (
        local.redis_auth_secret_arn_parts[1] == data.aws_partition.current.partition &&
        local.redis_auth_secret_arn_parts[3] == data.aws_region.current.name &&
        local.redis_auth_secret_arn_parts[4] == data.aws_caller_identity.current.account_id
      )
      error_message = "redis_auth_secret_arn must belong to the same AWS partition, region, and account as the Redis cluster."
    }

    precondition {
      condition = try(
        var.redis_auth_secret_kms_key_arn == "" || (
          local.redis_auth_secret_kms_key_arn_parts[1] == data.aws_partition.current.partition &&
          local.redis_auth_secret_kms_key_arn_parts[3] == data.aws_region.current.name &&
          local.redis_auth_secret_kms_key_arn_parts[4] == data.aws_caller_identity.current.account_id
        ),
        false
      )
      error_message = "redis_auth_secret_kms_key_arn must be empty or belong to the same AWS partition, region, and account as the Redis cluster."
    }
  }
}
