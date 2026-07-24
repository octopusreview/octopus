import { describe, it, expect } from "bun:test";
import { classifyDiff, extractChangedPaths, MECHANICAL_MODEL } from "@/lib/review-routing";

function diffFor(path: string, added = 3): string {
  const plus = Array.from({ length: added }, (_, i) => `+line ${i}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${added} @@\n${plus}\n`;
}

describe("extractChangedPaths", () => {
  it("pulls the new-side path from each file header", () => {
    const d = diffFor("src/a.ts") + diffFor("src/b.ts");
    expect(extractChangedPaths(d)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("classifyDiff", () => {
  it("classifies a lockfile-only diff as mechanical", () => {
    expect(classifyDiff(diffFor("bun.lock", 500)).tier).toBe("mechanical");
  });

  it("classifies a docs-only diff as mechanical", () => {
    expect(classifyDiff(diffFor("README.md", 40)).tier).toBe("mechanical");
  });

  it("classifies a tests-only diff as mechanical", () => {
    expect(classifyDiff(diffFor("src/foo.test.ts", 40)).tier).toBe("mechanical");
  });

  it("classifies a tiny single-file source edit as mechanical", () => {
    expect(classifyDiff(diffFor("src/foo.ts", 4)).tier).toBe("mechanical");
  });

  it("classifies a normal multi-file source change as standard", () => {
    const d = diffFor("src/a.ts", 60) + diffFor("src/b.ts", 60);
    expect(classifyDiff(d).tier).toBe("standard");
  });

  it("classifies a schema/migration change as complex (high-risk)", () => {
    const c = classifyDiff(diffFor("packages/db/prisma/schema.prisma", 5));
    expect(c.tier).toBe("complex");
    expect(c.highRisk).toBe(true);
  });

  it("classifies a large diff as complex even without high-risk files", () => {
    expect(classifyDiff(diffFor("src/big.ts", 500)).tier).toBe("complex");
  });

  it("a mixed lockfile + real source change is NOT mechanical", () => {
    const d = diffFor("bun.lock", 300) + diffFor("src/app.ts", 40);
    expect(classifyDiff(d).mechanicalOnly).toBe(false);
    expect(classifyDiff(d).tier).toBe("standard");
  });

  it("counts loc and files", () => {
    const c = classifyDiff(diffFor("src/a.ts", 7));
    expect(c.files).toBe(1);
    expect(c.loc).toBe(7);
  });
});

describe("pricing coverage (never bill $0 on a downshift)", () => {
  it("the mechanical downshift model has fallback pricing", async () => {
    const { fallbackPricedModels } = await import("@/lib/cost");
    expect(fallbackPricedModels()).toContain(MECHANICAL_MODEL);
  });
});
