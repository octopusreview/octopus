// STUB: Elasticsearch sync-log indexing disabled for Databricks demo deployment.
// writeSyncLog() prints to console; getSyncLogs() returns empty array.
// Original Elasticsearch implementation removed — bring back from git history if needed.

export interface SyncLogEntry {
  orgId: string;
  repoId: string;
  message: string;
  level: "info" | "success" | "error" | "warning";
  timestamp: number;
}

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  console.log(
    `[sync-log] org=${entry.orgId} repo=${entry.repoId} level=${entry.level} :: ${entry.message}`,
  );
}

export async function getSyncLogs(
  _orgId: string,
  _repoId: string,
  _limit = 500,
): Promise<SyncLogEntry[]> {
  return [];
}

export async function deleteSyncLogs(
  _orgId: string,
  _repoId: string,
): Promise<void> {
  // no-op
}
