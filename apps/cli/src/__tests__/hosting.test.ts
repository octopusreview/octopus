import { describe, expect, it } from "bun:test";
import { HOSTED_BASE_URL, buildHostingPatch, isCloudBaseUrl } from "../lib/hosting";

describe("hosting", () => {
  it("treats the Cloud URL (and no URL) as Cloud", () => {
    expect(isCloudBaseUrl(HOSTED_BASE_URL)).toBe(true);
    expect(isCloudBaseUrl(`${HOSTED_BASE_URL}/`)).toBe(true);
    expect(isCloudBaseUrl(undefined)).toBe(true);
    expect(isCloudBaseUrl("https://octopus.internal.acme.com")).toBe(false);
  });

  it("Cloud clears a seeded self-hosted URL, self-hosted sets it", () => {
    expect(buildHostingPatch(HOSTED_BASE_URL)).toEqual({ selfHostedBaseUrl: undefined });
    expect("selfHostedBaseUrl" in buildHostingPatch(HOSTED_BASE_URL)).toBe(true);
    expect(buildHostingPatch("https://octopus.internal.acme.com")).toEqual({
      selfHostedBaseUrl: "https://octopus.internal.acme.com",
    });
  });
});
