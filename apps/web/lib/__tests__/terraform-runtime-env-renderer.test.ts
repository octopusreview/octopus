import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const renderer = resolve(
  repoRoot,
  "terraform/modules/aws/ec2-app/scripts/render_runtime_env.py",
);
const strongAuthSecret = "a".repeat(32);
const strongGithubStateSecret = "g".repeat(32);

const validApplicationSecret = (overrides: Record<string, unknown> = {}) => ({
  BETTER_AUTH_SECRET: strongAuthSecret,
  GITHUB_STATE_SECRET: strongGithubStateSecret,
  ...overrides,
});

function render(input: {
  publicEnvironment?: Record<string, unknown>;
  applicationSecret?: Record<string, unknown>;
  databaseSecret?: Record<string, unknown>;
  databaseConfig?: Record<string, unknown>;
  redisConfig?: Record<string, unknown>;
  redisSecret?: Record<string, unknown>;
}) {
  const directory = mkdtempSync(resolve(tmpdir(), "octopus-runtime-env-"));
  const paths = {
    publicEnvironment: resolve(directory, "public.json"),
    applicationSecret: resolve(directory, "application.json"),
    databaseSecret: resolve(directory, "database.json"),
    databaseConfig: resolve(directory, "database-config.json"),
    redisConfig: resolve(directory, "redis-config.json"),
    redisSecret: resolve(directory, "redis-secret.json"),
    output: resolve(directory, "runtime.env"),
  };

  writeFileSync(
    paths.publicEnvironment,
    JSON.stringify(input.publicEnvironment ?? { NEXT_PUBLIC_APP_URL: "https://octopus.example" }),
  );
  writeFileSync(
    paths.applicationSecret,
    JSON.stringify(input.applicationSecret ?? validApplicationSecret()),
  );
  writeFileSync(
    paths.databaseSecret,
    JSON.stringify(input.databaseSecret ?? { username: "octopus", password: "db-secret" }),
  );
  writeFileSync(
    paths.databaseConfig,
    JSON.stringify(
      input.databaseConfig ?? { host: "db.internal", port: 5432, database: "octopus" },
    ),
  );

  if (input.redisConfig !== undefined) {
    writeFileSync(paths.redisConfig, JSON.stringify(input.redisConfig));
  }
  if (input.redisSecret !== undefined) {
    writeFileSync(paths.redisSecret, JSON.stringify(input.redisSecret));
  }

  const args = [
    "python3",
    renderer,
    "--public-environment",
    paths.publicEnvironment,
    "--application-secret",
    paths.applicationSecret,
    "--database-secret",
    paths.databaseSecret,
    "--database-config",
    paths.databaseConfig,
  ];
  if (input.redisConfig !== undefined) {
    args.push("--redis-config", paths.redisConfig);
  }
  if (input.redisSecret !== undefined) {
    args.push("--redis-secret", paths.redisSecret);
  }
  args.push("--output", paths.output);

  const result = Bun.spawnSync(args);

  return { directory, paths, result };
}

function validateRedisSecret(redisSecret: Record<string, unknown>) {
  const directory = mkdtempSync(resolve(tmpdir(), "octopus-redis-secret-validation-"));
  const redisSecretPath = resolve(directory, "redis.json");
  writeFileSync(redisSecretPath, JSON.stringify(redisSecret));

  const result = Bun.spawnSync([
    "python3",
    renderer,
    "--validate-redis-secret-only",
    redisSecretPath,
  ]);

  return { redisSecretPath, result };
}

function validateApplicationSecret(applicationSecret: Record<string, unknown>) {
  const directory = mkdtempSync(resolve(tmpdir(), "octopus-runtime-secret-validation-"));
  const applicationSecretPath = resolve(directory, "application.json");
  writeFileSync(applicationSecretPath, JSON.stringify(applicationSecret));

  const result = Bun.spawnSync([
    "python3",
    renderer,
    "--validate-application-secret-only",
    applicationSecretPath,
  ]);

  return { applicationSecretPath, result };
}

describe("Terraform runtime environment renderer", () => {
  it("preserves special characters, encodes PEM files, and writes mode 0600", () => {
    const databasePassword = "db p@ss/$#[]:?";
    const providerKey = "sk-${NOT_EXPANDED}-$#\\\"quoted\"";
    const pem = "-----BEGIN PRIVATE KEY-----\nline-one\nENV_EOF\n-----END PRIVATE KEY-----\n";
    const { paths, result } = render({
      publicEnvironment: {
        ADMIN_EMAILS: "owner+security@example.com",
        NEXT_PUBLIC_APP_URL: "https://octopus.example/${LITERAL}",
      },
      applicationSecret: {
        ...validApplicationSecret(),
        GITHUB_APP_PRIVATE_KEY: pem,
        OCTOPUS_DATA_KEY: "a".repeat(64),
        OPENAI_API_KEY: providerKey,
      },
      databaseSecret: { username: "octo user", password: databasePassword },
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).not.toContain(databasePassword);
    expect(stderr).not.toContain(databasePassword);
    expect(stdout).not.toContain(providerKey);
    expect(stderr).not.toContain(providerKey);

    const output = readFileSync(paths.output, "utf8");
    expect(output).toContain(`OPENAI_API_KEY=${providerKey}\n`);
    expect(output).toContain("NEXT_PUBLIC_APP_URL=https://octopus.example/${LITERAL}\n");
    expect(output).toContain(
      "DATABASE_URL=postgresql://octo%20user:db%20p%40ss%2F%24%23%5B%5D%3A%3F@db.internal:5432/octopus?sslmode=require\n",
    );
    expect(output).toContain(
      `GITHUB_APP_PRIVATE_KEY=${Buffer.from(pem).toString("base64")}\n`,
    );
    expect(statSync(paths.output).mode & 0o777).toBe(0o600);
  });

  it("constructs a TLS Redis URL from dedicated config and secret inputs", () => {
    const redisPassword = "Redis9!&#$^<>-Token";
    const { paths, result } = render({
      redisConfig: {
        enabled: true,
        host: "octopus-redis.example.cache.amazonaws.com",
        port: 6379,
        username: "octopus-app",
      },
      redisSecret: { password: redisPassword },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain(redisPassword);
    expect(result.stderr.toString()).not.toContain(redisPassword);

    const output = readFileSync(paths.output, "utf8");
    expect(output).toContain(
      "REDIS_URL=rediss://octopus-app:Redis9%21%26%23%24%5E%3C%3E-Token@octopus-redis.example.cache.amazonaws.com:6379\n",
    );
    expect(output).not.toContain("REDIS_PASSWORD=");
  });

  it("omits Redis runtime values when Redis is not configured", () => {
    const { paths, result } = render({
      redisConfig: { enabled: false, host: "", port: 0, username: "" },
    });

    expect(result.exitCode).toBe(0);
    const output = readFileSync(paths.output, "utf8");
    expect(output).not.toContain("REDIS_URL=");
    expect(output).not.toContain("REDIS_PASSWORD=");
  });

  it("requires an exact Redis config and secret schema when enabled", () => {
    const cases = [
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "octopus-app",
        },
      },
      {
        redisSecret: { password: "Redis9!&#$^<>-Token" },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
        },
        redisSecret: { password: "Redis9!&#$^<>-Token" },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "octopus-app",
          unexpected: true,
        },
        redisSecret: { password: "Redis9!&#$^<>-Token" },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "octopus-app",
        },
        redisSecret: {
          password: "Redis9!&#$^<>-Token",
          unexpected: "value",
        },
      },
    ];

    for (const testCase of cases) {
      const { paths, result } = render(testCase);
      expect(result.exitCode).not.toBe(0);
      expect(() => readFileSync(paths.output, "utf8")).toThrow();
    }
  });

  it("rejects invalid Redis passwords, usernames, hosts, and ports", () => {
    const validPassword = "Redis9!&#$^<>-Token";
    const cases = [
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "octopus-app",
        },
        redisSecret: { password: "too-short" },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "octopus-app",
        },
        redisSecret: { password: "RedisPasswordWith@ForbiddenCharacter9" },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal/path",
          port: 6379,
          username: "octopus-app",
        },
        redisSecret: { password: validPassword },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 0,
          username: "octopus-app",
        },
        redisSecret: { password: validPassword },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: "6379",
          username: "octopus-app",
        },
        redisSecret: { password: validPassword },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "invalid username",
        },
        redisSecret: { password: validPassword },
      },
      {
        redisConfig: {
          enabled: true,
          host: "redis.internal",
          port: 6379,
          username: "a".repeat(41),
        },
        redisSecret: { password: validPassword },
      },
    ];

    for (const testCase of cases) {
      const { paths, result } = render(testCase);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).not.toContain(validPassword);
      expect(() => readFileSync(paths.output, "utf8")).toThrow();
    }
  });

  it("rejects public or secret attempts to supply a complete Redis URL", () => {
    const attempts = [
      render({
        publicEnvironment: { REDIS_URL: "rediss://:attacker@redis.internal:6379" },
      }),
      render({
        publicEnvironment: { REDIS_PASSWORD: "Redis9!&#$^<>-Token" },
      }),
      render({
        applicationSecret: validApplicationSecret({
          REDIS_URL: "rediss://:attacker@redis.internal:6379",
        }),
      }),
      render({
        applicationSecret: validApplicationSecret({
          REDIS_PASSWORD: "Redis9!&#$^<>-Token",
        }),
      }),
    ];

    for (const { paths, result } of attempts) {
      expect(result.exitCode).not.toBe(0);
      expect(() => readFileSync(paths.output, "utf8")).toThrow();
    }
  });

  it("fails closed on unknown secret keys without replacing an existing env", () => {
    const { paths, result } = render({
      applicationSecret: validApplicationSecret({ DATABASE_URL: "attacker-controlled" }),
    });
    writeFileSync(paths.output, "SAFE=existing\n");
    chmodSync(paths.output, 0o600);

    const retry = Bun.spawnSync([
      "python3",
      renderer,
      "--public-environment",
      paths.publicEnvironment,
      "--application-secret",
      paths.applicationSecret,
      "--database-secret",
      paths.databaseSecret,
      "--database-config",
      paths.databaseConfig,
      "--output",
      paths.output,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(retry.exitCode).not.toBe(0);
    expect(readFileSync(paths.output, "utf8")).toBe("SAFE=existing\n");
    expect(retry.stderr.toString()).not.toContain("attacker-controlled");
  });

  it("rejects line breaks outside the private-key normalization path", () => {
    const sentinel = "token\nENV_EOF\necho-pwned";
    const { paths, result } = render({
      applicationSecret: validApplicationSecret({ OPENAI_API_KEY: sentinel }),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).not.toContain(sentinel);
    expect(() => readFileSync(paths.output, "utf8")).toThrow();
  });

  it("rejects invalid persistent-data and GitHub state keys", () => {
    const invalidDataKey = render({
      applicationSecret: validApplicationSecret({ OCTOPUS_DATA_KEY: "too-short" }),
    });
    const invalidStateKey = render({
      applicationSecret: {
        BETTER_AUTH_SECRET: strongAuthSecret,
        GITHUB_STATE_SECRET: "too-short",
      },
    });

    expect(invalidDataKey.result.exitCode).not.toBe(0);
    expect(invalidStateKey.result.exitCode).not.toBe(0);
  });

  it("requires strong auth and GitHub state secrets", () => {
    const cases = [
      { GITHUB_STATE_SECRET: strongGithubStateSecret },
      { BETTER_AUTH_SECRET: "too-short", GITHUB_STATE_SECRET: strongGithubStateSecret },
      { BETTER_AUTH_SECRET: strongAuthSecret },
      { BETTER_AUTH_SECRET: strongAuthSecret, GITHUB_STATE_SECRET: "too-short" },
    ];

    for (const applicationSecret of cases) {
      const { result } = validateApplicationSecret(applicationSecret);
      expect(result.exitCode).not.toBe(0);
    }
  });

  it("supports validate-only mode without database or output arguments", () => {
    const sentinel = "provider-token-${NOT_EXPANDED}";
    const { result } = validateApplicationSecret(
      validApplicationSecret({ OPENAI_API_KEY: sentinel }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain(sentinel);
    expect(result.stderr.toString()).not.toContain(sentinel);
  });

  it("validates the dedicated Redis secret without render inputs", () => {
    const password = "Redis9!&#$^<>-Token";
    const valid = validateRedisSecret({ password });
    const invalidPassword = validateRedisSecret({ password: "too-short" });
    const invalidSchema = validateRedisSecret({ password, extra: "value" });

    expect(valid.result.exitCode).toBe(0);
    expect(invalidPassword.result.exitCode).not.toBe(0);
    expect(invalidSchema.result.exitCode).not.toBe(0);
    expect(valid.result.stdout.toString()).not.toContain(password);
    expect(valid.result.stderr.toString()).not.toContain(password);
  });
});
