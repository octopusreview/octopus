import { describe, it, expect } from "bun:test";
import { projectActivity } from "../activity";

describe("projectActivity — privacy allowlist", () => {
  it("never leaks PR title / URL from a review event", () => {
    const p = projectActivity({
      type: "review-completed",
      orgId: "o1",
      prNumber: 42,
      prTitle: "SECRET_TITLE_should_not_leak",
      prUrl: "https://secret.example/pulls/42",
      findingsCount: 3,
      filesChanged: 7,
    });
    expect(p).not.toBeNull();
    const dump = JSON.stringify(p);
    expect(dump).not.toContain("SECRET_TITLE_should_not_leak");
    expect(dump).not.toContain("secret.example");
    expect(p!.action).toBe("review.completed");
    expect(p!.target).toBe("PR #42");
    expect(p!.actorType).toBe("system");
    expect(p!.metadata).toEqual({ prNumber: 42, findingsCount: 3, filesChanged: 7 });
  });

  it("never leaks the prTitle on review-requested / review-failed", () => {
    const req = projectActivity({
      type: "review-requested",
      orgId: "o1",
      prNumber: 9,
      prTitle: "LEAKY_TITLE",
      prAuthor: "alice",
      prUrl: "https://x/9",
    });
    const fail = projectActivity({
      type: "review-failed",
      orgId: "o1",
      prNumber: 9,
      prTitle: "LEAKY_TITLE",
      error: "boom at /Users/secret/path.ts",
    });
    expect(JSON.stringify(req)).not.toContain("LEAKY_TITLE");
    expect(JSON.stringify(req)).not.toContain("alice");
    expect(JSON.stringify(fail)).not.toContain("LEAKY_TITLE");
    expect(JSON.stringify(fail)).not.toContain("/Users/secret");
  });

  it("never leaks knowledge document titles", () => {
    const p = projectActivity({
      type: "knowledge-ready",
      orgId: "o1",
      documentTitle: "SECRET_DOC_NAME",
      action: "created",
      totalChunks: 5,
      totalVectors: 50,
    });
    expect(JSON.stringify(p)).not.toContain("SECRET_DOC_NAME");
    expect(p!.action).toBe("knowledge.created");
    expect(p!.target).toBeNull();
  });

  it("includes the org's own repo name for repo / community events", () => {
    const indexed = projectActivity({
      type: "repo-indexed",
      orgId: "o1",
      repoFullName: "acme/widgets",
      success: true,
      indexedFiles: 10,
    });
    expect(indexed!.action).toBe("repo.indexed");
    expect(indexed!.target).toBe("acme/widgets");

    const community = projectActivity({
      type: "community-review",
      orgId: "o1",
      repoFullName: "acme/oss",
      prNumber: 3,
      findingsCount: 1,
    });
    expect(community!.target).toBe("acme/oss");
  });

  it("drops billing and admin events from the feed", () => {
    expect(
      projectActivity({ type: "credit-low", orgId: "o1", remainingBalance: 1 }),
    ).toBeNull();
    expect(
      projectActivity({
        type: "org-type-changed",
        orgId: "o1",
        orgName: "Acme",
        fromType: 1,
        toType: 3,
        changedById: "u1",
      }),
    ).toBeNull();
  });
});
