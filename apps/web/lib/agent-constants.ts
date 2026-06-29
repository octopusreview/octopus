/**
 * Shared constants for the LocalAgent <-> cloud-Octopus bridge.
 *
 * These values need to agree across the heartbeat writer, the staleness
 * readers, and the UI badge — sharing them prevents drift where one
 * surface considers an agent online and another doesn't.
 */

/**
 * How long after the most recent heartbeat we still consider an agent
 * "online". The heartbeat endpoint writes `lastSeenAt = now` every
 * 30s (HEARTBEAT_INTERVAL_MS in the CLI), so 90s gives the agent two
 * full heartbeat windows of slack before we treat it as stale.
 *
 * Used by `apps/web/lib/providers/local.ts` (fail-fast check before
 * dispatching to a stale agent). `/api/agent/status` and `agent-search.ts`
 * apply the same 90s window inline today; they can adopt this constant in a
 * follow-up to remove the duplication.
 */
export const AGENT_STALE_THRESHOLD_MS = 90_000;
