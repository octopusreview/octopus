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
}) {
  const directory = mkdtempSync(resolve(tmpdir(), "octopus-runtime-env-"));
  const paths = {
    publicEnvironment: resolve(directory, "public.json"),
    applicationSecret: resolve(directory, "application.json"),
    databaseSecret: resolve(directory, "database.json"),
    databaseConfig: resolve(directory, "database-config.json"),
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

  const result = Bun.spawnSync([
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

  return { directory, paths, result };
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
});
