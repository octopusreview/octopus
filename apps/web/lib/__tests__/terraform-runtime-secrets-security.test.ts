import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const stackMain = readRepoFile("terraform/stacks/aws-ec2/main.tf");
const stackVariables = readRepoFile("terraform/stacks/aws-ec2/variables.tf");
const stackOutputs = readRepoFile("terraform/stacks/aws-ec2/outputs.tf");
const stackTfvarsExample = readRepoFile("terraform/stacks/aws-ec2/terraform.tfvars.example");
const quickstartExample = readRepoFile("terraform/examples/aws-ec2/main.tf");
const rdsMain = readRepoFile("terraform/modules/aws/rds-postgres/main.tf");
const rdsVariables = readRepoFile("terraform/modules/aws/rds-postgres/variables.tf");
const ec2Main = readRepoFile("terraform/modules/aws/ec2-app/main.tf");
const ec2Variables = readRepoFile("terraform/modules/aws/ec2-app/variables.tf");
const ec2UserData = readRepoFile("terraform/modules/aws/ec2-app/templates/userdata.sh.tpl");
const ec2RefreshScript = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/refresh-secrets.sh.tpl",
);
const ec2RuntimeInstaller = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/runtime-installer.sh.tpl",
);
const ec2PreflightScript = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/preflight-runtime-secrets.sh.tpl",
);
const terraformReadme = readRepoFile("terraform/README.md");
const dockerCompose = readRepoFile("terraform/stacks/aws-ec2/templates/docker-compose.yml.tpl");

const productionTerraform = [
  stackMain,
  stackVariables,
  stackOutputs,
  stackTfvarsExample,
  quickstartExample,
  rdsMain,
  rdsVariables,
  ec2Main,
  ec2Variables,
  ec2UserData,
  ec2RefreshScript,
].join("\n");

const legacySecretValueInputs = [
  "db_password",
  "better_auth_secret",
  "github_app_private_key",
  "github_webhook_secret",
  "github_app_client_secret",
  "github_client_secret",
  "google_client_secret",
  "openai_api_key",
  "anthropic_api_key",
  "cohere_api_key",
  "resend_api_key",
  "pubby_app_secret",
];

describe("Terraform runtime-secret boundary", () => {
  it("accepts secret ARNs instead of secret values", () => {
    for (const name of legacySecretValueInputs) {
      expect(stackVariables).not.toMatch(new RegExp(`variable\\s+"${name}"\\s*\\{`));
      expect(stackTfvarsExample).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, "m"));
      expect(quickstartExample).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, "m"));
    }

    expect(stackVariables).toMatch(/variable\s+"(?:application|app)_secret_arn"\s*\{/);
    expect(stackTfvarsExample).toMatch(/^\s*(?:application|app)_secret_arn\s*=/m);
  });

  it("does not generate, retrieve, or output secret values through Terraform", () => {
    expect(productionTerraform).not.toMatch(/resource\s+"random_password"/);
    expect(productionTerraform).not.toMatch(
      /(?:data|resource)\s+"aws_secretsmanager_secret_version"/,
    );
    expect(productionTerraform).not.toMatch(/\bsecret_(?:string|binary)\s*=/);
    expect(stackOutputs).not.toMatch(/output\s+"(?:db_password|better_auth_secret)"/);
    expect(rdsMain).toMatch(
      /^\s*manage_master_user_password\s*=\s*var\.manage_master_user_password\s*$/m,
    );
    expect(rdsMain).not.toMatch(/^\s*password\s*=/m);
    expect(rdsVariables).not.toMatch(/variable\s+"db_password"\s*\{/);
  });

  it("keeps secret values out of the EC2 user-data template boundary", () => {
    expect(productionTerraform).not.toMatch(/\benv_content\b/);
    expect(ec2Variables).not.toMatch(/^\s*sensitive\s*=\s*true\s*$/m);
    expect(ec2Main).toContain("user_data_base64 = base64gzip(templatefile(");
    expect(ec2Main).toContain("application_secret_arn");
    expect(ec2Main).toContain("database_secret_arn");

    const templateInputs = ec2Main.match(
      /user_data_base64\s*=\s*base64gzip\(templatefile\([^,]+,\s*\{([\s\S]*?)\}\)\)/,
    )?.[1];
    expect(templateInputs).toBeDefined();
    expect(templateInputs).toContain("runtime_installer_base64");

    const referencedVariables = [
      ...ec2Main.matchAll(/\bvar\.([a-zA-Z0-9_]+)/g),
    ].map((match) => match[1]);
    const secretLikeInputs = [...new Set(referencedVariables)].filter((name) =>
      /secret|password|private_key|api_key/.test(name),
    );

    const secretValueInputs = secretLikeInputs.filter(
      (name) => name !== "runtime_secret_preflight_only",
    );
    expect(secretValueInputs.length).toBeGreaterThanOrEqual(2);
    expect(secretValueInputs.every((name) => /_arns?$/.test(name))).toBe(true);
    expect(ec2RefreshScript).toContain("aws secretsmanager get-secret-value");
    expect(ec2RefreshScript).toContain("RUNTIME_DIRECTORY=/run/octopus");
    expect(ec2RefreshScript).toContain("RUNTIME_ENV=$RUNTIME_DIRECTORY/runtime.env");
    expect(dockerCompose).toContain("format: raw");

    for (const name of legacySecretValueInputs) {
      expect(templateInputs).not.toContain(`var.${name}`);
      expect(ec2UserData).not.toContain(`\${${name}}`);
    }
  });

  it("runs SSM installers from private temporary files without masking failures", () => {
    const runCommand = ec2Main.match(/runCommand\s*=\s*\[([\s\S]*?)\n\s*\]/)?.[1];

    expect(runCommand).toBeDefined();
    expect(runCommand).toContain('"set -eu"');
    expect(runCommand).toContain(
      'installer_path=$(mktemp /run/octopus-runtime-installer.XXXXXX)',
    );
    expect(runCommand).toContain('trap \'rm -f -- \\"$installer_path\\"\' EXIT');
    expect(runCommand).toContain('/bin/bash \\"$installer_path\\"');
    expect(runCommand).toContain("cloud-init status --wait");
    expect(runCommand).not.toContain("/var/tmp/octopus-runtime-installer.sh");

    const installerRun = runCommand?.indexOf('/bin/bash \\"$installer_path\\"') ?? -1;
    expect(installerRun).toBeGreaterThan(-1);
    expect(runCommand?.slice(installerRun)).not.toContain("rm -f");

    const retryTimerStart = ec2RuntimeInstaller.indexOf(
      "systemctl enable --now octopus-secrets.timer",
    );
    const immediateRefresh = ec2RuntimeInstaller.indexOf(
      "OCTOPUS_FORCE_RECREATE=1 /usr/local/sbin/octopus-refresh-secrets",
    );
    expect(retryTimerStart).toBeGreaterThan(-1);
    expect(immediateRefresh).toBeGreaterThan(retryTimerStart);
  });

  it("stages existing-stack validation before enabling managed credentials", () => {
    expect(stackVariables).toMatch(/variable\s+"runtime_secret_cutover_stage"\s*\{/);
    expect(stackVariables).toContain(
      'contains(["preflight", "enforced"], var.runtime_secret_cutover_stage)',
    );
    expect(stackMain).toContain(
      'manage_master_user_password    = var.runtime_secret_cutover_stage == "enforced"',
    );
    expect(stackMain).toContain(
      'database_secret_arn           = var.runtime_secret_cutover_stage == "enforced" ? module.rds.master_user_secret_arn : ""',
    );
    expect(stackMain).toContain(
      'runtime_secret_preflight_only = var.runtime_secret_cutover_stage == "preflight"',
    );
    expect(ec2Main).toContain(
      "runtime_secret_payload = var.runtime_secret_preflight_only ? local.runtime_secret_preflight : local.runtime_installer",
    );
    const rendererInvocation = ec2PreflightScript.match(
      /\/usr\/bin\/python3[\s\S]*?(?=\n\n|$)/,
    )?.[0];
    expect(rendererInvocation).toContain("--validate-application-secret-only");
    expect(rendererInvocation).not.toContain("--database-secret");
    expect(rendererInvocation).not.toContain("--output");
    expect(ec2PreflightScript).toContain("Docker Compose 2.30.0 or newer is required");
    expect(ec2PreflightScript).toContain(
      'docker compose -f "$TEMP_DIRECTORY/docker-compose.yml" config --quiet',
    );
    expect(terraformReadme).toContain("Stage 1 — preflight (no credential rotation)");
    expect(terraformReadme).toContain("Stage 2 — enforced (activate managed runtime secrets)");
  });
});
