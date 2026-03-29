import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { StatusListener } from "./status-listener";

export const metadata: Metadata = {
  title: "System Status — Octopus",
  description:
    "Real-time system status and incident history for Octopus Review.",
  alternates: {
    canonical: "https://octopus-review.ai/status",
  },
};

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  operational: {
    label: "Operational",
    color: "bg-green-500",
    bg: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  degraded: {
    label: "Degraded Performance",
    color: "bg-yellow-500",
    bg: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  },
  partial_outage: {
    label: "Partial Outage",
    color: "bg-orange-500",
    bg: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
  major_outage: {
    label: "Major Outage",
    color: "bg-red-500",
    bg: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  maintenance: {
    label: "Under Maintenance",
    color: "bg-blue-500",
    bg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical", color: "text-red-400 border-red-500/30 bg-red-500/10" },
  major: { label: "Major", color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
  minor: { label: "Minor", color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" },
  maintenance: { label: "Maintenance", color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
};

function getOverallStatus(
  components: { status: string }[],
): string {
  let overall = "operational";
  for (const comp of components) {
    if (comp.status === "major_outage") return "major_outage";
    if (comp.status === "partial_outage") overall = "partial_outage";
    else if (comp.status === "degraded" && overall === "operational")
      overall = "degraded";
    else if (comp.status === "maintenance" && overall === "operational")
      overall = "maintenance";
  }
  return overall;
}

function statusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function StatusPage() {
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  const isLoggedIn = !!session;

  const [components, activeIncidents, recentResolved] = await Promise.all([
    prisma.statusComponent.findMany({
      where: { isVisible: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.statusIncident.findMany({
      where: { status: { not: "resolved" } },
      orderBy: { createdAt: "desc" },
      include: {
        component: { select: { name: true } },
        updates: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.statusIncident.findMany({
      where: {
        status: "resolved",
        resolvedAt: {
          gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { resolvedAt: "desc" },
      include: {
        component: { select: { name: true } },
        updates: { orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  const overall = getOverallStatus(components);
  const overallConfig = STATUS_CONFIG[overall] ?? STATUS_CONFIG.operational;

  // Group resolved incidents by date
  const resolvedByDate = new Map<string, typeof recentResolved>();
  for (const inc of recentResolved) {
    const dateKey = (inc.resolvedAt ?? inc.createdAt)
      .toISOString()
      .split("T")[0];
    if (!resolvedByDate.has(dateKey)) resolvedByDate.set(dateKey, []);
    resolvedByDate.get(dateKey)!.push(inc);
  }

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <StatusListener />
      <LandingDesktopNav isLoggedIn={isLoggedIn} />
      <LandingMobileNav isLoggedIn={isLoggedIn} />

      <main className="mx-auto max-w-3xl px-6 pt-32 pb-20">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            System Status
          </h1>
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium ${overallConfig.bg}`}
          >
            <span
              className={`size-2.5 rounded-full ${overallConfig.color}`}
            />
            {overallConfig.label === "Operational"
              ? "All Systems Operational"
              : overallConfig.label}
          </div>
        </div>

        {/* Components */}
        {components.length > 0 && (
          <div className="mb-12 rounded-xl border border-white/[0.06] overflow-hidden">
            {components.map((comp, i) => {
              const config =
                STATUS_CONFIG[comp.status] ?? STATUS_CONFIG.operational;
              return (
                <div
                  key={comp.id}
                  className={`flex items-center justify-between px-5 py-4 ${
                    i < components.length - 1
                      ? "border-b border-white/[0.06]"
                      : ""
                  }`}
                >
                  <div>
                    <span className="font-medium">{comp.name}</span>
                    {comp.description && (
                      <p className="text-sm text-[#666]">{comp.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#888]">
                      {config.label}
                    </span>
                    <span
                      className={`size-2.5 rounded-full ${config.color}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active Incidents */}
        {activeIncidents.length > 0 && (
          <div className="mb-12 space-y-6">
            <h2 className="text-xl font-bold">Active Incidents</h2>
            {activeIncidents.map((inc) => {
              const sevConfig =
                SEVERITY_CONFIG[inc.severity] ?? SEVERITY_CONFIG.minor;
              return (
                <div
                  key={inc.id}
                  className="rounded-xl border border-white/[0.06] p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-lg">{inc.title}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${sevConfig.color}`}
                        >
                          {sevConfig.label}
                        </span>
                        {inc.component && (
                          <span className="text-[#666]">
                            {inc.component.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm text-[#555]">
                      {inc.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Timeline */}
                  <div className="space-y-3 border-l-2 border-white/[0.08] pl-4">
                    <div>
                      <div className="text-xs text-[#555] mb-1">
                        <span className="font-medium text-[#888]">
                          Investigating
                        </span>{" "}
                        —{" "}
                        {inc.createdAt.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <p className="text-sm text-[#999] whitespace-pre-wrap">
                        {inc.message}
                      </p>
                    </div>
                    {inc.updates.map((upd) => (
                      <div key={upd.id}>
                        <div className="text-xs text-[#555] mb-1">
                          <span className="font-medium text-[#888]">
                            {statusLabel(upd.status)}
                          </span>{" "}
                          —{" "}
                          {upd.createdAt.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <p className="text-sm text-[#999] whitespace-pre-wrap">
                          {upd.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resolved Incidents (last 14 days) */}
        {resolvedByDate.size > 0 && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Past Incidents</h2>
            {Array.from(resolvedByDate.entries()).map(([date, incs]) => (
              <div key={date}>
                <h3 className="mb-3 text-sm font-semibold text-[#888]">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </h3>
                <div className="space-y-3">
                  {incs.map((inc) => {
                    const sevConfig =
                      SEVERITY_CONFIG[inc.severity] ?? SEVERITY_CONFIG.minor;
                    return (
                      <div
                        key={inc.id}
                        className="rounded-lg border border-white/[0.06] p-4"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="size-2 rounded-full bg-green-500" />
                          <span className="font-medium text-sm">
                            {inc.title}
                          </span>
                          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                            Resolved
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${sevConfig.color}`}
                          >
                            {sevConfig.label}
                          </span>
                          {inc.component && (
                            <span className="text-xs text-[#555]">
                              {inc.component.name}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2 border-l-2 border-white/[0.06] pl-3">
                          <div className="text-xs text-[#555]">
                            <span className="text-[#777]">Investigating</span>
                            {" — "}
                            <span className="text-[#999]">{inc.message}</span>
                          </div>
                          {inc.updates.map((upd) => (
                            <div key={upd.id} className="text-xs text-[#555]">
                              <span className="text-[#777]">
                                {statusLabel(upd.status)}
                              </span>
                              {" — "}
                              <span className="text-[#999]">{upd.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeIncidents.length === 0 && resolvedByDate.size === 0 && (
          <p className="text-center text-[#555]">
            No incidents reported in the last 14 days.
          </p>
        )}
      </main>

      <LandingFooter />
    </div>
  );
}
