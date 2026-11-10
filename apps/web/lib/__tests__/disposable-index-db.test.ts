import { expect, it } from "bun:test";
import { assertDisposableIndexDatabase } from "./fixtures/disposable-index-db";

it("rejects a persistent loopback test database before connecting", () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalContainer = process.env.OCTOPUS_INDEX_TEST_CONTAINER;
  try {
    process.env.DATABASE_URL = "postgresql://postgres:secret@127.0.0.1:5432/octopus_index_rate_test";
    delete process.env.OCTOPUS_INDEX_TEST_CONTAINER;
    expect(() => assertDisposableIndexDatabase()).toThrow();
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalContainer === undefined) delete process.env.OCTOPUS_INDEX_TEST_CONTAINER;
    else process.env.OCTOPUS_INDEX_TEST_CONTAINER = originalContainer;
  }
});
