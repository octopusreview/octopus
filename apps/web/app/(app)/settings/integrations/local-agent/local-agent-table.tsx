"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Agent = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  capabilities: string[];
  machineInfo: Record<string, string> | null;
  createdAt: string;
};

export function LocalAgentTable({
  agents,
  canRevoke,
}: {
  agents: Agent[];
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  // The id of the agent whose Revoke button is in "confirm" state. Resets after
  // 5s of inactivity so an accidental first-click doesn't sit primed forever.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  if (agents.length === 0) {
    return (
      <div className="rounded border border-[#222] p-6 text-center text-sm text-[#888]">
        No agents registered yet. Start one with <code className="text-white">octp agent serve</code>.
      </div>
    );
  }

  const armConfirm = (id: string) => {
    setConfirmingId(id);
    setError("");
    // Auto-disarm after 5s so a stray first-click doesn't leave the button
    // primed indefinitely.
    setTimeout(() => {
      setConfirmingId((current) => (current === id ? null : current));
    }, 5000);
  };

  const onRevoke = async (id: string) => {
    setRevoking(id);
    setConfirmingId(null);
    setError("");
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`Revoke failed: HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(`Revoke failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div>
      {error ? <div className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div> : null}
      <div className="overflow-x-auto rounded border border-[#222]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0a0a0a] text-[#888]">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Last seen</th>
              <th className="px-3 py-2 font-semibold">Capabilities</th>
              <th className="px-3 py-2 font-semibold">Machine</th>
              {canRevoke ? <th className="px-3 py-2 font-semibold">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t border-[#191919] align-top text-[#ccc]">
                <td className="px-3 py-2 font-mono">{a.name}</td>
                <td className="px-3 py-2">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-3 py-2 text-[#888]">
                  {a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : "never"}
                </td>
                <td className="px-3 py-2 text-[#888]">
                  {a.capabilities.length > 0 ? a.capabilities.join(", ") : "—"}
                </td>
                <td className="px-3 py-2 text-[#888]">
                  {a.machineInfo
                    ? `${a.machineInfo.os ?? "?"} · ${a.machineInfo.hostname ?? "?"} · node ${a.machineInfo.nodeVersion ?? "?"}`
                    : "—"}
                </td>
                {canRevoke ? (
                  <td className="px-3 py-2">
                    {confirmingId === a.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded border border-red-700 bg-red-950 px-2 py-1 text-[11px] font-semibold text-red-100 hover:bg-red-900 disabled:opacity-50"
                          disabled={revoking === a.id}
                          onClick={() => onRevoke(a.id)}
                        >
                          Confirm revoke
                        </button>
                        <button
                          type="button"
                          className="rounded border border-[#333] px-2 py-1 text-[11px] text-[#888] hover:bg-[#1a1a1a]"
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="rounded border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-200 hover:bg-red-950 disabled:opacity-50"
                        disabled={revoking === a.id}
                        onClick={() => armConfirm(a.id)}
                      >
                        {revoking === a.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "online" ? "bg-green-950 text-green-300" : "bg-[#1a1a1a] text-[#888]";
  return <span className={`rounded px-2 py-0.5 text-[11px] ${color}`}>{status}</span>;
}
