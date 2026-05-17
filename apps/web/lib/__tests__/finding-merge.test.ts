import { describe, it, expect } from "bun:test";
import { findingSignature, mergeFindingsBySignature } from "@/lib/finding-merge";

describe("findingSignature", () => {
  it("returns the same signature for identical inputs", () => {
    const a = findingSignature({
      filePath: "src/x.ts",
      category: "Security",
      title: "SQL injection",
    });
    const b = findingSignature({
      filePath: "src/x.ts",
      category: "Security",
      title: "SQL injection",
    });
    expect(a).toBe(b);
  });

  it("is case-insensitive for category and title", () => {
    const a = findingSignature({
      filePath: "src/x.ts",
      category: "Security",
      title: "SQL injection",
    });
    const b = findingSignature({
      filePath: "src/x.ts",
      category: "SECURITY",
      title: "sql INJECTION",
    });
    expect(a).toBe(b);
  });

  it("collapses internal whitespace in title", () => {
    const a = findingSignature({
      filePath: "src/x.ts",
      category: "Bug",
      title: "Off by one",
    });
    const b = findingSignature({
      filePath: "src/x.ts",
      category: "Bug",
      title: "Off  by\tone",
    });
    expect(a).toBe(b);
  });

  it("is case-sensitive for filePath (paths are exact)", () => {
    const a = findingSignature({ filePath: "src/X.ts", category: "Bug", title: "T" });
    const b = findingSignature({ filePath: "src/x.ts", category: "Bug", title: "T" });
    expect(a).not.toBe(b);
  });

  it("changes when title content changes", () => {
    const a = findingSignature({ filePath: "x", category: "c", title: "a" });
    const b = findingSignature({ filePath: "x", category: "c", title: "b" });
    expect(a).not.toBe(b);
  });

  it("returns a 16-char hex string", () => {
    const sig = findingSignature({ filePath: "x", category: "c", title: "t" });
    expect(sig).toHaveLength(16);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });
});

describe("mergeFindingsBySignature", () => {
  type F = {
    signature: string | null;
    title: string;
    status?: "open" | "acknowledged" | "wont-fix";
    createdAt?: number;
  };

  // The inherit rule mirrors what reviewer.ts will do: copy triage + originals.
  const inheritTriage = (next: F, prior: F): F => ({
    ...next,
    status: prior.status,
    createdAt: prior.createdAt,
  });

  it("inherits prior state when signatures match", () => {
    const prior: F[] = [
      { signature: "a", title: "x", status: "acknowledged", createdAt: 100 },
    ];
    const current: F[] = [
      { signature: "a", title: "x" },
    ];
    const result = mergeFindingsBySignature({ prior, current, inherit: inheritTriage });
    expect(result.merged[0].status).toBe("acknowledged");
    expect(result.merged[0].createdAt).toBe(100);
    expect(result.inherited).toBe(1);
    expect(result.added).toBe(0);
    expect(result.obsoleted).toBe(0);
  });

  it("counts added findings (no prior match)", () => {
    const prior: F[] = [{ signature: "a", title: "x", status: "open" }];
    const current: F[] = [
      { signature: "a", title: "x" },
      { signature: "b", title: "new" },
    ];
    const result = mergeFindingsBySignature({ prior, current, inherit: inheritTriage });
    expect(result.added).toBe(1);
    expect(result.inherited).toBe(1);
  });

  it("counts obsoleted prior findings", () => {
    const prior: F[] = [
      { signature: "a", title: "x", status: "open" },
      { signature: "b", title: "old", status: "open" },
    ];
    const current: F[] = [{ signature: "a", title: "x" }];
    const result = mergeFindingsBySignature({ prior, current, inherit: inheritTriage });
    expect(result.obsoleted).toBe(1);
  });

  it("does not merge findings without a signature", () => {
    const prior: F[] = [{ signature: null, title: "legacy", status: "acknowledged" }];
    const current: F[] = [{ signature: null, title: "legacy" }];
    const result = mergeFindingsBySignature({ prior, current, inherit: inheritTriage });
    expect(result.merged[0].status).toBeUndefined();
    expect(result.inherited).toBe(0);
    expect(result.added).toBe(1);
  });

  it("returns the same length as `current` (current is the source of truth)", () => {
    const prior: F[] = [
      { signature: "a", title: "x", status: "open" },
      { signature: "b", title: "y", status: "open" },
      { signature: "c", title: "z", status: "open" },
    ];
    const current: F[] = [
      { signature: "a", title: "x" },
      { signature: "d", title: "brand new" },
    ];
    const result = mergeFindingsBySignature({ prior, current, inherit: inheritTriage });
    expect(result.merged).toHaveLength(2);
    expect(result.inherited).toBe(1);
    expect(result.added).toBe(1);
    expect(result.obsoleted).toBe(2);
  });

  it("handles empty prior list", () => {
    const current: F[] = [{ signature: "a", title: "x" }];
    const result = mergeFindingsBySignature({ prior: [], current, inherit: inheritTriage });
    expect(result.added).toBe(1);
    expect(result.inherited).toBe(0);
    expect(result.obsoleted).toBe(0);
  });

  it("handles empty current list", () => {
    const prior: F[] = [{ signature: "a", title: "x", status: "open" }];
    const result = mergeFindingsBySignature({ prior, current: [], inherit: inheritTriage });
    expect(result.merged).toHaveLength(0);
    expect(result.obsoleted).toBe(1);
  });
});
