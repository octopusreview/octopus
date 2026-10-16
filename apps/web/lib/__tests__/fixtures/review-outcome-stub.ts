import { mock } from "bun:test";

// Existing isolated review harnesses have no outcome table. Exercise their
// original concern; the PostgreSQL outcome harness tests recording separately.
mock.module("@/lib/review-attempt-outcome", () => ({
  startReviewOutcome: async () => {},
  deferReviewOutcome: async () => {},
  supersedeReviewOutcomes: async () => {},
  ReviewOutcomeRecorder: class {
    assessment() {}
    mainPosted = () => {};
    inlinePosted() {}
    async finish() {}
    async publish<T>(operation: () => Promise<T>) { return operation(); }
  },
}));
