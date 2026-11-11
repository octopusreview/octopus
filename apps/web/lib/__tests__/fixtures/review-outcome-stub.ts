import { mock } from "bun:test";

// Existing isolated review harnesses have no outcome table. Exercise their
// original concern; the PostgreSQL outcome harness tests recording separately.
// Harnesses that exercise the durable generation budget lower `limit`; the PostgreSQL test covers the real claim.
export const generationBudget = { claims: 0, limit: Infinity };
mock.module("@/lib/review-attempt-outcome", () => ({
  claimGenerationAttempt: async () => ++generationBudget.claims <= generationBudget.limit,
  startReviewOutcome: async () => {},
  deferReviewOutcome: async () => {},
  supersedeReviewOutcomes: async () => {},
  recordReviewAdmissionAfterCommit: () => {},
  ReviewOutcomeRecorder: class {
    assessment() {}
    mainPosted = () => {};
    inlinePosted() {}
    superseded() {}
    async finish() {}
    async publish<T>(operation: () => Promise<T>) { return operation(); }
  },
}));
