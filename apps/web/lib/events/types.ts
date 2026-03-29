export type RepoIndexedEvent = {
  type: "repo-indexed";
  orgId: string;
  repoFullName: string;
  success: boolean;
  indexedFiles?: number;
  totalVectors?: number;
  durationMs?: number;
  error?: string;
};

export type RepoAnalyzedEvent = {
  type: "repo-analyzed";
  orgId: string;
  repoFullName: string;
};

export type ReviewRequestedEvent = {
  type: "review-requested";
  orgId: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prUrl: string;
};

export type ReviewCompletedEvent = {
  type: "review-completed";
  orgId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  findingsCount: number;
  filesChanged: number;
};

export type ReviewFailedEvent = {
  type: "review-failed";
  orgId: string;
  prNumber: number;
  prTitle: string;
  error: string;
};

export type KnowledgeReadyEvent = {
  type: "knowledge-ready";
  orgId: string;
  documentTitle: string;
  action: "created" | "updated" | "restored";
  totalChunks: number;
  totalVectors: number;
};

export type CreditLowEvent = {
  type: "credit-low";
  orgId: string;
  remainingBalance: number;
};

export type AppEvent =
  | RepoIndexedEvent
  | RepoAnalyzedEvent
  | ReviewRequestedEvent
  | ReviewCompletedEvent
  | ReviewFailedEvent
  | KnowledgeReadyEvent
  | CreditLowEvent;

export type AppEventType = AppEvent["type"];
