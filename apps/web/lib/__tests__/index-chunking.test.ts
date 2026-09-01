import { describe, it, expect } from "bun:test";
import { treeBlobs } from "@/lib/index-chunking";

describe("treeBlobs", () => {
  it("drops tree entries and keeps blob entries in order", () => {
    const items = [
      { type: "blob", path: "a.ts" },
      { type: "tree", path: "src" },
      { type: "blob", path: "src/b.ts" },
      { type: "tree", path: "src/lib" },
      { type: "blob", path: "src/lib/c.ts" },
    ];
    expect(treeBlobs(items)).toEqual([
      { type: "blob", path: "a.ts" },
      { type: "blob", path: "src/b.ts" },
      { type: "blob", path: "src/lib/c.ts" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(treeBlobs([])).toEqual([]);
  });
});
