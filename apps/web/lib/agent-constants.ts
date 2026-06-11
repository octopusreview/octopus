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
 * Used by:
 * - `apps/web/lib/providers/local.ts` — fail-fast check before dispatching
 *   to a stale agent.
 * - `apps/web/app/api/agent/status/route.ts` — the status endpoint the
 *   settings UI polls.
 * - `apps/web/app/(app)/settings/integrations/local-agent/page.tsx` — the
 *   "online / offline" badge on the integrations page.
 * - `apps/web/lib/agent-search.ts` — agent-search dispatch.
 */
export const AGENT_STALE_THRESHOLD_MS = 90_000;
