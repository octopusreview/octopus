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
const REPO_SYNC_ATTEMPT_INDEX = "repo_sync_attempts";

export interface SyncLogEntry {
  orgId: string;
  repoId: string;
  indexAttemptId?: string;
  message: string;
  level: "info" | "success" | "error" | "warning";
  timestamp: number;
}

type ExactField = { type?: string; fields?: Record<string, { type?: string }> };

async function legacyScope(es: Client, index: string, orgId: string, repoId: string) {
  const mappings = await es.indices.getMapping({ index });
  const indices = Object.entries(mappings);
  if (!indices.length) throw new Error("Index mapping unavailable");

  // Legacy aliases can mix direct keywords and analyzed fields with keyword subfields.
  const should = indices.map(([name, value]) => {
    const properties = value.mappings.properties as Record<string, ExactField> | undefined;
    const exactField = (field: "orgId" | "repoId") => {
      const mapping = properties?.[field];
      if (mapping?.type === "keyword") return field;
      if (mapping?.fields?.keyword?.type === "keyword") return `${field}.keyword`;
      throw new Error("Exact index identifier mapping unavailable");
    };
    return { bool: { filter: [
      { term: { _index: name } },
      { term: { [exactField("orgId")]: orgId } },
      { term: { [exactField("repoId")]: repoId } },
    ] } };
  });
  return { bool: { should, minimum_should_match: 1 } };
}

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  try {
    const es = getClient();
    const index = getIndexName(REPO_SYNC_INDEX);

    await es.index({
      index,
      body: {
        ...entry,
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
  indexAttemptId?: string,
): Promise<SyncLogEntry[]> {
  try {
    const es = getClient();
    const index = getIndexName(indexAttemptId ? REPO_SYNC_ATTEMPT_INDEX : REPO_SYNC_INDEX);

    const exists = await es.indices.exists({ index });
    if (!exists) return [];

    const result = await es.search<SyncLogEntry>({
      index,
      size: limit,
      query: {
        bool: {
          filter: [
            ...(indexAttemptId ? [
              { term: { "orgId.keyword": orgId } },
              { term: { "repoId.keyword": repoId } },
              { term: { "indexAttemptId.keyword": indexAttemptId } },
            ] : [await legacyScope(es, index, orgId, repoId)]),
          ],
        },
      },
      sort: [{ timestamp: { order: "desc" } }],
    });

    return result.hits.hits.map((hit) => {
      const log = hit._source!;
      return {
        orgId, repoId,
        ...(indexAttemptId && log.indexAttemptId === indexAttemptId ? { indexAttemptId } : {}),
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
            await legacyScope(es, index, orgId, repoId),
          ],
        },
      },
    });
  } catch {
    console.error("Failed to delete sync logs from ES");
  }
}
