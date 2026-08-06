locals {
  backend_conf = <<-EOT
    bucket               = "${var.bucket_name}"
    key                  = "${var.state_key}"
    region               = "${var.region}"
    kms_key_id           = "${aws_kms_key.state.arn}"
    allowed_account_ids  = ["${data.aws_caller_identity.current.account_id}"]
    workspace_key_prefix = "${var.workspace_key_prefix}"
  EOT

  operator_iam_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListOnlyTheStateKeys"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.bucket_arn]
        Condition = {
          StringLike = {
            "s3:prefix" = [
              var.state_key,
              local.lock_key,
              "${var.workspace_key_prefix}/*",
            ]
          }
        }
      },
      {
        Sid      = "ReadWriteStateWithoutDelete"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = [local.state_object_arn]
      },
      {
        Sid      = "ManageWorkspaceState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [local.workspace_state_object_arn]
      },
      {
        Sid      = "ManageNativeStateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [local.lock_object_arn, local.workspace_lock_object_arn]
      },
      {
        Sid    = "UseStateEncryptionKey"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey",
        ]
        Resource = [aws_kms_key.state.arn]
      },
    ]
  }

  recovery_iam_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListStateVersions"
        Effect   = "Allow"
        Action   = ["s3:ListBucketVersions"]
        Resource = [local.bucket_arn]
        Condition = {
          StringLike = {
            "s3:prefix" = [
              var.state_key,
              "${var.workspace_key_prefix}/*",
            ]
          }
        }
      },
      {
        Sid      = "ReadPriorStateVersions"
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersion"]
        Resource = [local.state_object_arn, local.workspace_state_object_arn]
      },
      {
        Sid      = "DecryptPriorStateVersions"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = [aws_kms_key.state.arn]
      },
    ]
  }
}

output "backend_conf" {
  description = "Credential-free backend.conf content for the Octopus application stack."
  value       = local.backend_conf
}

output "operator_iam_policy_json" {
  description = "Least-privilege IAM policy for an operator of the exact state and lock objects."
  value       = jsonencode(local.operator_iam_policy)
}

output "recovery_iam_policy_json" {
  description = "Read-only, break-glass policy for retrieving prior state versions; do not attach persistently."
  value       = jsonencode(local.recovery_iam_policy)
}

output "backend_metadata" {
  description = "Non-secret identifiers for the provisioned application-state backend."
  value = {
    account_id           = data.aws_caller_identity.current.account_id
    region               = var.region
    bucket_name          = aws_s3_bucket.state.id
    bucket_arn           = local.bucket_arn
    state_key            = var.state_key
    lock_key             = local.lock_key
    workspace_key_prefix = var.workspace_key_prefix
    kms_key_arn          = aws_kms_key.state.arn
    kms_alias_name       = aws_kms_alias.state.name
  }
}

output "bucket_name" {
  description = "State bucket name."
  value       = aws_s3_bucket.state.id
}

output "state_key" {
  description = "Application state object key."
  value       = var.state_key
}

output "aws_account_id" {
  description = "AWS account pinned in the generated backend configuration."
  value       = data.aws_caller_identity.current.account_id
}
