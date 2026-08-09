import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const redisMain = readRepoFile("terraform/modules/aws/elasticache-redis/main.tf");
const redisAuth = readRepoFile("terraform/modules/aws/elasticache-redis/auth.tf");
const redisVariables = readRepoFile("terraform/modules/aws/elasticache-redis/variables.tf");
const redisOutputs = readRepoFile("terraform/modules/aws/elasticache-redis/outputs.tf");
const redisTerraform = [redisMain, redisAuth, redisVariables, redisOutputs].join("\n");
const stackMain = readRepoFile("terraform/stacks/aws-ec2/main.tf");
const stackVariables = readRepoFile("terraform/stacks/aws-ec2/variables.tf");
const stackOutputs = readRepoFile("terraform/stacks/aws-ec2/outputs.tf");
const stackExample = readRepoFile("terraform/stacks/aws-ec2/terraform.tfvars.example");
const ec2Main = readRepoFile("terraform/modules/aws/ec2-app/main.tf");
const ec2Variables = readRepoFile("terraform/modules/aws/ec2-app/variables.tf");
const refreshScript = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/refresh-secrets.sh.tpl",
);
const preflightScript = readRepoFile(
  "terraform/modules/aws/ec2-app/templates/preflight-runtime-secrets.sh.tpl",
);
const redisProbe = readRepoFile("terraform/modules/aws/ec2-app/scripts/probe_redis.js");
const redisClient = readRepoFile("apps/web/lib/redis.ts");
const cancelBus = readRepoFile("apps/web/lib/cancel-bus.ts");
const terraformReadme = readRepoFile("terraform/README.md");

const terraformBoundary = [
  redisTerraform,
  stackMain,
  stackVariables,
  stackOutputs,
  stackExample,
  ec2Main,
  ec2Variables,
].join("\n");

describe("Terraform Redis authentication boundary", () => {
  it("keeps the Redis password out of Terraform state, plans, outputs, and user data", () => {
    expect(redisAuth).toContain('resource "aws_cloudformation_stack" "redis_auth"');
    expect(redisAuth).toContain("{{resolve:secretsmanager:");
    expect(redisAuth).toContain("redis_auth_secret_version_ids");
    expect(redisTerraform).not.toMatch(/resource\s+"aws_elasticache_user"/);
    expect(terraformBoundary).not.toMatch(/(?:data|resource)\s+"aws_secretsmanager_secret_version"/);
    expect(terraformBoundary).not.toMatch(/^\s*auth_token\s*=/m);
    expect(terraformBoundary).not.toMatch(/^\s*passwords?\s*=/m);
    expect(stackOutputs).not.toMatch(/output\s+"redis_url"/);
    expect(redisOutputs).not.toMatch(/rediss:\/\//);
    expect(stackMain).not.toContain("module.redis[0].connection_url");
  });

  it("uses an exact-secret CloudFormation role and a stable RBAC user group", () => {
    expect(redisAuth).toContain('resource "aws_iam_role" "redis_auth_cloudformation"');
    expect(redisAuth).toContain("cloudformation.amazonaws.com");
    expect(redisAuth).toContain("secretsmanager:GetSecretValue");
    expect(redisAuth).toContain("var.redis_auth_secret_arn");
    expect(redisAuth).toContain("kms:ViaService");
    expect(redisAuth).toContain('"AWS::ElastiCache::User"');
    expect(redisAuth).toContain('"AWS::ElastiCache::UserGroup"');
    expect(redisMain).toContain("user_group_ids");
    expect(redisMain).toContain("depends_on");
  });

  it("attaches compatibility and enforced memberships without replacing Redis", () => {
    expect(redisVariables).toContain('variable "redis_auth_cutover_stage"');
    expect(redisVariables).toContain('contains(["preflight", "enforced"]');
    expect(redisVariables).not.toMatch(
      /variable "redis_auth_cutover_stage" \{[\s\S]*?default\s*=\s*"preflight"[\s\S]*?\n\}/,
    );
    expect(stackVariables).not.toMatch(
      /variable "redis_auth_cutover_stage" \{[\s\S]*?default\s*=\s*"preflight"[\s\S]*?\n\}/,
    );
    expect(ec2Variables).not.toMatch(
      /variable "redis_auth_cutover_stage" \{[\s\S]*?default\s*=\s*"preflight"[\s\S]*?\n\}/,
    );
    expect(redisAuth).toMatch(/redis_auth_cutover_stage\s*==\s*"preflight"/);
    expect(redisAuth).toContain('"default"');
    expect(redisAuth).toContain("DisabledDefaultUser");
    expect(redisAuth).toContain("ApplicationUser");
    expect(redisAuth).toContain('AccessString = "off ~* -@all"');
    expect(redisTerraform).not.toMatch(/create_before_destroy\s*=\s*false/);
    expect(stackVariables).toContain('variable "redis_authenticated_runtime_ready"');
    expect(stackMain).toContain("var.redis_authenticated_runtime_ready");
  });

  it("fetches the dedicated Redis secret only at runtime and renders an authenticated URL", () => {
    expect(stackVariables).toContain('variable "redis_auth_secret_arn"');
    expect(stackVariables).toContain('variable "redis_auth_secret_version_ids"');
    expect(ec2Variables).toContain('variable "redis_secret_arn"');
    expect(ec2Main).toContain("var.redis_secret_arn");
    expect(refreshScript).toContain("REDIS_SECRET_ARN");
    expect(refreshScript).toContain('fetch_secret "$REDIS_SECRET_ARN"');
    expect(refreshScript).toContain("--redis-secret");
    expect(refreshScript).toContain("--redis-config");
    expect(refreshScript).toContain("redis_probe_required");
    expect(refreshScript).toContain("OCTOPUS_REDIS_PROBE_RUN=1");
    expect(refreshScript).toContain("OCTOPUS_REDIS_AUTH_ENFORCED");
    expect(refreshScript).toContain("run --rm --no-deps -T");
    expect(refreshScript).toContain("web node -");
    expect(preflightScript).toContain("--validate-redis-secret-only");
    expect(stackMain).not.toMatch(/REDIS_PASSWORD\s*=/);
  });

  it("keeps ioredis readiness without granting broad CLIENT permissions", () => {
    expect(redisClient).toContain("disableClientInfo: true");
    expect(cancelBus.match(/disableClientInfo:\s*true/g)).toHaveLength(2);
    expect(redisAuth).toContain("+info");
    expect(redisAuth).not.toContain("+client");
  });

  it("probes authenticated command, key, channel, and denial boundaries", () => {
    expect(redisProbe).toContain("rl:avatar-upload:redis-probe:");
    expect(redisProbe).toContain("mx:v1:redis-probe:");
    expect(redisProbe).toContain("presence:redis-probe:");
    expect(redisProbe).toContain("presence:index:redis-probe:");
    expect(redisProbe).toContain("gh:install:state:jti:redis-probe:");
    expect(redisProbe).toContain('const channel = "octopus:probe"');
    expect(redisProbe).toContain("foreign:redis-probe:");
    expect(redisProbe).toContain('error.message.includes("NOPERM")');
    expect(redisProbe).toContain("OCTOPUS_REDIS_AUTH_ENFORCED");
    expect(redisProbe).toContain("/^NOAUTH");
    expect(redisProbe).not.toMatch(/NOAUTH\|WRONGPASS|NOAUTH\|NOPERM/);
    expect(redisProbe).toContain('this.socket.on("close"');
    expect(redisProbe).toContain("withDeadline(probe(), 30000)");
    expect(redisProbe).not.toContain("console.");
    expect(redisAuth).not.toContain("+scan");
    for (const command of ["+zadd", "+zrem", "+zremrangebyscore", "+zrangebyscore"]) {
      expect(redisAuth).toContain(command);
    }
  });

  it("documents the compatibility gate, enforcement proof, rollback, and rotation order", () => {
    expect(stackExample).toContain("redis_auth_cutover_stage");
    expect(stackExample).toContain("redis_authenticated_runtime_ready");
    expect(terraformReadme).toContain("Redis authentication cutover");
    expect(terraformReadme).toContain("unauthenticated");
    expect(terraformReadme).toContain("Rollback");
    expect(terraformReadme).toContain("Rotate");
  });
});
