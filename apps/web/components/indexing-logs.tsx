"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPubbyClient } from "@/lib/pubby-client";
import { safeIndexLogMessage, WITHHELD_INDEX_LOG } from "@/lib/index-log-safety";
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
  id?: string;
  message: string;
  level: "info" | "success" | "error" | "warning";
  timestamp: number;
}

function logKey(log: LogEntry): string | null {
  if (log.id) return log.id;
  return log.message === WITHHELD_INDEX_LOG ? null : JSON.stringify([log.timestamp, log.level, log.message]);
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
    if (key) {
      // Find the last log with the same progress key and replace it
      const lastIdx = merged.findLastIndex((l) => getProgressKey(l.message) === key);
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
  const [reload, setReload] = useState(0);

  // A retry starts a new log stream. Reconcile saved logs on every status
  // transition as well, so finishing before the subscription mounts is safe.
  useEffect(() => {
    const controller = new AbortController();
    setFetchError(null);
    if (initialStatus === "indexing") setLogs([]);
    fetch(`/api/sync-logs?orgId=${encodeURIComponent(orgId)}&repoId=${encodeURIComponent(repoId)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load indexing logs");
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.logs)) throw new Error("Invalid indexing logs response");
        setLogs((current) => {
          const seen = new Set<string>();
          return [...data.logs as LogEntry[], ...current].map((log) => ({ ...log, message: safeIndexLogMessage(log.message) }))
            .filter((log) => {
              const key = logKey(log);
              if (key === null) return true;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }).sort((a, b) => a.timestamp - b.timestamp);
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetchError("Could not load indexing logs. You can retry loading them without restarting indexing.");
      });
    return () => controller.abort();
  }, [orgId, repoId, initialStatus, reload]);

  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe(`presence-org-${orgId}`);

    const handleLog = (raw: unknown) => {
      const data = raw as { repoId: string; id?: string; message: string; level: LogEntry["level"]; timestamp: number };
      if (data.repoId !== repoId) return;
      const log = { id: data.id, message: safeIndexLogMessage(data.message), level: data.level, timestamp: data.timestamp };
      setLogs((prev) => {
        const key = logKey(log);
        if (key !== null && prev.some((l) => logKey(l) === key)) return prev;
        return [...prev, log];
      });
    };

    const handleStatus = (raw: unknown) => {
      const data = raw as { repoId: string };
      if (data.repoId !== repoId) return;
      router.refresh();
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
