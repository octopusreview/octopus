import assert from "node:assert/strict";

export function assertDisposableIndexDatabase() {
  const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
  assert.equal(db.hostname, "127.0.0.1");
  assert.ok(["/octopus_index_rate_test", "/octopus_index_migration_test"].includes(db.pathname));
  assert.equal(db.search + db.hash, "");
  const container = process.env.OCTOPUS_INDEX_TEST_CONTAINER ?? "";
  assert.match(container, /^octopus-index-rate-test-[0-9a-f]{24}$/);
  const result = Bun.spawnSync(["docker", "inspect", container]);
  assert.equal(result.exitCode, 0, "disposable PostgreSQL container must exist");
  const [info] = JSON.parse(result.stdout.toString());
  assert.equal(info.State.Running, true);
  assert.equal(info.HostConfig.AutoRemove, true);
  assert.equal(info.Config.Image, "postgres:16-alpine");
  assert.equal(info.Config.Labels?.["octopus.synthetic-index-test"], "true");
  assert.ok(info.Config.Env.includes(`POSTGRES_PASSWORD=${decodeURIComponent(db.password)}`));
  assert.equal(db.username, "postgres");
  assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: db.port }]);
}
