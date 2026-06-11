import { describe, it, expect } from "bun:test";
import { MAX_GITHUB_COMMENT_BODY, truncateForGithubComment } from "@/lib/github";

describe("truncateForGithubComment", () => {
  it("returns short bodies unchanged", () => {
    expect(truncateForGithubComment("hello")).toBe("hello");
    expect(truncateForGithubComment("")).toBe("");
  });

  it("does NOT truncate at the cap boundary", () => {
    const body = "a".repeat(MAX_GITHUB_COMMENT_BODY);
    expect(truncateForGithubComment(body)).toBe(body);
  });

  it("appends a clear truncation marker when over the cap", () => {
    const body = "a".repeat(MAX_GITHUB_COMMENT_BODY + 1000);
    const out = truncateForGithubComment(body);
    expect(out.length).toBeLessThanOrEqual(MAX_GITHUB_COMMENT_BODY);
    expect(out).toContain("Comment truncated");
    expect(out).toContain("GitHub's per-comment size cap");
  });

  it("prefers a paragraph boundary near the cap", () => {
    // Compose a body where the last `\n\n` lies near the limit; the cut
    // should land at that boundary, not mid-line.
    const head = "section one".padEnd(MAX_GITHUB_COMMENT_BODY - 5_000, "x");
    const tail = "section two that wouldn't fit and goes well past the limit";
    const body = head + "\n\n" + tail.repeat(200);
    const out = truncateForGithubComment(body);
    // The marker is the only `\n\n---\n\n` so split on it to find the body content.
    const beforeMarker = out.split("\n\n---\n\n")[0];
    // Body content ends at a \n\n boundary OR is exactly equal to the head.
    // Assert no half-cut tail content (tail starts with "section two").
    expect(beforeMarker.endsWith(head)).toBe(true);
  });

  it("falls back to a hard cut when no recent boundary exists", () => {
    // No newlines at all — must still produce a body that fits.
    const body = "a".repeat(MAX_GITHUB_COMMENT_BODY * 2);
    const out = truncateForGithubComment(body);
    expect(out.length).toBeLessThanOrEqual(MAX_GITHUB_COMMENT_BODY);
    expect(out).toContain("Comment truncated");
  });

  it("does not end on a lone surrogate (would break JSON encode)", () => {
    // 🔴 is a surrogate pair in UTF-16. A body of contiguous 🔴 with no
    // newlines lands in the hard-cut path; without the guard, slice may
    // cut between the high and low surrogate and emit a malformed string.
    // String.prototype.isWellFormed() (ES2024) reports unpaired surrogates.
    const body = "🔴".repeat(MAX_GITHUB_COMMENT_BODY);
    const out = truncateForGithubComment(body);
    expect(out.length).toBeLessThanOrEqual(MAX_GITHUB_COMMENT_BODY);
    expect(out.isWellFormed()).toBe(true);
    // Sanity: re-encoding through JSON preserves all code points.
    expect(() => JSON.parse(JSON.stringify({ body: out }))).not.toThrow();
  });
});
