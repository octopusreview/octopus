import { expect, it } from "bun:test";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

it("restricts queue tests to a dedicated local database", () => {
  expect(localQueueTestDatabaseUrl("postgresql://user:pass@localhost:5432/queue_test"))
    .toBe("postgresql://user:pass@127.0.0.1:5432/queue_test");
  expect(localQueueTestDatabaseUrl("postgres://127.0.0.1/test-db"))
    .toBe("postgres://127.0.0.1/test-db");

  for (const url of [
    undefined,
    "postgresql://production-host/production_test",
    "postgresql://localhost/production",
    "postgresql://localhost/queue_test?host=production-host",
    "postgresql://localhost/queue_test?hostaddr=192.0.2.1",
    "postgresql://localhost/queue_test?dbname=production",
    "postgresql://localhost/queue_test#fragment",
    "https://localhost/queue_test",
  ]) {
    expect(() => localQueueTestDatabaseUrl(url)).toThrow();
  }
});
