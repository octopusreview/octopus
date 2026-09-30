import { describe, expect, it } from "bun:test";
import { fetchGitHubReviewInput } from "@/lib/github-review-input";
import { prepareReviewInput, reviewCheckResult, sha256, type ReviewInput } from "@/lib/review-coverage";

const head = "1".repeat(40), base = "2".repeat(40);
const blob = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const path = ".review-evidence/check.stderr.log";
const file = { filename: path, status: "added", additions: 0, deletions: 0, sha: blob };
const diff = `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..${blob.slice(0, 7)}\n`;
async function fetch(files: unknown[] = [file], rawDiff = diff) {
  return (await fetchGitHubReviewInput({ expectedHead: head, maxPatchChars: 1000,
    fetchDiff: async () => rawDiff,
    readJson: async suffix => suffix ? files : { head: { sha: head }, base: { sha: base }, changed_files: files.length },
  })).input;
}

describe("verified empty GitHub additions", () => {
  for (const patch of [undefined, null]) it(`supplies an empty declaration with ${patch} patch without granting an assessment`, async () => {
    const input = JSON.parse(JSON.stringify(await fetch([{ ...file, patch }]))) as ReviewInput;
    const prepared = prepareReviewInput(input, { maxChars: 1000 });
    expect(prepared.coverage.complete).toBe(true);
    expect(prepared.diff).toContain(diff);
    expect(prepared.diff).toContain("Empty file (0 bytes)");
    expect(prepared.diff).not.toContain("@@");
    expect(prepared.coverage.files[0]).toMatchObject({ state: "supplied", hunks: [], suppliedChars: prepared.diff.length, suppliedSha256: sha256(prepared.diff) });
    expect(reviewCheckResult(prepared.coverage, false, 0).conclusion).toBe("failure");
    const omitted = prepareReviewInput(input, { maxChars: prepared.diff.length - 1 });
    expect(omitted.diff).toBe("");
    expect(omitted.coverage.files[0].state).toBe("omitted");
    expect(omitted.coverage.complete).toBe(false);
  });

  const invalid = [
    { sha: "a".repeat(40) }, { sha: undefined }, { additions: 1 }, { additions: undefined },
    { deletions: 1 }, { status: "modified" }, { status: "removed" }, { status: "renamed" },
    { previous_filename: path }, { patch: "" }, { patch: "bad patch" }, { patch: 42 },
  ];
  for (const change of invalid) it(`rejects contradictory metadata ${JSON.stringify(change)}`, async () => {
    const prepared = prepareReviewInput(await fetch([{ ...file, ...change }]), { maxChars: 1000 });
    expect(prepared.coverage.complete).toBe(false);
    expect(prepared.coverage.files[0].state).toBe("unavailable");
  });
  for (const raw of ["", diff + diff, diff + "extra\n", diff.replace("100644", "120000"),
    diff.replace("100644", "100755"), diff.replace("0000000..", "bbbbbbb.."),
    diff.replace(blob.slice(0, 7), "aaaaaaa"), diff.slice(0, -1), diff + "@@ -0,0 +1 @@\n+hidden\n",
    diff.replace(`a/${path}`, "a/other.log")]) it(`rejects incomplete or conflicting section ${JSON.stringify(raw)}`, async () => {
    expect(prepareReviewInput(await fetch([file], raw), { maxChars: 1000 }).coverage.complete).toBe(false);
  });

  it("revalidates evidence against current input and keeps actual source missing", async () => {
    const input = await fetch();
    for (const mutate of [
      (i: ReviewInput) => { i.headSha = "3".repeat(40); },
      (i: ReviewInput) => { i.baseSha = null; },
      (i: ReviewInput) => { i.provider = "gitlab"; },
      (i: ReviewInput) => { i.files[0].blobSha = "a".repeat(40); },
      (i: ReviewInput) => { i.files[0].path = "../outside"; },
      (i: ReviewInput) => { i.files[0].unavailable = "retained budget exceeded"; },
    ]) {
      const copy = structuredClone(input); mutate(copy);
      expect(prepareReviewInput(copy, { maxChars: 1000 }).coverage.files[0].state).toBe("unavailable");
    }
    const mixed = await fetch([file, { ...file, filename: "src/auth.ts", sha: "a".repeat(40), additions: 1 }]);
    const coverage = prepareReviewInput(mixed, { maxChars: 1000 }).coverage;
    expect(coverage.files.map(f => f.state)).toEqual(["supplied", "unavailable"]);
    expect(coverage.complete).toBe(false);
  });
});
