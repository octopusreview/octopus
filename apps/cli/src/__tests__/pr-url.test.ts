import { describe, it, expect } from "bun:test";
import { parsePrArg, prTerms, localizeMessage } from "../lib/pr-url.js";

describe("parsePrArg", () => {
  it("parses a bare PR number", () => {
    expect(parsePrArg("123")).toEqual({ ok: true, prNumber: 123 });
    expect(parsePrArg("  7 ")).toEqual({ ok: true, prNumber: 7 });
  });

  it("parses GitHub / Bitbucket / GitLab URLs", () => {
    expect(parsePrArg("https://github.com/owner/repo/pull/45")).toEqual({
      ok: true,
      prNumber: 45,
      repoFullName: "owner/repo",
    });
    expect(parsePrArg("https://bitbucket.org/o/r/pull-requests/7")).toEqual({
      ok: true,
      prNumber: 7,
      repoFullName: "o/r",
    });
    expect(parsePrArg("https://gitlab.example.com/g/sub/r/-/merge_requests/9")).toEqual({
      ok: true,
      prNumber: 9,
      repoFullName: "g/sub/r",
    });
  });

  it("rejects non-numeric, non-URL, and partial-number inputs", () => {
    expect(parsePrArg("abc").ok).toBe(false);
    expect(parsePrArg("123abc").ok).toBe(false); // not all digits, no URL match
    expect(parsePrArg("").ok).toBe(false);
  });
});

describe("prTerms / localizeMessage", () => {
  it("uses MR wording for gitlab, PR otherwise", () => {
    expect(prTerms("gitlab")).toEqual({ full: "merge request", short: "MR" });
    expect(prTerms("github")).toEqual({ full: "pull request", short: "PR" });
  });

  it("localizes server wording only for gitlab", () => {
    expect(localizeMessage("Pull request not found", "gitlab")).toBe("Merge request not found");
    expect(localizeMessage("PR opened", "gitlab")).toBe("MR opened");
    expect(localizeMessage("Pull request not found", "github")).toBe("Pull request not found");
  });
});
