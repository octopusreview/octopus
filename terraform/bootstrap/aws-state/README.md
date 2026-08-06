# AWS state bootstrap

This isolated Terraform root creates the security boundary used by the Octopus
AWS application stack:

- a customer-managed, rotating KMS key and alias;
- a private, versioned S3 bucket with bucket-owner-enforced ownership;
- default SSE-KMS encryption plus policy denies for plaintext transport,
  missing SSE-KMS headers, and the wrong KMS key; and
- credential-free backend configuration and a least-privilege operator policy.

The bucket and KMS key are protected with `prevent_destroy`. This root must run
before initializing `terraform/stacks/aws-ec2`; a backend cannot safely create
the bucket that stores its own initial state.

## Create the backend

Authenticate to the target AWS account with an administrative SSO session or
role, then run from this directory:

```bash
cp terraform.tfvars.example terraform.tfvars
# Set a globally unique bucket_name and the expected 12-digit AWS account;
# review the region, state key, workspace prefix, and tags.
terraform init
terraform plan
terraform apply
```

The local bootstrap state contains bucket, KMS, policy, and account metadata,
but no Octopus application credentials or generated application secrets. It is
still operationally sensitive: keep it on an encrypted filesystem, restrict it
to the operator, back it up, and never pass application secrets to this root.
The committed dependency lock file pins the reviewed AWS provider checksums.
Both the AWS provider and a resource precondition reject credentials for any
account other than `expected_account_id` before creating the boundary.

## Configure the application stack

Generate its credential-free backend file:

```bash
terraform output -raw backend_conf > ../../stacks/aws-ec2/backend.conf
terraform output -raw operator_iam_policy_json
```

Attach the printed IAM policy to the role or identity that will operate the
application stack. It grants only:

- `s3:ListBucket`, limited to the default state/lock keys and the workspace
  prefix;
- `s3:GetObject` and `s3:PutObject` on the default state object;
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on non-default
  workspace state objects (required for workspace deletion);
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on their `.tflock`
  objects; and
- `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, and `kms:DescribeKey` on
  the dedicated key.

Then initialize a fresh application stack:

```bash
terraform -chdir=../../stacks/aws-ec2 init -backend-config=backend.conf
```

For an existing local application state, take a restricted, workspace-aware
backup before checking out the backend change, establish an exclusive
maintenance window, and use `terraform init -migrate-state` from the
application stack. Never use `-reconfigure` for the first migration.

The day-to-day operator policy intentionally cannot enumerate or retrieve prior
state versions. During recovery only, a bootstrap administrator can print and
temporarily attach `terraform output -raw recovery_iam_policy_json`; it grants
scoped `s3:ListBucketVersions`, `s3:GetObjectVersion`, and KMS decrypt access.
Remove it immediately after recovering a known-good version.

## Test

The native tests use a mocked AWS provider and make no network calls:

```bash
terraform init -backend=false
terraform test
```
