import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const stackMain = readRepoFile("terraform/stacks/aws-ec2/main.tf");
const stackVariables = readRepoFile("terraform/stacks/aws-ec2/variables.tf");
const stackOutputs = readRepoFile("terraform/stacks/aws-ec2/outputs.tf");
const stackVersions = readRepoFile("terraform/stacks/aws-ec2/versions.tf");
const stackTfvarsExample = readRepoFile("terraform/stacks/aws-ec2/terraform.tfvars.example");
const quickstartExample = readRepoFile("terraform/examples/aws-ec2/main.tf");
const dockerCompose = readRepoFile(
  "terraform/stacks/aws-ec2/templates/docker-compose.yml.tpl",
);
const runtimeInstaller = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/runtime-installer.sh.tpl",
);
const refreshSecrets = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/refresh-secrets.sh.tpl",
);
const terraformReadme = readRepoFile("terraform/README.md");
const workflow = readRepoFile(".github/workflows/ci.yml");

describe("Terraform origin-TLS and trusted-edge boundary", () => {
  it("requires an explicit staged cutover, exact ACM ARN, and bounded edge CIDRs", () => {
    expect(stackMain).toContain(
      "origin_name_suffix = substr(sha256(var.name_prefix), 0, 12)",
    );
    expect(stackMain).toContain('origin_lb_name     = "oct-origin-${local.origin_name_suffix}"');
    expect(stackMain).toContain('origin_tg_name     = "oct-app-${local.origin_name_suffix}"');
    expect(stackMain).toContain("name                       = local.origin_lb_name");
    expect(stackMain).toContain("name                 = local.origin_tg_name");
    expect(stackVariables).not.toContain("length(var.name_prefix) <= 25");
    expect(stackMain).not.toMatch(/name\s*=\s*substr\("\$\{var\.name_prefix\}-(?:origin|app)"/);
    expect(stackVariables).toMatch(/variable\s+"origin_tls_cutover_stage"\s*\{/);
    expect(stackVariables).toContain(
      'contains(["preflight", "enforced"], var.origin_tls_cutover_stage)',
    );
    expect(stackVariables).toMatch(/variable\s+"origin_tls_certificate_arn"\s*\{/);
    expect(stackVariables).toMatch(/:acm:/);
    expect(stackVariables).toContain("var.aws_region");
    expect(stackVariables).toMatch(/variable\s+"trusted_edge_ipv4_cidrs"\s*\{/);
    expect(stackVariables).toContain("cidrnetmask");
    expect(stackVariables).toContain('!= "0.0.0.0/0"');
    expect(stackVariables).toMatch(/length\(var\.trusted_edge_ipv4_cidrs\)\s*>\s*0/);
  });

  it("terminates HTTPS on a hardened ALB in both public subnets", () => {
    expect(stackMain).toContain('resource "aws_lb" "origin"');
    expect(stackMain).toMatch(/^\s*subnets\s*=\s*module\.vpc\.public_subnet_ids\s*$/m);
    expect(stackMain).toMatch(/^\s*idle_timeout\s*=\s*900\s*$/m);
    expect(stackMain).toMatch(/^\s*preserve_host_header\s*=\s*true\s*$/m);
    expect(stackMain).toMatch(/^\s*drop_invalid_header_fields\s*=\s*true\s*$/m);
    expect(stackMain).toMatch(/depends_on\s*=\s*\[[\s\S]*?module\.vpc[\s\S]*?aws_vpc_security_group_ingress_rule\.origin_https[\s\S]*?\]/);

    expect(stackMain).toContain('resource "aws_lb_listener" "https"');
    expect(stackMain).toMatch(/^\s*port\s*=\s*443\s*$/m);
    expect(stackMain).toMatch(/^\s*protocol\s*=\s*"HTTPS"\s*$/m);
    expect(stackMain).toMatch(
      /^\s*certificate_arn\s*=\s*var\.origin_tls_certificate_arn\s*$/m,
    );
    expect(stackMain).toMatch(
      /^\s*ssl_policy\s*=\s*"ELBSecurityPolicy-TLS13-1-2-2021-06"\s*$/m,
    );
    expect(stackMain).toMatch(/default_action\s*\{[\s\S]*?type\s*=\s*"fixed-response"[\s\S]*?status_code\s*=\s*"403"/);
    expect(stackMain).toContain('resource "aws_lb_listener_rule" "app_host"');
    expect(stackMain).toMatch(/host_header\s*\{[\s\S]*?values\s*=\s*\[var\.app_domain\]/);
  });

  it("allows only trusted edge HTTPS and only ALB-to-application HTTP", () => {
    expect(stackMain).toContain('resource "aws_security_group" "origin_edge"');
    expect(stackMain).toContain(
      'resource "aws_vpc_security_group_ingress_rule" "origin_https"',
    );
    expect(stackMain).toMatch(
      /^\s*for_each\s*=\s*toset\(var\.trusted_edge_ipv4_cidrs\)\s*$/m,
    );
    expect(stackMain).toMatch(/^\s*cidr_ipv4\s*=\s*each\.value\s*$/m);
    expect(stackMain).toContain(
      'resource "aws_vpc_security_group_egress_rule" "origin_to_app"',
    );
    expect(stackMain).toMatch(
      /^\s*referenced_security_group_id\s*=\s*module\.ec2\.security_group_id\s*$/m,
    );
    expect(stackMain).not.toContain("# Ingress rules: always open 80 + 443");
    expect(stackMain).toContain('var.origin_tls_cutover_stage == "preflight"');
    expect(stackMain).toContain("aws_security_group.origin_edge.id");
    expect(stackMain).not.toMatch(/data\s+"http"/);
    expect(stackVersions).not.toMatch(/source\s*=\s*"hashicorp\/http"/);
    expect(stackVersions).not.toMatch(/source\s*=\s*"cloudflare\/cloudflare"/);
  });

  it("health-gates the current EC2 instance without changing the application port", () => {
    expect(stackMain).toContain('resource "aws_lb_target_group" "app"');
    expect(stackMain).toMatch(/health_check\s*\{[\s\S]*?path\s*=\s*"\/api\/health"/);
    expect(stackMain).toMatch(/health_check\s*\{[\s\S]*?matcher\s*=\s*"200"/);
    expect(stackMain).toMatch(/health_check\s*\{[\s\S]*?timeout\s*=\s*[4-9]/);
    expect(stackMain).toContain('resource "aws_lb_target_group_attachment" "app"');
    expect(stackMain).toMatch(/^\s*target_id\s*=\s*module\.ec2\.instance_id\s*$/m);
    expect(stackMain).toMatch(/target_id\s*=\s*module\.ec2\.instance_id[\s\S]*?port\s*=\s*80/);
  });

  it("preserves the edge HTTPS signal and reconciles nginx config changes", () => {
    expect(stackMain).not.toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    expect(stackMain).not.toContain(
      "proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;",
    );
    expect(stackMain).toContain(
      "proxy_set_header X-Forwarded-Proto $forwarded_proto;",
    );
    expect(stackMain).toMatch(
      /geo\s+\$trusted_origin_proxy\s*\{[\s\S]*?default\s+0;[\s\S]*?\$\{var\.vpc_cidr\}\s+1;[\s\S]*?\}/,
    );
    expect(stackMain).toMatch(
      /map\s+"\$trusted_origin_proxy:\$http_x_forwarded_proto"\s+\$forwarded_proto\s*\{[\s\S]*?default\s+\$scheme;[\s\S]*?"1:https"\s+https;[\s\S]*?\}/,
    );

    const composeHashReconciliation =
      /(?:nginx_config_(?:hash|sha256)|config-sha256)/.test(dockerCompose) &&
      /nginx_config_(?:hash|sha256)/.test(stackMain);
    const validatedReload =
      /nginx\s+-t/.test(runtimeInstaller) &&
      /(?:nginx\s+-s\s+reload|force-recreate[^\n]*nginx)/.test(
        `${runtimeInstaller}\n${refreshSecrets}`,
      );

    expect(composeHashReconciliation || validatedReload).toBe(true);
  });

  it("keeps certificate and private-key values outside Terraform state", () => {
    const productionTerraform = [
      stackMain,
      stackVariables,
      stackOutputs,
      stackTfvarsExample,
      quickstartExample,
    ].join("\n");

    expect(productionTerraform).not.toMatch(/variable\s+"(?:origin_)?tls_(?:certificate|private_key)"/);
    expect(productionTerraform).not.toMatch(/resource\s+"aws_acm_certificate"/);
    expect(productionTerraform).not.toMatch(/^\s*(?:certificate_body|private_key)\s*=/m);
    expect(stackVariables).toMatch(/variable\s+"origin_tls_certificate_arn"\s*\{/);
  });

  it("publishes edge DNS outputs and wires every operator-facing example", () => {
    expect(stackOutputs).toContain('output "origin_dns_name"');
    expect(stackOutputs).toContain('output "origin_hosted_zone_id"');
    expect(stackOutputs).toMatch(
      /output\s+"public_ip"\s*\{[\s\S]*?description\s*=\s*"[^"]*(?:diagnostic|rollback)[^"]*"/i,
    );
    for (const example of [stackTfvarsExample, quickstartExample]) {
      expect(example).toContain("origin_tls_cutover_stage");
      expect(example).toMatch(/origin_tls_cutover_stage\s*=\s*"enforced"/);
      expect(example).toContain("origin_tls_certificate_arn");
      expect(example).toContain("trusted_edge_ipv4_cidrs");
    }
  });

  it("documents the health-gated DNS cutover and rollback before enforcement", () => {
    expect(terraformReadme).toContain("Application Load Balancer");
    expect(terraformReadme).toContain("ACM");
    expect(terraformReadme).toContain("origin_tls_cutover_stage");
    expect(terraformReadme).toContain("Full (strict)");
    expect(terraformReadme).toContain("origin_dns_name");
    expect(terraformReadme).toMatch(/target health/i);
    expect(terraformReadme).toMatch(/rollback/i);
    expect(terraformReadme).toMatch(/preflight[\s\S]*enforced/i);
    expect(terraformReadme).toMatch(/public ACM certificate|Cloudflare Origin CA/i);
    expect(terraformReadme).toMatch(/ACM Private CA[^\n]*not trusted/i);
    expect(terraformReadme).toMatch(/Fresh deployment[\s\S]*origin_tls_cutover_stage = "enforced"/);
    expect(terraformReadme).toContain("do not cryptographically");
    expect(terraformReadme).toContain("address ranges are shared");
    expect(terraformReadme).toContain(
      "per-hostname custom Authenticated Origin Pulls/mTLS",
    );

    const migrationsStep = terraformReadme.indexOf(
      "## Step 5 — Run database migrations",
    );
    const edgeCutoverStep = terraformReadme.indexOf(
      "## Step 6 — Stage origin HTTPS and edge restriction",
    );
    expect(migrationsStep).toBeGreaterThan(-1);
    expect(edgeCutoverStep).toBeGreaterThan(migrationsStep);
    expect(terraformReadme).toMatch(
      /do not route Full \(strict\)[\s\S]{0,100}Elastic IP/i,
    );
  });

  it("runs the static and native Terraform regressions in CI", () => {
    expect(workflow).toContain("terraform-origin-tls-security.test.ts");
    expect(workflow).toContain("terraform -chdir=terraform/stacks/aws-ec2 test");
  });
});
