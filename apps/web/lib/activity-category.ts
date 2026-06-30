/**
 * Coarse activity categories for live presence. This module is intentionally
 * dependency-free so BOTH the client reporter and the server ingest route can
 * import it. Presence only ever records WHICH AREA of the app a member is in —
 * never the full path, query string, ids, or any resource name — so no
 * sensitive data (repo names, PR titles, doc titles) can leak via presence.
 */

export const ACTIVITY_CATEGORIES = [
  "Dashboard",
  "Repositories",
  "Reviews",
  "Chat",
  "Knowledge",
  "Usage",
  "Settings",
  "Other",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(ACTIVITY_CATEGORIES);

/** Server-side guard: only accept a known coarse category from the client. */
export function isValidActivity(value: unknown): value is ActivityCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

/**
 * Map a pathname to a coarse category using ONLY its first path segment —
 * deeper segments (ids, repo names, query strings) are deliberately ignored.
 */
export function categorizePath(pathname: string): ActivityCategory {
  const seg = pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  switch (seg) {
    case "":
    case "dashboard":
      return "Dashboard";
    case "repositories":
    case "repos":
      return "Repositories";
    case "reviews":
    case "review":
      return "Reviews";
    case "chat":
      return "Chat";
    case "knowledge":
      return "Knowledge";
    case "usage":
      return "Usage";
    case "settings":
      return "Settings";
    default:
      return "Other";
  }
}
