import { describe, expect, it } from "bun:test";
import { ALL_SCOPES, hasScopes, normalizeScopes } from "../scopes";

describe("normalizeScopes", () => {
  it("accepts known scopes and dedupes/normalizes", () => {
    expect(normalizeScopes(["blog:read", " Blog:Read ", "blog:create"])).toEqual([
      "blog:read",
      "blog:create",
    ]);
  });

  it("rejects unknown scopes", () => {
    expect(() => normalizeScopes(["blog:read", "repo:admin"])).toThrow(/unknown scope/);
  });

  it("rejects an empty set (a scopeless token would be inert)", () => {
    expect(() => normalizeScopes([])).toThrow(/at least one scope/);
    expect(() => normalizeScopes(["", "  "])).toThrow(/at least one scope/);
  });

  it("rejects non-array input", () => {
    expect(() => normalizeScopes("blog:read")).toThrow(/array/);
  });
});

describe("hasScopes (deny-by-default)", () => {
  it("is false for a null/empty token", () => {
    expect(hasScopes(null, "blog:read")).toBe(false);
    expect(hasScopes([], "blog:read")).toBe(false);
  });

  it("is true only when every required scope is held", () => {
    expect(hasScopes(["blog:read"], "blog:read")).toBe(true);
    expect(hasScopes(["blog:read"], "blog:create")).toBe(false);
    expect(hasScopes(["blog:read", "blog:create"], "blog:read", "blog:create")).toBe(true);
  });

  it("does not expand wildcards or partial matches", () => {
    expect(hasScopes(["blog"], "blog:read")).toBe(false);
    expect(hasScopes(["blog:*"], "blog:read")).toBe(false);
  });
});

describe("ALL_SCOPES", () => {
  it("matches the registry (no delete scope yet)", () => {
    expect(ALL_SCOPES).toEqual(["blog:read", "blog:create", "blog:update"]);
  });
});
