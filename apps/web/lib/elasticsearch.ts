import { safeIndexLogMessage } from "@/lib/index-log-safety";
import { Client } from "@elastic/elasticsearch";

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.ELASTICSEARCH_URL!;
    const node = url.startsWith("http") ? url : `http://${url}`;
    client = new Client({
      node,
      auth: {
        username: process.env.ELASTICSEARCH_USERNAME!,
        password: process.env.ELASTICSEARCH_PASSWORD!,
      },
      tls: { rejectUnauthorized: false },
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
    });
  }
  return client;
}

function getIndexName(name: string): string {
  const prefix = process.env.ELASTICSEARCH_INDEX_PREFIX ?? "octopus";
  return `${prefix}_${name}`;
}

const REPO_SYNC_INDEX = "repo_sync";

export interface SyncLogEntry {
  orgId: string;
  repoId: string;
  id?: string;
  message: string;
  level: "info" | "success" | "error" | "warning";
  timestamp: number;
}

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  try {
    const es = getClient();
    const index = getIndexName(REPO_SYNC_INDEX);

    await es.index({
      index,
      body: {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        message: safeIndexLogMessage(entry.message),
        createdAt: new Date(entry.timestamp).toISOString(),
      },
    });
  } catch {
    console.error("Failed to write sync log to ES");
  }
}

export async function getSyncLogs(
  orgId: string,
  repoId: string,
  limit = 500,
): Promise<SyncLogEntry[]> {
  try {
    const es = getClient();
    const index = getIndexName(REPO_SYNC_INDEX);

    const exists = await es.indices.exists({ index });
    if (!exists) return [];

    const result = await es.search<SyncLogEntry>({
      index,
      size: limit,
      query: {
        bool: {
          filter: [
            { term: { orgId } },
            { term: { repoId } },
          ],
        },
      },
      sort: [{ timestamp: { order: "desc" } }],
    });

    return result.hits.hits.map((hit) => {
      const log = hit._source!;
      return {
        orgId, repoId,
        ...(typeof log.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(log.id) ? { id: log.id } : {}),
        message: safeIndexLogMessage(log.message),
        level: ["info", "success", "warning", "error"].includes(log.level) ? log.level : "info" as const,
        timestamp: typeof log.timestamp === "number" && Number.isFinite(log.timestamp) ? log.timestamp : 0,
      };
    }).reverse();
  } catch {
    console.error("Failed to read sync logs from ES");
    return [];
  }
}

export async function deleteSyncLogs(
  orgId: string,
  repoId: string,
): Promise<void> {
  try {
    const es = getClient();
    const index = getIndexName(REPO_SYNC_INDEX);

    const exists = await es.indices.exists({ index });
    if (!exists) return;

    await es.deleteByQuery({
      index,
      query: {
        bool: {
          filter: [
            { term: { orgId } },
            { term: { repoId } },
          ],
        },
      },
    });
  } catch {
    console.error("Failed to delete sync logs from ES");
  }
}
