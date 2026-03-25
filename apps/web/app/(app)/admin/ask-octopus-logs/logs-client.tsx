"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconFlag,
  IconFlagOff,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconSearch,
  IconFilter,
} from "@tabler/icons-react";
import { toggleFlag } from "./actions";

interface SessionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  fingerprint: string;
  ipAddress: string;
  userAgent: string | null;
  country: string | null;
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
  messageCount: number;
  messages: SessionMessage[];
}

export function AskOctopusLogsClient({
  sessions,
  page,
  totalPages,
  flaggedOnly,
  search,
}: {
  sessions: ChatSession[];
  page: number;
  totalPages: number;
  flaggedOnly: boolean;
  search: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(search);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);

  function buildUrl(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    if (params.page && params.page !== "1") sp.set("page", params.page);
    if (params.flagged === "true") sp.set("flagged", "true");
    if (params.search) sp.set("search", params.search);
    const qs = sp.toString();
    return `/admin/ask-octopus-logs${qs ? `?${qs}` : ""}`;
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(buildUrl({ search: searchInput || undefined, flagged: flaggedOnly ? "true" : undefined }));
  }

  async function handleFlag(sessionId: string, flag: boolean) {
    setFlaggingId(sessionId);
    const reason = flag ? prompt("Flag reason (optional):") ?? undefined : undefined;
    await toggleFlag(sessionId, flag, reason);
    setFlaggingId(null);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
            <IconSearch className="size-4 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search IP, fingerprint, or content..."
              className="w-64 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </form>

        <button
          onClick={() =>
            router.push(buildUrl({ flagged: flaggedOnly ? undefined : "true", search: searchInput || undefined }))
          }
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            flaggedOnly
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              : "hover:bg-muted"
          }`}
        >
          <IconFilter className="size-3.5" />
          {flaggedOnly ? "Showing flagged only" : "Filter flagged"}
        </button>
      </div>

      {/* Sessions list */}
      <div className="rounded-lg border">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No sessions found.
          </div>
        ) : (
          <div className="divide-y">
            {sessions.map((s) => {
              const isExpanded = expandedId === s.id;
              const firstUserMsg = s.messages.find((m) => m.role === "user");

              return (
                <div key={s.id}>
                  {/* Session row */}
                  <div
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 ${
                      s.flagged ? "bg-red-50/50 dark:bg-red-950/20" : ""
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : s.id)}
                  >
                    {isExpanded ? (
                      <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {s.flagged && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                            FLAGGED
                          </span>
                        )}
                        <span className="truncate text-sm font-medium">
                          {firstUserMsg?.content || "Empty session"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{s.ipAddress}</span>
                        <span>fp:{s.fingerprint.slice(0, 12)}...</span>
                        <span>{s.messageCount} msg{s.messageCount !== 1 ? "s" : ""}</span>
                        <span>{new Date(s.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFlag(s.id, !s.flagged);
                      }}
                      disabled={flaggingId === s.id}
                      className={`shrink-0 rounded-md p-1.5 transition-colors ${
                        s.flagged
                          ? "text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      title={s.flagged ? "Unflag session" : "Flag session"}
                    >
                      {s.flagged ? <IconFlag className="size-4" /> : <IconFlagOff className="size-4" />}
                    </button>
                  </div>

                  {/* Expanded messages */}
                  {isExpanded && (
                    <div className="border-t bg-muted/30 px-4 py-3">
                      {/* Session details */}
                      <div className="mb-3 space-y-2 rounded-md bg-muted/50 p-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">IP: </span>
                          <span className="font-mono">{s.ipAddress}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Fingerprint: </span>
                          <span className="font-mono text-[11px]">{s.fingerprint}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">User Agent: </span>
                          <span>{s.userAgent || "N/A"}</span>
                        </div>
                        {s.flagReason && (
                          <div>
                            <span className="text-red-500">Flag reason: </span>
                            <span>{s.flagReason}</span>
                          </div>
                        )}
                      </div>

                      {/* Messages */}
                      <div className="space-y-2">
                        {s.messages.map((m) => (
                          <div
                            key={m.id}
                            className={`rounded-lg px-3 py-2 text-sm ${
                              m.role === "user"
                                ? "ml-8 bg-primary/10"
                                : "mr-8 bg-background"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                                {m.role}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(m.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="whitespace-pre-wrap break-words text-xs">{m.content}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() =>
                router.push(
                  buildUrl({
                    page: String(page - 1),
                    flagged: flaggedOnly ? "true" : undefined,
                    search: search || undefined,
                  }),
                )
              }
              disabled={page <= 1}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              <IconChevronLeft className="size-4" />
              Prev
            </button>
            <button
              onClick={() =>
                router.push(
                  buildUrl({
                    page: String(page + 1),
                    flagged: flaggedOnly ? "true" : undefined,
                    search: search || undefined,
                  }),
                )
              }
              disabled={page >= totalPages}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              Next
              <IconChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
