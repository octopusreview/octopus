import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { drainStatus, expireDrainLease, markQuiescent, renewDrainLease, requestDrain, resumeClaiming } from "@/lib/queue-drain";

// Vendor admin machine endpoint: stop queue workers claiming before a rollout,
// watch the in-flight work finish, and resume. Guarded by the shared
// ADMIN_API_SECRET bearer (inert on self-host). Any instance can serve it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEADLINE_SECONDS = [60, 3600];
const LEASE_SECONDS = [30, 600];

const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const invalid = () => respond({ error: "Invalid request" }, 400);
// Database errors can carry statement text; the caller gets none of it.
const unavailable = (error: unknown) => {
  console.error("[admin/queue-drain] failed:", error instanceof Error ? error.name : "unknown error");
  return respond({ error: "Queue drain unavailable" }, 503);
};
const integer = (value: unknown, [min, max]: number[]): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
// Stored and shown to operators: printable ASCII only, at most 100 characters.
const label = (value: unknown): value is string => typeof value === "string" && /^[\x20-\x7e]{1,100}$/.test(value);

/**
 * "quiescent" is only answered once it is recorded, so the deadline, which bounds only the wait,
 * cannot end the drain during the release. If recording fails the drain has ended; read that.
 */
async function recordedStatus() {
  const status = await drainStatus();
  if (status.outcome !== "quiescent" || await markQuiescent(status.generation)) return status;
  return drainStatus();
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) return respond({ error: "Unauthorized" }, 401);
  try {
    // Not side-effect free: reading the status of a running drain renews its lease, so a caller
    // that keeps polling keeps the drain alive and one that disappears lets it expire. It also
    // ends a drain that is past its lease or deadline, so that does not depend on a worker being up.
    await expireDrainLease();
    const status = await drainStatus();
    if (status.state === "draining") await renewDrainLease(status.generation);
    return respond(await recordedStatus());
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) return respond({ error: "Unauthorized" }, 401);
  let input: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
    input = body as Record<string, unknown>;
  } catch {
    return invalid();
  }
  try {
    if (input.action === "drain") {
      const { deadlineSeconds, leaseSeconds, requestedBy } = input;
      if ((deadlineSeconds !== undefined && !integer(deadlineSeconds, DEADLINE_SECONDS)) ||
          (leaseSeconds !== undefined && !integer(leaseSeconds, LEASE_SECONDS)) || !label(requestedBy)) return invalid();
      const { generation } = await requestDrain({ deadlineSeconds, leaseSeconds, requestedBy });
      return respond({ generation, status: await recordedStatus() });
    }
    if (input.action === "resume") {
      const { generation, reason = "requested" } = input;
      // These are the reasons recorded when a drain ends by itself; status reports them as outcomes.
      if (!integer(generation, [0, 2_147_483_647]) || !label(reason) || reason === "lease_expired" || reason === "timed_out") return invalid();
      // A stale generation is not an error: the drain it named is already over.
      const resumed = await resumeClaiming({ generation, reason });
      return respond({ resumed, status: await recordedStatus() });
    }
    return invalid();
  } catch (error) {
    return unavailable(error);
  }
}
