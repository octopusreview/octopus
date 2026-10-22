import "server-only";
import { randomUUID } from "node:crypto";
import { bestEffort } from "./review-attempt-outcome";

export type ExternalReviewSource = "github_action" | "cli_local" | "cli_repo";
type Activity = {
  source: ExternalReviewSource;
  organizationId: string;
  repositoryId: string | null;
  reportedPrNumber?: unknown;
};

export async function startExternalReviewActivity(id: string, activity: Activity, at: Date): Promise<void> {
  const reportedPrNumber = activity.source === "github_action" &&
    typeof activity.reportedPrNumber === "number" && Number.isInteger(activity.reportedPrNumber) &&
    activity.reportedPrNumber > 0 && activity.reportedPrNumber <= 2_147_483_647
    ? activity.reportedPrNumber : null;
  await bestEffort(tx => tx.$executeRaw`
    INSERT INTO external_review_activity
      (id, source, "organizationId", "repositoryId", "reportedPrNumber", "acceptedAt")
    VALUES (${id}, ${activity.source}, ${activity.organizationId}, ${activity.repositoryId}, ${reportedPrNumber}, ${at}::timestamp)
  `);
}

export async function finishExternalReviewActivity(id: string, outcome: "generated" | "failed", at: Date): Promise<void> {
  await bestEffort(tx => tx.$executeRaw`
    UPDATE external_review_activity SET outcome = ${outcome}, "finishedAt" = ${at}::timestamp
    WHERE id = ${id} AND outcome IS NULL
  `);
}

/** Observe every post-acceptance exit without changing the response or thrown error.
 * Null activity is the community Action path and performs no recording.
 * An empty outcome is unresolved after 24 hours, derived by readers, never failed.
 */
export async function withExternalReviewActivity(activity: Activity | null, review: () => Promise<Response>): Promise<Response> {
  if (!activity) return review();
  const id = randomUUID();
  await startExternalReviewActivity(id, activity, new Date());
  let outcome: "generated" | "failed" = "failed";
  try {
    const response = await review();
    if (response.ok) outcome = "generated";
    return response;
  } finally {
    await finishExternalReviewActivity(id, outcome, new Date());
  }
}
