import { mock } from "bun:test";

// These isolated tests exercise indexing behavior; database coordination has separate integration tests.
mock.module("@/lib/github-index-rate-scope", () => ({ githubIndexRateScope: async () => "github-index-installation:1" }));
export const rateAdmission = { kind: "open" };
mock.module("@/lib/github-index-rate-state", () => ({
  admitIndexRequest: async () => rateAdmission,
  recordIndexRateLimit: async () => ({ paused: false }),
  completeIndexRateProbe: async () => true,
  deferPrimaryVerification: async () => true,
}));
