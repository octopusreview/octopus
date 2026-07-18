import type { AppEvent } from "@/lib/events/types";

/**
 * Privacy-safe projection of internal AppEvents into the live activity feed.
 *
 * ALLOWLIST BY CONSTRUCTION: each case copies ONLY the explicitly named fields.
 * Free-text content that could carry anything sensitive — PR titles, PR URLs,
 * knowledge document titles, file paths, message bodies — is NEVER included.
 * A repository's full name IS included as the target for repo/community events:
 * it is the org's own resource and the feed is shown to that org's own admins.
 *
 * Returns null for events that are not surfaced in the activity feed (billing
 * alerts, admin/type changes). A leak test asserts no sensitive field escapes.
 */

export type ActorType = "user" | "agent" | "system";

export type ProjectedActivity = {
  action: string;
  target: string | null;
  actorType: ActorType;
  actorId: string | null;
  actorLabel: string | null;
  metadata: Record<string, unknown>;
};

function system(
  action: string,
  target: string | null,
  metadata: Record<string, unknown>,
): ProjectedActivity {
  return { action, target, actorType: "system", actorId: null, actorLabel: null, metadata };
}

export function projectActivity(event: AppEvent): ProjectedActivity | null {
  switch (event.type) {
    case "repo-indexed":
      return event.success
        ? system("repo.indexed", event.repoFullName, { indexedFiles: event.indexedFiles ?? null })
        : system("repo.index_failed", event.repoFullName, {});
    case "repo-analyzed":
      return system("repo.analyzed", event.repoFullName, {});
    case "review-requested":
      // target is the PR NUMBER only — never prTitle/prUrl/prAuthor.
      return system("review.requested", `PR #${event.prNumber}`, { prNumber: event.prNumber });
    case "review-completed":
      return system("review.completed", `PR #${event.prNumber}`, {
        prNumber: event.prNumber,
        findingsCount: event.findingsCount,
        filesChanged: event.filesChanged,
      });
    case "review-failed":
      return system("review.failed", `PR #${event.prNumber}`, { prNumber: event.prNumber });
    case "knowledge-ready":
      // documentTitle is sensitive → excluded entirely; no target.
      return system(`knowledge.${event.action}`, null, { totalChunks: event.totalChunks });
    case "community-review":
      return system("community-review", event.repoFullName, {
        prNumber: event.prNumber ?? null,
        findingsCount: event.findingsCount,
      });
    // Not surfaced in the activity feed:
    case "credit-low": // billing alert
    case "auto-reload-failed": // billing alert
    case "org-type-changed": // admin/audit concern
      return null;
    default:
      return null;
  }
}
