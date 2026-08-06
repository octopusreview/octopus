# Runs entirely against the mocked AWS provider; no credentials or live
# infrastructure are used.
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
      partition = "aws"
    }
  }

  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000"
      key_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  bucket_name          = "example-octopus-tfstate"
  region               = "us-east-1"
  expected_account_id  = "123456789012"
  state_key            = "aws-ec2/production/terraform.tfstate"
  workspace_key_prefix = "env:"
}

run "hardened_state_boundary" {
  command = plan

  assert {
    condition     = aws_kms_key.state.enable_key_rotation && aws_kms_key.state.deletion_window_in_days == 30
    error_message = "The state KMS key must rotate and retain the maximum deletion window."
  }

  assert {
    condition     = !aws_s3_bucket.state.force_destroy
    error_message = "The state bucket must never force-delete state versions."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.state.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "The state bucket must disable ACL ownership with BucketOwnerEnforced."
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.state.block_public_acls &&
      aws_s3_bucket_public_access_block.state.block_public_policy &&
      aws_s3_bucket_public_access_block.state.ignore_public_acls &&
      aws_s3_bucket_public_access_block.state.restrict_public_buckets
    )
    error_message = "Every S3 public-access-block control must remain enabled."
  }

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "State versioning must remain enabled for recovery."
  }

  assert {
    condition = (
      tolist(aws_s3_bucket_server_side_encryption_configuration.state.rule)[0].apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms" &&
      tolist(aws_s3_bucket_server_side_encryption_configuration.state.rule)[0].apply_server_side_encryption_by_default[0].kms_master_key_id == aws_kms_key.state.arn &&
      tolist(aws_s3_bucket_server_side_encryption_configuration.state.rule)[0].bucket_key_enabled
    )
    error_message = "Default encryption must use the dedicated KMS key with S3 bucket keys enabled."
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyInsecureTransport"
      ]).Effect == "Deny" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyInsecureTransport"
      ]).Principal.AWS == "*" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyInsecureTransport"
      ]).Action == "s3:*" &&
      toset(one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyInsecureTransport"
        ]).Resource) == toset([
        "arn:aws:s3:::example-octopus-tfstate",
        "arn:aws:s3:::example-octopus-tfstate/*",
      ]) &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyInsecureTransport"
      ]).Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "The bucket policy must deny every S3 action over plaintext transport on the bucket and its objects."
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithoutSSEKMS"
      ]).Effect == "Deny" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithoutSSEKMS"
      ]).Principal.AWS == "*" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithoutSSEKMS"
      ]).Action == "s3:PutObject" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithoutSSEKMS"
      ]).Resource == "arn:aws:s3:::example-octopus-tfstate/*" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithoutSSEKMS"
      ]).Condition.StringNotEquals["s3:x-amz-server-side-encryption"] == "aws:kms"
    )
    error_message = "The bucket policy must reject every object upload that does not request SSE-KMS."
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithWrongKMSKey"
      ]).Effect == "Deny" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithWrongKMSKey"
      ]).Principal.AWS == "*" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithWrongKMSKey"
      ]).Action == "s3:PutObject" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithWrongKMSKey"
      ]).Resource == "arn:aws:s3:::example-octopus-tfstate/*" &&
      one([
        for statement in jsondecode(aws_s3_bucket_policy.state.policy).Statement : statement
        if statement.Sid == "DenyUploadsWithWrongKMSKey"
      ]).Condition.StringNotEquals["s3:x-amz-server-side-encryption-aws-kms-key-id"] == aws_kms_key.state.arn
    )
    error_message = "The bucket policy must reject every object upload that uses a different KMS key."
  }

  assert {
    condition = (
      strcontains(output.backend_conf, "kms_key_id") &&
      strcontains(output.backend_conf, "allowed_account_ids") &&
      strcontains(output.backend_conf, "workspace_key_prefix") &&
      !strcontains(output.backend_conf, "access_key") &&
      !strcontains(output.backend_conf, "secret_key")
    )
    error_message = "backend.conf must pin KMS/account identifiers without embedding credentials."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Condition.StringLike["s3:prefix"]
      if statement.Sid == "ListOnlyTheStateKeys"
      ])) == toset([
      "aws-ec2/production/terraform.tfstate",
      "aws-ec2/production/terraform.tfstate.tflock",
      "env:/*",
    ])
    error_message = "ListBucket must be limited to the default and non-default workspace state/lock prefixes."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Resource
      if statement.Sid == "ReadWriteStateWithoutDelete"
      ])) == toset([
      "arn:aws:s3:::example-octopus-tfstate/aws-ec2/production/terraform.tfstate",
    ])
    error_message = "Default state read/write must cover only the configured state object."
  }

  assert {
    condition = (
      toset(one([
        for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Action
        if statement.Sid == "ManageWorkspaceState"
      ])) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]) &&
      toset(one([
        for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Resource
        if statement.Sid == "ManageWorkspaceState"
      ])) == toset(["arn:aws:s3:::example-octopus-tfstate/env:/*/aws-ec2/production/terraform.tfstate"])
    )
    error_message = "Non-default workspace state must support the S3 backend's scoped create/update/delete lifecycle."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Action
      if statement.Sid == "ManageNativeStateLock"
    ])) == toset(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
    error_message = "The operator policy must allow lock deletion without granting state deletion."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Resource
      if statement.Sid == "ManageNativeStateLock"
      ])) == toset([
      "arn:aws:s3:::example-octopus-tfstate/aws-ec2/production/terraform.tfstate.tflock",
      "arn:aws:s3:::example-octopus-tfstate/env:/*/aws-ec2/production/terraform.tfstate.tflock",
    ])
    error_message = "Lock management must cover only default and non-default workspace lock objects."
  }

  assert {
    condition = !contains(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Action
      if statement.Sid == "ReadWriteStateWithoutDelete"
    ]), "s3:DeleteObject")
    error_message = "The operator policy must not allow deletion of the state object."
  }

  assert {
    condition = toset(one([
      for statement in jsondecode(output.operator_iam_policy_json).Statement : statement.Action
      if statement.Sid == "UseStateEncryptionKey"
    ])) == toset(["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"])
    error_message = "The operator policy must contain only the KMS actions needed by the S3 backend."
  }

  assert {
    condition = (
      toset(one([
        for statement in jsondecode(output.recovery_iam_policy_json).Statement : statement.Action
        if statement.Sid == "ListStateVersions"
      ])) == toset(["s3:ListBucketVersions"]) &&
      toset(one([
        for statement in jsondecode(output.recovery_iam_policy_json).Statement : statement.Action
        if statement.Sid == "ReadPriorStateVersions"
      ])) == toset(["s3:GetObjectVersion"]) &&
      toset(one([
        for statement in jsondecode(output.recovery_iam_policy_json).Statement : statement.Action
        if statement.Sid == "DecryptPriorStateVersions"
      ])) == toset(["kms:Decrypt", "kms:DescribeKey"])
    )
    error_message = "The break-glass policy must be read-only and limited to version listing, retrieval, and KMS decryption."
  }
}

run "wildcard_state_key_is_rejected" {
  command = plan

  variables {
    state_key = "aws-ec2/*/terraform.tfstate"
  }

  expect_failures = [var.state_key]
}

run "wrong_aws_account_is_rejected" {
  command = plan

  variables {
    expected_account_id = "999999999999"
  }

  expect_failures = [aws_kms_key.state]
}
