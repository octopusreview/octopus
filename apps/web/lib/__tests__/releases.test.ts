import { describe, expect, test } from "bun:test";
import { compareSemver } from "../semver";
import { selectLatestWebRelease } from "../releases-select";

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

describe("selectLatestWebRelease", () => {
  const rel = (over: Partial<{ tag_name: string; draft: boolean; prerelease: boolean; html_url: string; published_at: string }>) => ({
    tag_name: "v1.0.0",
    html_url: "https://github.com/x/y/releases/tag/v1.0.0",
    published_at: "2026-01-01T00:00:00Z",
    body: "",
    draft: false,
    prerelease: false,
    ...over,
  });

  test("picks the latest v* tag from a list ordered desc", () => {
    const picked = selectLatestWebRelease([
      rel({ tag_name: "v0.5.0", published_at: "2026-05-10T00:00:00Z" }),
      rel({ tag_name: "v0.4.2", published_at: "2026-04-30T00:00:00Z" }),
    ]);
    expect(picked?.tag_name).toBe("v0.5.0");
  });

  test("skips octp-v* CLI tags even when they're newer (the H11 bug)", () => {
    const picked = selectLatestWebRelease([
      rel({ tag_name: "octp-v0.3.0", published_at: "2026-05-20T00:00:00Z" }),
      rel({ tag_name: "v0.5.0", published_at: "2026-05-10T00:00:00Z" }),
    ]);
    expect(picked?.tag_name).toBe("v0.5.0");
  });

  test("skips drafts and prereleases", () => {
    const picked = selectLatestWebRelease([
      rel({ tag_name: "v0.6.0", draft: true }),
      rel({ tag_name: "v0.5.1", prerelease: true }),
      rel({ tag_name: "v0.5.0" }),
    ]);
    expect(picked?.tag_name).toBe("v0.5.0");
  });

  test("returns null when no eligible release exists", () => {
    expect(
      selectLatestWebRelease([
        rel({ tag_name: "octp-v0.3.0" }),
        rel({ tag_name: "internal-test" }),
      ]),
    ).toBeNull();
    expect(selectLatestWebRelease([])).toBeNull();
  });

  test("rejects items missing required fields", () => {
    expect(
      selectLatestWebRelease([{ tag_name: "v1.0.0", draft: false, prerelease: false } as unknown as Parameters<typeof selectLatestWebRelease>[0][number]]),
    ).toBeNull();
  });
});
