import { describe, it, expect } from "bun:test";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";

describe("toBaseSlug", () => {
  it("lowercases input", () => {
    expect(toBaseSlug("Hello World")).toBe("hello-world");
  });

  it("replaces special characters with hyphens", () => {
    expect(toBaseSlug("My Project! @2024")).toBe("my-project-2024");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toBaseSlug("--test--")).toBe("test");
  });

  it("collapses consecutive special chars into single hyphen", () => {
    expect(toBaseSlug("a   b...c")).toBe("a-b-c");
  });

  it("handles empty string", () => {
    expect(toBaseSlug("")).toBe("");
  });

  it("handles already clean slug", () => {
    expect(toBaseSlug("clean-slug-123")).toBe("clean-slug-123");
  });

  it("strips non-ascii characters", () => {
    // toBaseSlug uses [^a-z0-9] regex so non-ascii chars become hyphens
    expect(toBaseSlug("cafe mocha")).toBe("cafe-mocha");
    expect(toBaseSlug("hello world")).toBe("hello-world");
  });
});

describe("randomSlugSuffix", () => {
  it("returns adjective-animal format", () => {
    const slug = randomSlugSuffix();
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("contains exactly one hyphen", () => {
    const slug = randomSlugSuffix();
    const parts = slug.split("-");
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("produces varied results across many calls", () => {
    // With 32 adjectives x 32 animals = 1024 combinations,
    // 50 samples should produce at least 10 unique values
    const results = new Set(Array.from({ length: 50 }, () => randomSlugSuffix()));
    expect(results.size).toBeGreaterThan(10);
  });
});
