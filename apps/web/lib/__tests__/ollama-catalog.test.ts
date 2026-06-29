import { describe, it, expect } from "bun:test";
import { OLLAMA_CATALOG, findCatalogEntry } from "../ollama-catalog";

describe("ollama catalog", () => {
  it("is non-empty and has unique model names", () => {
    expect(OLLAMA_CATALOG.length).toBeGreaterThan(0);
    const names = OLLAMA_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every entry is well-formed", () => {
    for (const e of OLLAMA_CATALOG) {
      expect(e.name).toBeTruthy();
      expect(e.displayName).toBeTruthy();
      expect(["llm", "embedding"]).toContain(e.category);
      expect(e.sizeGb).toBeGreaterThan(0);
      expect(e.ramHint).toBeTruthy();
    }
  });

  it("offers at least one llm and one embedding model", () => {
    expect(OLLAMA_CATALOG.some((e) => e.category === "llm")).toBe(true);
    expect(OLLAMA_CATALOG.some((e) => e.category === "embedding")).toBe(true);
  });

  it("findCatalogEntry resolves known names and rejects unknown ones", () => {
    const first = OLLAMA_CATALOG[0];
    expect(findCatalogEntry(first.name)?.name).toBe(first.name);
    expect(findCatalogEntry("definitely-not-a-real-model")).toBeUndefined();
    expect(findCatalogEntry("")).toBeUndefined();
  });
});
