import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Terraform production-state boundary", () => {
  it("requires encrypted native-locking S3 state", () => {
    const versions = readRepoFile("terraform/stacks/aws-ec2/versions.tf");
    const backend = versions.match(/^\s*backend\s+"s3"\s*\{([\s\S]*?)^\s*\}/m)?.[1];

    expect(versions).toContain('required_version = ">= 1.11.0"');
    expect(backend).toBeDefined();
    expect(backend).toMatch(/^\s*encrypt\s*=\s*true\s*$/m);
    expect(backend).toMatch(/^\s*use_lockfile\s*=\s*true\s*$/m);
  });

  it("ships required KMS and account settings without credentials", () => {
    const config = readRepoFile("terraform/stacks/aws-ec2/backend.conf.example");

    for (const property of [
      "bucket",
      "key",
      "region",
      "kms_key_id",
      "allowed_account_ids",
      "workspace_key_prefix",
    ]) {
      expect(config).toMatch(new RegExp(`^\\s*${property}\\s*=`, "m"));
    }

    expect(config).not.toMatch(/^\s*(?:access_key|secret_key|token)\s*=/m);
    expect(config).not.toMatch(/^\s*dynamodb_table\s*=/m);
  });

  it("ships a hardened first-time backend bootstrap", () => {
    const main = readRepoFile("terraform/bootstrap/aws-state/main.tf");
    const outputs = readRepoFile("terraform/bootstrap/aws-state/outputs.tf");
    const versions = readRepoFile("terraform/bootstrap/aws-state/versions.tf");
    const workflow = readRepoFile(".github/workflows/ci.yml");

    expect(versions).toContain('version = "= 5.100.0"');
    expect(versions).toContain("allowed_account_ids = [var.expected_account_id]");
    expect(main).toContain('resource "aws_kms_key" "state"');
    expect(main).toMatch(/^\s*enable_key_rotation\s*=\s*true\s*$/m);
    expect(main).toContain('resource "aws_s3_bucket_public_access_block" "state"');
    expect(main).toContain('resource "aws_s3_bucket_versioning" "state"');
    expect(main).toContain('resource "aws_s3_bucket_server_side_encryption_configuration" "state"');
    expect(main).toContain('Sid       = "DenyInsecureTransport"');
    expect(main).toContain('Sid       = "DenyUploadsWithoutSSEKMS"');
    expect(main).toContain('Sid       = "DenyUploadsWithWrongKMSKey"');
    expect(outputs).toContain('Sid      = "ManageNativeStateLock"');
    expect(outputs).toContain('Sid      = "ManageWorkspaceState"');
    expect(outputs).toContain('"kms:GenerateDataKey"');
    expect(outputs).toContain('output "recovery_iam_policy_json"');
    expect(workflow).toContain("hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e");
    expect(workflow).toContain("terraform -chdir=terraform/bootstrap/aws-state test");
  });

  it("documents guarded migration and secret-bearing plan naming", () => {
    const readme = readRepoFile("terraform/README.md");
    const gitignore = readRepoFile("terraform/.gitignore");

    expect(readme).toContain("terraform init -migrate-state -backend-config=backend.conf");
    expect(readme).toMatch(/Stop if\s+initialization shows an empty or different state/);
    expect(readme).toMatch(/Do not use\s+`-reconfigure`\s+for the\s+first migration/);
    expect(readme).toContain("always use a `.tfplan`");
    expect(readme).toContain("keep `dynamodb_table` alongside the");
    expect(readme).toContain("identical bucket, key, and workspace prefix");
    expect(readme).toContain("revoke write and lock permissions for the old backend");
    expect(gitignore).toContain("*.tfstate.*");
    expect(gitignore).toContain("*.tfplan");
    expect(gitignore).toContain("*.plan");
  });
});
