import { describe, expect, it } from "bun:test";
import { parseDiffCharCap } from "../diff-truncate";
import { buildGeneratedMatcher } from "../generated-files";
import { prepareReviewInput, type ReviewInput } from "../review-coverage";
import { createBinaryAssetEvidence, indexGitHubBinarySections } from "../review-binary-assets";
import { COMPLETE_REVIEW_POLICY as policy, completeReviewCandidate, createReviewExecutionWindow,
  generationTimeout, withinReviewWindow, isReviewCancelled } from "../review-capacity";

function input(): ReviewInput {
  const revision = { provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40) };
  const files = Array.from({ length: 130 }, (_, i) => ({ path: `src/source${i}.ts`, change: "added",
    additions: 1, deletions: 0, patch: `@@ -0,0 +1 @@\n+${"x".repeat(6800)}\n` }));
  const binaries = Array.from({ length: 107 }, (_, i) => {
    const path = `assets/asset${i}.${i % 2 ? "zip" : "jpg"}`;
    const file = { path, change: "added", additions: 0, deletions: 0, blobSha: "c".repeat(40) };
    const sections = indexGitHubBinarySections(`diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..ccccccc\nBinary files /dev/null and b/${path} differ\n`);
    return { ...file, binaryEvidence: createBinaryAssetEvidence(file, revision, sections.get(path)) };
  });
  return { ...revision, inventoryComplete: true, expectedFiles: 240, limitations: [], files: [...files, ...binaries,
    ...Array.from({ length: 3 }, (_, i) => ({ path: `generated/${i}.min.js`, change: "added", patch: "@@ -0,0 +1 @@\n+generated\n", additions: 1, deletions: 0 }))] };
}
const windowFor = (remaining = 900_000) => ({ jobId: "synthetic", deadlineEpochMs: Date.now() + remaining,
  signal: new AbortController().signal, remainingMs: () => remaining });
const policyModel = policy.models[0];

describe("complete review candidate", () => {
  const options = { maxChars: 350_000, generated: buildGeneratedMatcher() };
  it("retains explicit and invalid cap provenance without changing numeric fallback", () => {
    expect(parseDiffCharCap(undefined)).toEqual({ value: 350000, source: "default" });
    for (const raw of ["", "bad", "0", "-1", "Infinity", "NaN"]) expect(parseDiffCharCap(raw)).toEqual({ value: 350000, source: "invalid" });
    for (const raw of ["350000", "100", "350000.75", "800000"]) expect(parseDiffCharCap(raw)).toEqual({ value: Number(raw), source: "explicit" });
  });
  it("selects all 130 text files and preserves all 110 declared exclusions", () => {
    const source = input();
    const baseline = prepareReviewInput(source, options);
    expect(baseline.coverage.complete).toBe(false);
    const candidate = completeReviewCandidate(source, options, baseline, policyModel, "anthropic", windowFor(), parseDiffCharCap(undefined));
    expect(candidate?.coverage.complete).toBe(true);
    expect(candidate?.coverage.files.filter(file => file.state === "supplied")).toHaveLength(130);
    expect(candidate?.coverage.files.filter(file => file.state === "excluded")).toHaveLength(110);
    expect(candidate?.diff.length).toBeGreaterThan(350000);
    expect(candidate?.coverage.files.filter(file => file.state === "supplied").every(file => file.hunks.length === 1 && file.suppliedSha256)).toBe(true);
  });
  it("admits every policy model and no neighbouring id", () => {
    const source = input();
    const baseline = prepareReviewInput(source, options);
    expect(policy.models).toEqual(["claude-fable-5-1", "claude-fable-5-2"]);
    for (const model of policy.models) {
      expect(completeReviewCandidate(source, options, baseline, model, "anthropic", windowFor(), parseDiffCharCap(undefined))?.coverage.complete).toBe(true);
    }
    for (const other of ["claude-fable-5", "claude-fable-5-1-alias", "claude-fable-5-3", "claude-mythos-5-2", "claude-opus-5-5", ""]) {
      expect(completeReviewCandidate(source, options, baseline, other, "anthropic", windowFor(), parseDiffCharCap(undefined))).toBeNull();
    }
  });
  it("never expands a present cap, changes model/provider, or exceeds the existing acquisition ceiling", () => {
    const source = input();
    const baseline = prepareReviewInput(source, options);
    for (const raw of ["350000", "100", "350000.75", "800000", "bad", ""]) {
      expect(completeReviewCandidate(source, options, baseline, policyModel, "anthropic", windowFor(), parseDiffCharCap(raw))).toBeNull();
    }
    expect(completeReviewCandidate(source, options, baseline, "claude-fable-5", "anthropic", windowFor())).toBeNull();
    expect(completeReviewCandidate(source, options, baseline, policyModel, "openrouter", windowFor())).toBeNull();
    expect(completeReviewCandidate(source, options, baseline, policyModel, "anthropic")).toBeNull();
    expect(completeReviewCandidate(source, options, baseline, policyModel, "anthropic", windowFor(659999))).toBeNull();
    expect(completeReviewCandidate(source, options, baseline, policyModel, "anthropic", windowFor(), parseDiffCharCap(undefined), 800000)).toBeNull();
  });
  it("cannot complete unknown inventory, missing or malformed text, or unverified binary declarations", () => {
    for (const mutate of [
      (source: ReviewInput) => { source.inventoryComplete = false; },
      (source: ReviewInput) => { delete source.files[0].patch; },
      (source: ReviewInput) => { source.files[0].patch = "@@ -0,0 +1,2 @@\n+partial\n"; },
      (source: ReviewInput) => { delete source.files[130].binaryEvidence; },
      (source: ReviewInput) => { source.files[130].binaryEvidence!.headSha = "d".repeat(40); },
    ]) {
      const source = input(); mutate(source);
      expect(completeReviewCandidate(source, options, prepareReviewInput(source, options), policyModel, "anthropic", windowFor()) === null).toBe(true);
    }
  });
});

describe("actual review execution lifetime", () => {
  it("distinguishes reasonless queue expiry from cancellation using the execution deadline", () => {
    for (const elapsed of [899999, 900000, 900001]) {
      let monotonic = 0;
      const controller = new AbortController();
      const window = createReviewExecutionWindow({ id: "job", startedOn: new Date(1000000), expireInSeconds: 900,
        signal: controller.signal }, { epoch: () => 1000000, monotonic: () => monotonic })!;
      expect(isReviewCancelled(window)).toBe(false);
      monotonic = elapsed;
      controller.abort();
      expect(controller.signal.reason.name).toBe("AbortError");
      expect(isReviewCancelled(window)).toBe(elapsed < 900000);
    }
    expect(isReviewCancelled()).toBe(false);
    const timeout = new AbortController(); timeout.abort(new DOMException("Deadline", "TimeoutError"));
    expect(isReviewCancelled({ ...windowFor(), signal: timeout.signal })).toBe(false);
  });
  it("uses the earlier job deadline and callback duration then only a monotonic clock", () => {
    let epoch = 1000000, monotonic = 20;
    const window = createReviewExecutionWindow({ id: "job", startedOn: new Date(epoch - 30000), expireInSeconds: 900,
      signal: new AbortController().signal }, { epoch: () => epoch, monotonic: () => monotonic })!;
    expect(window.remainingMs()).toBe(870000);
    epoch -= 1000000; monotonic += 270000;
    expect(window.remainingMs()).toBe(600000);
    expect(() => generationTimeout(window, true)).toThrow();
    expect(generationTimeout(window, false)).toBe(540000);
    expect(createReviewExecutionWindow({ id: "job", startedOn: new Date(NaN), expireInSeconds: 900, signal: window.signal })).toBeUndefined();
  });
  it("preserves the publication minute, minimum primary generation and maximum call duration", () => {
    expect(generationTimeout(windowFor(900000), true)).toBe(840000);
    expect(generationTimeout(windowFor(660000), true)).toBe(600000);
    expect(generationTimeout(windowFor(5000000), true)).toBe(840000);
    expect(() => generationTimeout(windowFor(659999), true)).toThrow();
    expect(() => generationTimeout(windowFor(60000), false)).toThrow();
  });
  it("cancels a pending preflight even if the dependency ignores its signal", async () => {
    const controller = new AbortController();
    const window = { ...windowFor(), signal: controller.signal };
    const pending = withinReviewWindow(window, 15000, async () => { controller.abort(); return new Promise<never>(() => {}); });
    await expect(pending).rejects.toThrow("cancelled");
  });
});
