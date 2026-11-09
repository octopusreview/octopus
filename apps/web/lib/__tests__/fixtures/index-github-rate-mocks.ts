import { mock } from "bun:test";

// These isolated tests exercise indexing behavior; database coordination has separate integration tests.
mock.module("@/lib/github-index-rate-scope", () => ({ githubIndexRateScope: async () => "github-index-installation:1" }));
mock.module("@/lib/github-index-rate-state", () => ({
  admitIndexRequest: async () => ({ kind: "open" }),
  recordIndexRateLimit: async () => ({ paused: false }),
  completeIndexRateProbe: async () => true,
}));
