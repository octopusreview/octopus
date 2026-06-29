"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  action: string;
  category: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  createdAt: string;
};

type Filters = {
  category: string;
  actorEmail: string;
  action: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  category: "",
  actorEmail: "",
  action: "",
  from: "",
  to: "",
};

const CATEGORIES = ["", "auth", "email", "review", "repo", "knowledge", "billing", "admin", "system"];

/**
 * Build the URLSearchParams the list AND export endpoints both accept.
 * Both must use the same shape so the export matches the on-screen
 * filtered view (the compliance use case).
 *
 * The `to` field comes from <input type="date"> as "YYYY-MM-DD", and
 * `new Date("YYYY-MM-DD")` parses to midnight UTC of that day. Used as
 * `createdAt lte`, that excludes EVERY event on the selected end day
 * after 00:00:00 UTC — picking from=to=today shows an empty result
 * even when entries exist today. Widen to end-of-day-UTC so the
 * inclusive semantics match what an admin expects from a date picker.
 */
function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.actorEmail) params.set("actorEmail", filters.actorEmail);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", new Date(filters.from + "T00:00:00.000Z").toISOString());
  if (filters.to) params.set("to", new Date(filters.to + "T23:59:59.999Z").toISOString());
  return params;
}

export function AuditLogTable({
  initialEntries,
  initialCursor,
}: {
  initialEntries: Entry[];
  initialCursor: string | null;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const fetchPage = async (reset: boolean) => {
    setLoading(true);
    setError("");
    try {
      const params = filterParams(filters);
      if (!reset && cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/audit-log?${params.toString()}`);
      if (!res.ok) {
        setError(`Load failed: HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { entries: Entry[]; nextCursor: string | null };
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setCursor(data.nextCursor);
    } catch (e) {
      setError(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch from scratch when filters change.
  useEffect(() => {
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.actorEmail, filters.action, filters.from, filters.to]);

  const exportUrl = (format: "csv" | "json"): string => {
    // Forward the SAME filter set the list view uses, so the export
    // matches what the admin sees on screen. Previously this only
    // forwarded category/from/to and silently dropped actorEmail +
    // action — an admin filtering to one actor and clicking 'Export'
    // got every actor's rows in the date range, a compliance-artifact
    // mismatch.
    const params = filterParams(filters);
    params.set("format", format);
    return `/api/audit-log/export?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <select
          className="rounded border border-[#333] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c || "All categories"}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="rounded border border-[#333] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
          placeholder="Actor email"
          value={filters.actorEmail}
          onChange={(e) => setFilters((f) => ({ ...f, actorEmail: e.target.value }))}
        />
        <input
          type="text"
          className="rounded border border-[#333] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
          placeholder="Action (exact)"
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
        />
        <input
          type="date"
          className="rounded border border-[#333] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
        />
        <input
          type="date"
          className="rounded border border-[#333] bg-[#0a0a0a] px-2 py-1 text-sm text-white"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
        />
      </div>

      <div className="mb-3 flex justify-between text-xs text-[#888]">
        <span>{entries.length} entries{cursor ? " (more available)" : ""}</span>
        <span className="flex gap-3">
          <a className="text-cyan-400 underline" href={exportUrl("csv")}>Export CSV</a>
          <a className="text-cyan-400 underline" href={exportUrl("json")}>Export JSON</a>
        </span>
      </div>

      {error ? <div className="mb-3 rounded bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="overflow-x-auto rounded border border-[#222]">
        <table className="w-full text-left text-xs text-[#ccc]">
          <thead className="bg-[#0a0a0a] text-[#888]">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Category</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Actor</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold">IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-[#191919]">
                <td className="px-3 py-2 whitespace-nowrap text-[#888]">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{e.category}</td>
                <td className="px-3 py-2 font-mono">{e.action}</td>
                <td className="px-3 py-2 text-[#888]">{e.actorEmail ?? "—"}</td>
                <td className="px-3 py-2 text-[#888]">
                  {e.targetType ? `${e.targetType}/${e.targetId ?? "?"}` : "—"}
                </td>
                <td className="px-3 py-2 text-[#666]">{e.ipAddress ?? "—"}</td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[#666]">
                  {loading ? "Loading…" : "No audit entries match the filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex justify-center">
        {cursor ? (
          <button
            type="button"
            className="rounded border border-[#333] bg-[#0a0a0a] px-4 py-1.5 text-xs text-white hover:bg-[#181818] disabled:opacity-50"
            disabled={loading}
            onClick={() => fetchPage(false)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
