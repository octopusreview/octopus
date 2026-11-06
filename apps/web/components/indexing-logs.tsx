"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPubbyClient } from "@/lib/pubby-client";
import { getRepositoryConnectionRecovery } from "@/lib/repository-connection-recovery";
import {
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconLoader2,
  IconTerminal,
  IconPoint,
  IconExternalLink,
} from "@tabler/icons-react";

interface LogEntry {
  message: string;
  level: "info" | "success" | "error" | "warning";
  timestamp: number;
  indexAttemptId?: string;
  live?: boolean;
}

function logKey(log: LogEntry): string {
  return JSON.stringify([log.indexAttemptId ?? null, log.timestamp, log.level, log.message]);
}

function LogIcon({ level, isActive }: { level: LogEntry["level"]; isActive: boolean }) {
  if (level === "success") {
    return <IconCircleCheck className="size-3.5 shrink-0 text-emerald-400" />;
  }
  if (level === "error") {
    return <IconCircleX className="size-3.5 shrink-0 text-red-400" />;
  }
  if (level === "warning") {
    return <IconAlertTriangle className="size-3.5 shrink-0 text-amber-400" />;
  }
  // info: only spin if this is the active (last) info line
  if (isActive) {
    return <IconLoader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />;
  }
  return <IconPoint className="size-3.5 shrink-0 text-zinc-500" />;
}

const levelColor: Record<LogEntry["level"], string> = {
  info: "text-zinc-300",
  success: "text-emerald-400",
  error: "text-red-400",
  warning: "text-amber-400",
};

// Patterns that should replace the previous log line instead of appending
const PROGRESS_PATTERNS = [
  /^Processing files\.\.\./,
  /^Processing embedding batch /,
  /^Storing \d+ vectors/,
];


function getProgressKey(message: string): string | null {
  for (const p of PROGRESS_PATTERNS) {
    if (p.test(message)) return p.source;
  }
  return null;
}

function parseProgress(message: string): { label: string; current: number; total: number; percent: number } | null {
  // "Processing files... 30/98"
  const filesMatch = message.match(/^(Processing files\.\.\.)\s*(\d+)\/(\d+)/);
  if (filesMatch) {
    const current = parseInt(filesMatch[2], 10);
    const total = parseInt(filesMatch[3], 10);
    return { label: "Processing files", current, total, percent: Math.round((current / total) * 100) };
  }
  // "Processing embedding batch 2/5..."
  const batchMatch = message.match(/^(Processing embedding batch)\s*(\d+)\/(\d+)/);
  if (batchMatch) {
    const current = parseInt(batchMatch[2], 10);
    const total = parseInt(batchMatch[3], 10);
    return { label: "Generating embeddings", current, total, percent: Math.round((current / total) * 100) };
  }
  return null;
}

function mergeProgressLogs(logs: LogEntry[]): LogEntry[] {
  const merged: LogEntry[] = [];
  for (const log of logs) {
    const key = getProgressKey(log.message);
    if (key && !(log.live && !log.indexAttemptId)) {
      // Find the last log with the same progress key and replace it
      const lastIdx = merged.findLastIndex((l) => !(l.live && !l.indexAttemptId) && getProgressKey(l.message) === key);
      if (lastIdx !== -1) {
        merged[lastIdx] = log;
        continue;
      }
    }
    merged.push(log);
  }
  return merged;
}

export function IndexingLogs({
  repoId,
  orgId,
  initialStatus,
  provider,
}: {
  repoId: string;
  orgId: string;
  initialStatus: string;
  provider: string;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [logsMayBeMissing, setLogsMayBeMissing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [legacyLogsMayBeMixed, setLegacyLogsMayBeMixed] = useState(false);
  const [reload, setReload] = useState(0);
  const currentAttempt = useRef<string | null | undefined>(undefined);
  const persistedAttempt = useRef<string | null | undefined>(undefined);
  const pendingLogs = useRef<LogEntry[]>([]);
  const hasUnattributedLive = useRef(false);
  const incompleteAttempts = useRef(new Map<string | null, object>());
  const unattributedMissingLogs = useRef<object | null>(null);
  const verifiedUnattributed = useRef<object | null>(null);
  const rejectedAttempts = useRef(new Map<string | null, number>());
  const refreshingAttempt = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAt = useRef(0);
  const retryDelay = useRef(0);
  const logScope = useRef(JSON.stringify([orgId, repoId]));
  const previousStatus = useRef(initialStatus);

  function scheduleRefresh(delay: number) {
    // Once attribution overflows, avoid repeated owner lookups from a stale event stream.
    if (unattributedMissingLogs.current) delay = Math.max(delay, 5000);
    const at = Date.now() + delay;
    if (refreshTimer.current) {
      if (refreshAt.current <= at) return;
      clearTimeout(refreshTimer.current);
    } else if (refreshingAttempt.current) return;
    refreshingAttempt.current = true;
    refreshAt.current = at;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setReload((value) => value + 1);
    }, delay);
  }

  function refreshDelay(attempt: string | null) {
    return Math.max(250, (rejectedAttempts.current.get(attempt) ?? 0) + 5000 - Date.now());
  }

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // A retry starts a new log stream. Reconcile saved logs on every status
  // transition as well, so finishing before the subscription mounts is safe.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 5000);
    setFetchError(null);
    const scope = JSON.stringify([orgId, repoId]);
    if (scope !== logScope.current) {
      logScope.current = scope;
      persistedAttempt.current = undefined;
      previousStatus.current = initialStatus;
      pendingLogs.current = [];
      hasUnattributedLive.current = false;
      incompleteAttempts.current.clear();
      unattributedMissingLogs.current = null;
      verifiedUnattributed.current = null;
      setLogsMayBeMissing(false);
      setTruncated(false);
      setLegacyLogsMayBeMixed(false);
      rejectedAttempts.current.clear();
      retryDelay.current = 0;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      refreshingAttempt.current = false;
      setLogs([]);
    }
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    currentAttempt.current = undefined;
    refreshingAttempt.current = true;
    const checked = new Set(pendingLogs.current);
    const checkedIncomplete = new Map(incompleteAttempts.current);
    const checkedUnattributed = unattributedMissingLogs.current;
    if (initialStatus === "indexing" && previousStatus.current !== "indexing") setLegacyLogsMayBeMixed(true);
    previousStatus.current = initialStatus;
    fetch(`/api/sync-logs?orgId=${encodeURIComponent(orgId)}&repoId=${encodeURIComponent(repoId)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load indexing logs");
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.logs)) throw new Error("Invalid indexing logs response");
        const attempt = typeof data.attempt === "string" ? data.attempt : null;
        const identity = data.indexAttemptId;
        const validIdentity = identity === null || (typeof identity === "string" && identity.length > 0);
        const replaced = validIdentity && persistedAttempt.current !== undefined && identity !== persistedAttempt.current;
        if (validIdentity) persistedAttempt.current = identity;
        setLegacyLogsMayBeMixed(!attempt || hasUnattributedLive.current);
        setTruncated(data.truncated === true);
        for (const [id, marker] of checkedIncomplete) {
          if (id !== null && id !== attempt && incompleteAttempts.current.get(id) === marker) incompleteAttempts.current.delete(id);
        }
        setLogsMayBeMissing(!!unattributedMissingLogs.current || incompleteAttempts.current.has(null) || incompleteAttempts.current.has(attempt));
        retryDelay.current = 0;
        currentAttempt.current = attempt;
        refreshingAttempt.current = false;
        const pending = pendingLogs.current;
        pendingLogs.current = pending.filter((log) => !!log.indexAttemptId && log.indexAttemptId !== attempt && !checked.has(log));
        rejectedAttempts.current.delete(attempt);
        for (const log of pending) {
          const logAttempt = log.indexAttemptId ?? null;
          if (logAttempt !== null && logAttempt !== attempt && checked.has(log)) {
            rejectedAttempts.current.delete(logAttempt);
            rejectedAttempts.current.set(logAttempt, Date.now());
            if (rejectedAttempts.current.size > 500) {
              rejectedAttempts.current.delete(rejectedAttempts.current.keys().next().value!);
            }
          }
        }
        setLogs((current) => {
          const entries = new Map<string, LogEntry>();
          const saved = (data.logs as LogEntry[]).map((log) => ({ ...log, live: false }));
          for (const log of [...saved, ...current.filter((log) => !replaced || log.live), ...pending]) {
            if (attempt ? log.indexAttemptId === attempt || (log.live && !log.indexAttemptId) : !log.indexAttemptId) entries.set(logKey(log), log);
          }
          return [...entries.values()].sort((a, b) => a.timestamp - b.timestamp);
        });
        const uncheckedAttempts = [...incompleteAttempts.current.keys()].filter((id) => id !== null && id !== attempt);
        verifiedUnattributed.current = checkedUnattributed;
        const unverifiedOverflow = unattributedMissingLogs.current !== verifiedUnattributed.current;
        if (pendingLogs.current.length || uncheckedAttempts.length || unverifiedOverflow) {
          const pendingDelay = pendingLogs.current.reduce((delay, log) => Math.min(delay, refreshDelay(log.indexAttemptId ?? null)), Infinity);
          const attemptDelay = uncheckedAttempts.reduce((delay, id) => Math.min(delay, refreshDelay(id)), pendingDelay);
          // Unattributed evictions may belong to a replacement; recheck without a rapid retry loop.
          scheduleRefresh(unverifiedOverflow ? 5000 : attemptDelay);
        }
      })
      .catch(() => {
        if (!cancelled) {
          refreshingAttempt.current = false;
          setFetchError("Could not load indexing logs. You can retry loading them without restarting indexing.");
          retryDelay.current = Math.min(retryDelay.current ? retryDelay.current * 2 : 1000, 30000);
          if (pendingLogs.current.length || incompleteAttempts.current.size || unattributedMissingLogs.current !== verifiedUnattributed.current) scheduleRefresh(retryDelay.current);
        }
      }).finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [orgId, repoId, initialStatus, reload]);

  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe(`presence-org-${orgId}`);

    const handleLog = (raw: unknown) => {
      const event = raw as LogEntry & { repoId: string };
      if (event.repoId !== repoId) return;
      const data = { ...event, live: true };
      if (!data.indexAttemptId) {
        hasUnattributedLive.current = true;
        setLegacyLogsMayBeMixed(true);
      }
      if (currentAttempt.current === undefined || (refreshingAttempt.current && !refreshTimer.current) ||
          (!!data.indexAttemptId && data.indexAttemptId !== currentAttempt.current)) {
        // shortcut: old pending messages may be omitted during an outage, add paginated backfill to recover them.
        if (pendingLogs.current.length >= 1000) {
          const dropped = pendingLogs.current.shift()!;
          const droppedAttempt = dropped.indexAttemptId ?? null;
          if (!incompleteAttempts.current.has(droppedAttempt) && incompleteAttempts.current.size >= 1000) {
            unattributedMissingLogs.current = {};
          } else {
            incompleteAttempts.current.set(droppedAttempt, {});
          }
          setLogsMayBeMissing(true);
        }
        pendingLogs.current.push(data);
        scheduleRefresh(currentAttempt.current === undefined ? retryDelay.current || 1000 : refreshDelay(data.indexAttemptId ?? null));
        return;
      }
      setLogs((prev) => {
        if (prev.some((l) => logKey(l) === logKey(data))) {
          return prev.map((l) => logKey(l) === logKey(data) && !data.indexAttemptId ? { ...l, live: true } : l);
        }
        return [...prev, data];
      });
    };

    const handleStatus = (raw: unknown) => {
      const data = raw as { repoId: string };
      if (data.repoId !== repoId) return;
      router.refresh();
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      refreshingAttempt.current = true;
      setReload((value) => value + 1);
    };

    channel.bind("index-log", handleLog);
    channel.bind("index-status", handleStatus);

    return () => {
      channel.unbind("index-log", handleLog);
      channel.unbind("index-status", handleStatus);
    };
  }, [repoId, orgId, router]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const isComplete = initialStatus !== "indexing";
  const displayLogs = mergeProgressLogs(logs);
  const recovery = getRepositoryConnectionRecovery(provider, orgId, `/repositories?repo=${repoId}`);

  // Find the index of the last info log to determine which one should spin
  let lastInfoIndex = -1;
  if (!isComplete) {
    for (let i = displayLogs.length - 1; i >= 0; i--) {
      if (displayLogs[i].level === "info") {
        lastInfoIndex = i;
        break;
      }
    }
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <IconTerminal className="size-4 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400">Indexing Logs</span>
        {!isComplete && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-blue-400">
            <IconLoader2 className="size-3 animate-spin" />
            Running
          </span>
        )}
        {initialStatus === "indexed" && (
          <span className="ml-auto text-xs text-emerald-400">Completed</span>
        )}
        {initialStatus === "failed" && (
          <span className="ml-auto text-xs text-red-400">Failed</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
      >
        <div role="status" className="mb-3 text-amber-300">
          Saved indexing messages may be incomplete.
        </div>
        {legacyLogsMayBeMixed && (
          <div role="alert" className="mb-3 text-amber-300">
            Indexing messages may include multiple attempts or be missing.
          </div>
        )}
        {truncated && (
          <div role="alert" className="mb-3 text-amber-300">
            Older indexing messages are not shown.
          </div>
        )}
        {logsMayBeMissing && (
          <div role="alert" className="mb-3 text-amber-300">
            Some indexing messages may be missing while logs were loading.
          </div>
        )}
        {fetchError && (
          <div role="alert" className="mb-3 text-amber-300">
            <p>{fetchError}</p>
            <button type="button" className="mt-1 underline underline-offset-2" onClick={() => setReload((value) => value + 1)}>Retry loading logs</button>
          </div>
        )}
        {logs.length === 0 && initialStatus === "indexing" && (
          <div className="flex items-center gap-2 text-zinc-500">
            <IconLoader2 className="size-3.5 animate-spin" />
            Waiting for logs...
          </div>
        )}

        {displayLogs.map((log, i) => {
          const progress = parseProgress(log.message);
          return (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="mt-0.5">
                <LogIcon level={log.level} isActive={i === lastInfoIndex} />
              </span>
              {progress ? (
                <div className="flex flex-1 items-center gap-2">
                  <span className={levelColor[log.level]}>{progress.label}</span>
                  <div className="flex flex-1 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-zinc-500">{progress.current}/{progress.total}</span>
                  </div>
                </div>
              ) : (
                <span className={levelColor[log.level]}>{log.message}</span>
              )}
            </div>
          );
        })}

        {initialStatus === "failed" && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <a
              href={recovery.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              <IconExternalLink className="size-3" />
              {recovery.label}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
