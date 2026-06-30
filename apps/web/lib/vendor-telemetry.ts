import { prisma } from "@octopus/db";
import { getOnlinePresence } from "@/lib/presence";
import { AGENT_STALE_THRESHOLD_MS } from "@/lib/agent-constants";

/**
 * Cross-org telemetry aggregation for the vendor (Octopus staff) console.
 *
 * Privacy contract: org-level AGGREGATES by default (counts + volume, no member
 * identities). Member-level detail (names) is included ONLY for orgs that have
 * explicitly set `allowVendorMemberVisibility` — a separate opt-in from the
 * org's own internal `liveTelemetryEnabled`. So enabling internal monitoring
 * does NOT expose your named employees to the vendor.
 *
 * Cached behind a short in-process TTL so repeated page loads / polls don't
 * re-run the cross-org scans.
 */

export type VendorOrgRow = {
  orgId: string;
  orgName: string;
  onlineMembers: number;
  onlineAgents: number;
  activity24h: number;
  memberVisible: boolean; // whether this org opted in to member-level detail
  members: { name: string; currentActivity: string | null }[]; // only when memberVisible
};

export type VendorTelemetry = {
  totals: {
    orgsEnabled: number;
    onlineMembers: number;
    onlineAgents: number;
    activity24h: number;
  };
  orgs: VendorOrgRow[];
  generatedAt: number;
};

let cache: { at: number; data: VendorTelemetry } | null = null;
const CACHE_TTL_MS = 5_000;

export async function getVendorTelemetry(): Promise<VendorTelemetry> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  // Orgs that have turned on live telemetry (the only orgs that collect).
  const orgs = await prisma.organization.findMany({
    where: { liveTelemetryEnabled: true, deletedAt: null },
    select: { id: true, name: true, allowVendorMemberVisibility: true },
  });
  const enabledOrgIds = orgs.map((o) => o.id);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agentStale = new Date(Date.now() - AGENT_STALE_THRESHOLD_MS);

  // Per-org online-agent counts + 24h activity volume, in two grouped queries.
  // Scoped to the enabled-org set so the cross-org totals NEVER count orgs that
  // didn't opt into telemetry (e.g. an org merely running an agent) and match
  // the sum of the per-org rows.
  const [agentGroups, activityGroups, presences] = await Promise.all([
    prisma.localAgent.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: enabledOrgIds }, status: "online", lastSeenAt: { gte: agentStale } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: enabledOrgIds }, createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    // Read presence for all orgs concurrently (getOnlinePresence never throws).
    Promise.all(orgs.map((o) => getOnlinePresence(o.id))),
  ]);
  const agentCount = new Map(agentGroups.map((g) => [g.organizationId, g._count._all]));
  const activityCount = new Map(activityGroups.map((g) => [g.organizationId, g._count._all]));

  const rows: VendorOrgRow[] = [];
  let onlineMembersTotal = 0;
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    const presence = presences[i];
    onlineMembersTotal += presence.length;

    let members: { name: string; currentActivity: string | null }[] = [];
    if (org.allowVendorMemberVisibility && presence.length > 0) {
      const userIds = [...new Set(presence.map((p) => p.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      members = presence.map((p) => ({
        name: nameById.get(p.userId) ?? "Unknown",
        currentActivity: p.currentActivity,
      }));
    }

    rows.push({
      orgId: org.id,
      orgName: org.name,
      onlineMembers: presence.length,
      onlineAgents: agentCount.get(org.id) ?? 0,
      activity24h: activityCount.get(org.id) ?? 0,
      memberVisible: org.allowVendorMemberVisibility,
      members,
    });
  }

  rows.sort((a, b) => b.onlineMembers + b.onlineAgents - (a.onlineMembers + a.onlineAgents));

  const data: VendorTelemetry = {
    totals: {
      orgsEnabled: orgs.length,
      onlineMembers: onlineMembersTotal,
      onlineAgents: [...agentCount.values()].reduce((a, b) => a + b, 0),
      activity24h: [...activityCount.values()].reduce((a, b) => a + b, 0),
    },
    orgs: rows,
    generatedAt: Date.now(),
  };

  cache = { at: Date.now(), data };
  return data;
}
