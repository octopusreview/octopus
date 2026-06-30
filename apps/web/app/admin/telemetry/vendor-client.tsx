"use client";

import { useEffect, useState } from "react";
import type { VendorTelemetry } from "@/lib/vendor-telemetry";

const POLL_MS = 10_000;

export function VendorClient({ initial }: { initial: VendorTelemetry }) {
  const [data, setData] = useState<VendorTelemetry>(initial);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/telemetry", { cache: "no-store" });
        if (!res.ok) return; // 404 if session lapsed — leave last data, stop noise
        const next = (await res.json()) as VendorTelemetry;
        if (!stopped) setData(next);
      } catch {
        /* transient */
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="text-xl font-semibold">Vendor Telemetry</h1>
        <p className="text-sm text-muted-foreground">
          Cross-org activity across all organizations with Live Activity enabled.
          Member names appear only for orgs that opted in to vendor visibility.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Orgs enabled" value={data.totals.orgsEnabled} />
        <Stat label="Members online" value={data.totals.onlineMembers} />
        <Stat label="Agents online" value={data.totals.onlineAgents} />
        <Stat label="Activity (24h)" value={data.totals.activity24h} />
      </div>

      <section className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-2 text-sm font-medium">
          Organizations ({data.orgs.length})
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">Organization</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Agents</th>
                <th className="px-4 py-2 font-medium">Activity (24h)</th>
                <th className="px-4 py-2 font-medium">Online members</th>
              </tr>
            </thead>
            <tbody>
              {data.orgs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No organizations have Live Activity enabled.
                  </td>
                </tr>
              ) : (
                data.orgs.map((o) => (
                  <tr key={o.orgId} className="border-b border-border align-top">
                    <td className="px-4 py-2 font-medium">{o.orgName}</td>
                    <td className="px-4 py-2">{o.onlineMembers}</td>
                    <td className="px-4 py-2">{o.onlineAgents}</td>
                    <td className="px-4 py-2">{o.activity24h}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {o.memberVisible ? (
                        o.members.length === 0 ? (
                          "—"
                        ) : (
                          o.members
                            .map((m) => (m.currentActivity ? `${m.name} (${m.currentActivity})` : m.name))
                            .join(", ")
                        )
                      ) : (
                        <span className="italic">aggregate only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
