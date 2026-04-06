import { describe, it, expect } from "bun:test";
import { buildIndexWarning } from "@/lib/review-helpers";

describe("buildIndexWarning", () => {
  it("returns warning for stale index", () => {
    const result = buildIndexWarning("stale");
    expect(result).toContain("WARNING");
    expect(result).toContain("stale");
  });

  it("returns warning for failed index", () => {
    const result = buildIndexWarning("failed");
    expect(result).toContain("WARNING");
    expect(result).toContain("failed");
  });

  it("returns null for indexed status", () => {
    expect(buildIndexWarning("indexed")).toBeNull();
  });

  it("returns null for indexing status", () => {
    expect(buildIndexWarning("indexing")).toBeNull();
  });

  it("returns null for pending status", () => {
    expect(buildIndexWarning("pending")).toBeNull();
  });
});
