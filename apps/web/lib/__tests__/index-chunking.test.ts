import { describe, it, expect } from "bun:test";
import { exceedsMaxFileSize, treeBlobs, MAX_FILE_SIZE } from "@/lib/index-chunking";

describe("exceedsMaxFileSize", () => {
  it("returns false at exactly MAX_FILE_SIZE bytes", () => {
    expect(exceedsMaxFileSize("a".repeat(MAX_FILE_SIZE))).toBe(false);
  });

  it("returns true one byte over MAX_FILE_SIZE", () => {
    expect(exceedsMaxFileSize("a".repeat(MAX_FILE_SIZE + 1))).toBe(true);
  });

  it("measures bytes, not chars, for multibyte content", () => {
    // "é" is 2 bytes in UTF-8: char length is under the cap, byte length is over
    const s = "é".repeat(60_000);
    expect(s.length).toBeLessThan(MAX_FILE_SIZE);
    expect(exceedsMaxFileSize(s)).toBe(true);
  });
});

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
