import { describe, expect, test } from "bun:test";
import { compareSemver } from "../semver";

describe("compareSemver", () => {
  test("basic ordering", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(compareSemver("1.0.1", "1.0.0")).toBe(1);
    expect(compareSemver("2.0.0", "1.999.999")).toBe(1);
  });

  test("v-prefix is tolerated on either side", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3", "v1.2.3")).toBe(0);
  });

  test("prerelease ranks lower than release per semver §11", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
  });

  test("build metadata after prerelease is preserved (regression: prior parser dropped pre)", () => {
    // The whole point of the bug-fix: 1.0.0-rc.1+build MUST be < 1.0.0
    expect(compareSemver("1.0.0-rc.1+build", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0+build", "1.0.0-rc.1+build")).toBe(1);
  });

  test("build metadata alone is ignored", () => {
    expect(compareSemver("1.0.0+build1", "1.0.0+build2")).toBe(0);
    expect(compareSemver("1.0.0+build", "1.0.0")).toBe(0);
  });

  test("invalid versions throw", () => {
    expect(() => compareSemver("not-a-version", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0.x", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0", "1.0.0")).not.toThrow(); // missing patch tolerated → 0
  });
});
