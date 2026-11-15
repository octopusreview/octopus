import { expect, it } from "bun:test";
import { applyBlogEdits } from "@/lib/blog-edits";

const post = {
  title: "Why the tool is open",
  excerpt: "A short summary. The tool is open source.",
  content: "## Intro\n\nOctopus is open source and self-hostable.\n\nYour code never leaves your servers. Period.\n",
};

it("replaces each text once, in the title, the excerpt or the body, and reports only what changed", () => {
  const result = applyBlogEdits(post, [
    { before: "Octopus is open source and self-hostable.", after: "Octopus is source-available and self-hostable." },
    { before: "The tool is open source.", after: "The tool is source-available." },
  ]);
  expect(result.problems).toEqual([]);
  expect(result.applied).toBe(2);
  expect(result.changed).toEqual({
    excerpt: "A short summary. The tool is source-available.",
    content: "## Intro\n\nOctopus is source-available and self-hostable.\n\nYour code never leaves your servers. Period.\n",
  });
});

it("refuses an edit whose text is missing or occurs more than once, and names it", () => {
  const result = applyBlogEdits(post, [
    { before: "This sentence is not in the post.", after: "x" },
    { before: "open source", after: "source-available" },
  ]);
  expect(result.applied).toBe(0);
  expect(result.changed).toEqual({});
  expect(result.problems).toEqual(['not found: "This sentence is not in the post."', 'found 2 times: "open source"']);
});

it("counts overlapping matches in every post field", () => {
  for (const field of ["title", "excerpt", "content"] as const) {
    const result = applyBlogEdits({ title: "", excerpt: null, content: "", [field]: "aaa" }, [
      { before: "aa", after: "b" },
    ]);
    expect(result.changed).toEqual({});
    expect(result.problems).toEqual(['found 2 times: "aa"']);
  }
});

it("rejects an empty search text", () => {
  expect(applyBlogEdits(post, [{ before: "", after: "x" }]).problems).toEqual(['not found: ""']);
});

it("treats an edit that was applied before as done, so a second run changes nothing", () => {
  const edits = [{ before: "Octopus is open source and self-hostable.", after: "Octopus is source-available and self-hostable." }];
  const first = applyBlogEdits(post, edits);
  const second = applyBlogEdits({ ...post, ...first.changed }, edits);
  expect(second).toEqual({ changed: {}, applied: 0, alreadyApplied: 1, problems: [] });
});

it("puts replacement text in literally, including characters that mean something in a pattern", () => {
  const result = applyBlogEdits({ title: "T", excerpt: null, content: "Costs $5 (about)." }, [{ before: "Costs $5 (about).", after: "Costs $& and $1." }]);
  expect(result.changed).toEqual({ content: "Costs $& and $1." });
});

it("reports a later edit whose text an earlier edit removed", () => {
  const result = applyBlogEdits(post, [
    { before: "Your code never leaves your servers. Period.", after: "Your code can stay on your servers." },
    { before: "Period.", after: "Full stop." },
  ]);
  expect(result.applied).toBe(1);
  expect(result.problems).toEqual(['not found: "Period."']);
});

it("counts a deletion as done when the text to delete is already gone", () => {
  const result = applyBlogEdits(post, [
    { before: " Period.", after: "" },
    { before: "A sentence that was deleted earlier.", after: "" },
  ]);
  expect(result).toMatchObject({ applied: 1, alreadyApplied: 1, problems: [] });
  expect(result.changed.content).toContain("Your code never leaves your servers.\n");
});
