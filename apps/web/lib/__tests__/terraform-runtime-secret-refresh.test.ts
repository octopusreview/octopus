import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const renderer = resolve(
  repoRoot,
  "terraform/modules/aws/ec2-app/scripts/render_runtime_env.py",
);
const refreshTemplate = readFileSync(
  resolve(repoRoot, "terraform/modules/aws/ec2-app/templates/refresh-secrets.sh.tpl"),
  "utf8",
);

const encoded = (value: string) => Buffer.from(value).toString("base64");
const strongAuthSecret = "a".repeat(32);
const strongGithubStateSecret = "g".repeat(32);

const validApplicationSecret = (overrides: Record<string, unknown> = {}) => ({
  BETTER_AUTH_SECRET: strongAuthSecret,
  GITHUB_STATE_SECRET: strongGithubStateSecret,
  ...overrides,
});

function createHarness() {
  const root = mkdtempSync(resolve(tmpdir(), "octopus-secret-refresh-"));
  const bin = resolve(root, "bin");
  const runtimeDirectory = resolve(root, "run/octopus");
  const appDirectory = resolve(root, "opt/octopus");
  const applicationSecret = resolve(root, "application.json");
  const databaseSecret = resolve(root, "database.json");
  const dockerCalls = resolve(root, "docker-calls.log");
  const refreshScript = resolve(root, "refresh-secrets.sh");
  mkdirSync(bin, { recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(resolve(appDirectory, "docker-compose.yml"), "services: {}\n");
  writeFileSync(dockerCalls, "");

  writeFileSync(
    resolve(bin, "aws"),
    `#!/bin/bash
set -euo pipefail
secret_id=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--secret-id" ]; then
    secret_id=$2
    break
  fi
  shift
done
if [ "$secret_id" = "$FAKE_APPLICATION_SECRET_ARN" ]; then
  /bin/cat "$FAKE_APPLICATION_SECRET_FILE"
else
  /bin/cat "$FAKE_DATABASE_SECRET_FILE"
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    resolve(bin, "docker"),
    `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_CALLS"
if [[ "$*" == *"compose version"* ]]; then
  if [[ "$*" == *"--short"* ]]; then
    printf '%s\n' "$FAKE_COMPOSE_VERSION"
  else
    printf 'Docker Compose version v%s\n' "$FAKE_COMPOSE_VERSION"
  fi
  exit 0
fi
if [[ "$*" == *" config"* ]] && [ "$FAKE_DOCKER_CONFIG_FAIL" = "1" ]; then
  exit 41
fi
if [[ "$*" == *" config --services"* ]]; then
  printf 'nginx\nqdrant\nweb\n'
fi
if [[ "$*" == *" ps "* ]] && [ "$FAKE_STACK_RUNNING" = "1" ]; then
  printf 'nginx\nqdrant\nweb\n'
elif [[ "$*" == *" ps "* ]] && [ "$FAKE_WEB_RUNNING" = "1" ]; then
  printf 'web\n'
fi
if [[ "$*" == *" up "* ]] && [ "$FAKE_DOCKER_UP_FAIL" = "1" ]; then
  exit 42
fi
if [[ "$*" == *" up "* ]] && [[ "$*" == *" --wait"* ]] && [ "$FAKE_DOCKER_WAIT_FAIL" = "1" ]; then
  exit 43
fi
if [[ "$*" == *" up "* ]] && [[ "$*" == *" --wait"* ]] && [[ "$*" != *" web" ]] && [ "$FAKE_DOCKER_FULL_WAIT_FAIL" = "1" ]; then
  exit 44
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    resolve(bin, "dpkg"),
    `#!/bin/bash
set -euo pipefail
if [ "$1" != "--compare-versions" ] || [ "$3" != "ge" ]; then
  exit 2
fi
IFS=. read -r actual_major actual_minor actual_patch <<< "$2"
IFS=. read -r minimum_major minimum_minor minimum_patch <<< "$4"
if (( actual_major > minimum_major ||
      (actual_major == minimum_major && actual_minor > minimum_minor) ||
      (actual_major == minimum_major && actual_minor == minimum_minor && actual_patch >= minimum_patch) )); then
  exit 0
fi
exit 1
`,
    { mode: 0o700 },
  );
  writeFileSync(resolve(bin, "flock"), "#!/bin/bash\nexit 0\n", { mode: 0o700 });

  const publicEnvironment = {
    NEXT_PUBLIC_APP_URL: "https://octopus.example/${LITERAL}",
  };
  const databaseConfig = { host: "db.internal", port: 5432, database: "octopus" };
  const rendered = refreshTemplate
    .replaceAll("${aws_region_base64}", encoded("us-east-1"))
    .replaceAll("${application_secret_arn_base64}", encoded("arn:application"))
    .replaceAll("${database_secret_arn_base64}", encoded("arn:database"))
    .replaceAll("${public_environment_base64}", encoded(JSON.stringify(publicEnvironment)))
    .replaceAll("${database_config_base64}", encoded(JSON.stringify(databaseConfig)))
    .replaceAll("$${", "${")
    .replace("RUNTIME_DIRECTORY=/run/octopus", `RUNTIME_DIRECTORY=${runtimeDirectory}`)
    .replace("APP_DIRECTORY=/opt/octopus", `APP_DIRECTORY=${appDirectory}`)
    .replace("/usr/local/lib/octopus/render_runtime_env.py", renderer);
  writeFileSync(refreshScript, rendered, { mode: 0o700 });

  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_APPLICATION_SECRET_ARN: "arn:application",
    FAKE_APPLICATION_SECRET_FILE: applicationSecret,
    FAKE_DATABASE_SECRET_FILE: databaseSecret,
    FAKE_DOCKER_CALLS: dockerCalls,
    FAKE_COMPOSE_VERSION: "2.30.0",
    FAKE_DOCKER_CONFIG_FAIL: "0",
    FAKE_DOCKER_FULL_WAIT_FAIL: "0",
    FAKE_DOCKER_UP_FAIL: "0",
    FAKE_DOCKER_WAIT_FAIL: "0",
    FAKE_STACK_RUNNING: "1",
    FAKE_WEB_RUNNING: "1",
  };

  const run = () => Bun.spawnSync(["bash", refreshScript], { env: environment });
  const bootstrap = () =>
    Bun.spawnSync(["bash", refreshScript], {
      env: { ...environment, OCTOPUS_BOOTSTRAP: "1" },
    });
  return {
    applicationSecret,
    bootstrap,
    databaseSecret,
    dockerCalls,
    environment,
    reconcileStamp: resolve(runtimeDirectory, "reconcile-required"),
    run,
    runtimeEnv: resolve(runtimeDirectory, "runtime.env"),
  };
}

describe("Terraform runtime secret refresh", () => {
  it("keeps values out of logs and recreates web only when values change", () => {
    const harness = createHarness();
    const applicationSentinel = `${"a".repeat(32)}-$#-\${NOT_EXPANDED}`;
    const firstDatabaseSentinel = "database-first-$#";
    const secondDatabaseSentinel = "database-second-$#";
    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(
        validApplicationSecret({
          BETTER_AUTH_SECRET: applicationSentinel,
        }),
      ),
    );
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: firstDatabaseSentinel }),
    );

    const first = harness.bootstrap();
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).not.toContain(applicationSentinel);
    expect(first.stderr.toString()).not.toContain(applicationSentinel);
    expect(readFileSync(harness.dockerCalls, "utf8")).not.toContain("force-recreate");
    expect(statSync(harness.runtimeEnv).mode & 0o777).toBe(0o600);

    const unchanged = harness.run();
    expect(unchanged.exitCode).toBe(0);
    expect(readFileSync(harness.dockerCalls, "utf8")).not.toContain("force-recreate");

    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: secondDatabaseSentinel }),
    );
    const changed = harness.run();
    expect(changed.exitCode).toBe(0);
    expect(changed.stdout.toString()).not.toContain(secondDatabaseSentinel);
    expect(changed.stderr.toString()).not.toContain(secondDatabaseSentinel);
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain(
      "up -d --no-deps --force-recreate --wait --wait-timeout 120 web",
    );
    expect(readFileSync(harness.runtimeEnv, "utf8")).toContain(
      ":database-second-%24%23@db.internal",
    );
  });

  it("preserves the last good environment when validation fails", () => {
    const harness = createHarness();
    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(validApplicationSecret()),
    );
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "valid-database" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);
    const lastGood = readFileSync(harness.runtimeEnv, "utf8");

    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(validApplicationSecret({ DATABASE_URL: "do-not-log-me" })),
    );
    writeFileSync(harness.dockerCalls, "");
    const invalid = harness.run();

    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr.toString()).not.toContain("do-not-log-me");
    expect(readFileSync(harness.runtimeEnv, "utf8")).toBe(lastGood);
    const calls = readFileSync(harness.dockerCalls, "utf8");
    expect(calls).toContain("compose version --short");
    expect(calls).not.toContain(" config");
    expect(calls).not.toContain(" up ");
  });

  it("preserves last-good env for an application-only Compose validation failure", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);
    const lastGood = readFileSync(harness.runtimeEnv, "utf8");

    harness.environment.FAKE_DOCKER_CONFIG_FAIL = "1";
    writeFileSync(harness.dockerCalls, "");
    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(validApplicationSecret({ OPENAI_API_KEY: "provider-second" })),
    );
    const failed = harness.run();

    expect(failed.exitCode).not.toBe(0);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toBe(lastGood);
    expect(existsSync(harness.reconcileStamp)).toBe(true);
    const calls = readFileSync(harness.dockerCalls, "utf8");
    expect(calls).toContain(" config");
    expect(calls).not.toContain(" up ");
  });

  it("retains a rotated database credential when Compose validation fails", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);

    harness.environment.FAKE_DOCKER_CONFIG_FAIL = "1";
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-second" }),
    );
    const failed = harness.run();

    expect(failed.exitCode).not.toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(true);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toContain(
      "octopus:database-second@db.internal",
    );
    expect(readFileSync(harness.dockerCalls, "utf8")).not.toContain(" up ");
  });

  it("rolls back an application-only change after docker up failure and retries it", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);
    const lastGood = readFileSync(harness.runtimeEnv, "utf8");

    harness.environment.FAKE_DOCKER_UP_FAIL = "1";
    writeFileSync(harness.dockerCalls, "");
    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(validApplicationSecret({ OPENAI_API_KEY: "provider-second" })),
    );
    const failed = harness.run();

    expect(failed.exitCode).not.toBe(0);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toBe(lastGood);
    expect(existsSync(harness.reconcileStamp)).toBe(true);
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain(" up -d");

    harness.environment.FAKE_DOCKER_UP_FAIL = "0";
    writeFileSync(harness.dockerCalls, "");
    const retried = harness.run();

    expect(retried.exitCode).toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(false);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toContain(
      "OPENAI_API_KEY=provider-second",
    );
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain(
      "up -d --no-deps --force-recreate --wait --wait-timeout 120 web",
    );
  });

  it("rolls back an application-only change when web never becomes healthy", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);
    const lastGood = readFileSync(harness.runtimeEnv, "utf8");

    harness.environment.FAKE_DOCKER_WAIT_FAIL = "1";
    writeFileSync(
      harness.applicationSecret,
      JSON.stringify(validApplicationSecret({ OPENAI_API_KEY: "unhealthy-change" })),
    );
    const failed = harness.run();

    expect(failed.exitCode).not.toBe(0);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toBe(lastGood);
    expect(existsSync(harness.reconcileStamp)).toBe(true);
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain(
      "--wait --wait-timeout 120 web",
    );
  });

  it("retains a rotated database credential after docker up failure and retries it", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);

    harness.environment.FAKE_DOCKER_UP_FAIL = "1";
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-second" }),
    );
    const failed = harness.run();

    expect(failed.exitCode).not.toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(true);
    expect(readFileSync(harness.runtimeEnv, "utf8")).toContain(
      "octopus:database-second@db.internal",
    );

    harness.environment.FAKE_DOCKER_UP_FAIL = "0";
    const retried = harness.run();
    expect(retried.exitCode).toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(false);
  });

  it("recreates a stopped web container even when secrets are unchanged", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);

    harness.environment.FAKE_WEB_RUNNING = "0";
    harness.environment.FAKE_STACK_RUNNING = "0";
    writeFileSync(harness.dockerCalls, "");
    const reconciled = harness.run();

    expect(reconciled.exitCode).toBe(0);
    const calls = readFileSync(harness.dockerCalls, "utf8");
    expect(calls.split("\n").some((line) => line.endsWith(" up -d"))).toBe(true);
    expect(calls).toContain(
      "up -d --no-deps --force-recreate --wait --wait-timeout 120 web",
    );
    expect(readFileSync(harness.runtimeEnv, "utf8")).toContain(
      "octopus:database-first@db.internal",
    );
  });

  it("keeps retrying the full stack after a partial recovery", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );
    expect(harness.bootstrap().exitCode).toBe(0);

    harness.environment.FAKE_WEB_RUNNING = "0";
    harness.environment.FAKE_STACK_RUNNING = "0";
    harness.environment.FAKE_DOCKER_FULL_WAIT_FAIL = "1";
    const partial = harness.run();
    expect(partial.exitCode).not.toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(true);

    harness.environment.FAKE_WEB_RUNNING = "1";
    harness.environment.FAKE_STACK_RUNNING = "0";
    harness.environment.FAKE_DOCKER_FULL_WAIT_FAIL = "0";
    writeFileSync(harness.dockerCalls, "");
    const recovered = harness.run();

    expect(recovered.exitCode).toBe(0);
    expect(existsSync(harness.reconcileStamp)).toBe(false);
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain(
      "up -d --wait --wait-timeout 180",
    );
  });

  it("requires Docker Compose 2.30 or newer before rendering runtime secrets", () => {
    const harness = createHarness();
    writeFileSync(harness.applicationSecret, JSON.stringify(validApplicationSecret()));
    writeFileSync(
      harness.databaseSecret,
      JSON.stringify({ username: "octopus", password: "database-first" }),
    );

    harness.environment.FAKE_COMPOSE_VERSION = "2.29.9";
    const unsupported = harness.run();
    expect(unsupported.exitCode).not.toBe(0);
    expect(existsSync(harness.runtimeEnv)).toBe(false);
    expect(readFileSync(harness.dockerCalls, "utf8")).toContain("compose version");

    harness.environment.FAKE_COMPOSE_VERSION = "2.30.0";
    writeFileSync(harness.dockerCalls, "");
    const supported = harness.run();
    expect(supported.exitCode).toBe(0);
    expect(existsSync(harness.runtimeEnv)).toBe(true);
  });
});
