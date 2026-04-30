import { describe, it, expect } from "bun:test";
import { mergeKnowledgeChunks } from "@/lib/knowledge-context";

describe("mergeKnowledgeChunks", () => {
  it("places always-include chunks first", () => {
    const always = [{ title: "Pinned", text: "[Knowledge: Pinned]\nrule A" }];
    const similarity = [{ title: "Other", text: "[Knowledge: Other]\nrule B", score: 0.9 }];
    const merged = mergeKnowledgeChunks(always, similarity);
    expect(merged.length).toBe(2);
    expect(merged[0]?.title).toBe("Pinned");
    expect(merged[1]?.title).toBe("Other");
  });

  it("dedupes similarity chunks whose title matches an always-include chunk", () => {
    const always = [{ title: "Pinned", text: "full content" }];
    const similarity = [
      { title: "Pinned", text: "chunk excerpt", score: 0.95 },
      { title: "Other", text: "B", score: 0.7 },
    ];
    const merged = mergeKnowledgeChunks(always, similarity);
    expect(merged.length).toBe(2);
    expect(merged.map((m) => m.title)).toEqual(["Pinned", "Other"]);
    expect(merged[0]?.text).toBe("full content");
  });

  it("returns similarity chunks unchanged when nothing is pinned", () => {
    const similarity = [{ title: "X", text: "x", score: 0.5 }];
    const merged = mergeKnowledgeChunks([], similarity);
    expect(merged).toEqual(similarity);
  });

  it("returns only always-include chunks when similarity is empty", () => {
    const always = [{ title: "P", text: "p" }];
    const merged = mergeKnowledgeChunks(always, []);
    expect(merged).toEqual(always);
  });
});
