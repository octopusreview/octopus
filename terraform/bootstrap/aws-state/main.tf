data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  lock_key                   = "${var.state_key}.tflock"
  bucket_arn                 = "arn:${data.aws_partition.current.partition}:s3:::${var.bucket_name}"
  state_object_arn           = "${local.bucket_arn}/${var.state_key}"
  lock_object_arn            = "${local.bucket_arn}/${local.lock_key}"
  workspace_state_object_arn = "${local.bucket_arn}/${var.workspace_key_prefix}/*/${var.state_key}"
  workspace_lock_object_arn  = "${local.bucket_arn}/${var.workspace_key_prefix}/*/${local.lock_key}"
  kms_alias_name             = "alias/octopus-${replace(var.bucket_name, ".", "-")}-tfstate"

  resource_tags = merge(var.tags, {
    ManagedBy = "Terraform"
    Purpose   = "Octopus Terraform state"
  })
}

resource "aws_kms_key" "state" {
  description              = "Encrypts Octopus Terraform state and lock objects"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  is_enabled               = true
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EnableAccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })

  tags = merge(local.resource_tags, {
    Name = "octopus-terraform-state"
  })

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "Authenticated AWS account does not match expected_account_id; refusing to create the state boundary."
    }
  }
}

resource "aws_kms_alias" "state" {
  name          = local.kms_alias_name
  target_key_id = aws_kms_key.state.key_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "state" {
  bucket        = var.bucket_name
  force_destroy = false

  tags = merge(local.resource_tags, {
    Name = var.bucket_name
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.state.arn
      sse_algorithm     = "aws:kms"
    }

    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = "s3:*"
        Resource  = [local.bucket_arn, "${local.bucket_arn}/*"]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
      {
        Sid       = "DenyUploadsWithoutSSEKMS"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = "s3:PutObject"
        Resource  = "${local.bucket_arn}/*"
        Condition = {
          StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" }
        }
      },
      {
        Sid       = "DenyUploadsWithWrongKMSKey"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = "s3:PutObject"
        Resource  = "${local.bucket_arn}/*"
        Condition = {
          StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.state.arn }
        }
      }
    ]
  })

  depends_on = [
    aws_s3_bucket_ownership_controls.state,
    aws_s3_bucket_public_access_block.state,
    aws_s3_bucket_server_side_encryption_configuration.state,
    aws_s3_bucket_versioning.state,
  ]
}
