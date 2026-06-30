/**
 * Shared API shapes for the operational commands (repo / usage / knowledge).
 * Mirror of the server's /api/cli/* response payloads. Ported from the
 * standalone @octp/cli so the command surface matches what the platform
 * already returns.
 */

export interface ApiRepo {
  id: string;
  name: string;
  fullName: string;
  provider: string;
  defaultBranch: string;
  indexStatus: string;
  indexedAt: string | null;
  indexedFiles: number;
  totalFiles: number;
  totalChunks: number;
  totalVectors?: number;
  indexDurationMs?: number;
  analysisStatus: string;
  analyzedAt: string | null;
  analysis?: string;
  summary: string | null;
  purpose: string | null;
  autoReview: boolean;
  contributorCount?: number;
  _count: { pullRequests: number };
}

export interface UsageBreakdown {
  model: string;
  operation: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: string;
  fileName: string | null;
  status: string;
  totalChunks: number;
  totalVectors: number;
  createdAt: string;
}
