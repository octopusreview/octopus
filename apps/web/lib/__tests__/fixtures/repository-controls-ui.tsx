import * as React from "react";
import { createRoot } from "react-dom/client";
import { RepositoriesContent } from "../../../app/(app)/repositories/repositories-content";
import { RepoTable } from "../../../components/dashboard/repo-table";

const listeners = new Map<string, Set<(data: unknown) => void>>();
const repo = {
  id: "fixture-repo", name: "project", fullName: "fixture/project", provider: "bitbucket", defaultBranch: "main", isActive: true,
  autoReview: true, dismissedAt: null, isNew: true, indexStatus: "pending", indexedAt: null, indexedFiles: 0,
  totalFiles: 0, totalChunks: 0, totalVectors: 0, indexDurationMs: null, contributorCount: 0, analysisStatus: "none",
  analyzedAt: null, reviewModelId: null, embedModelId: null, reviewConfig: {}, pullRequestCount: 0,
};
const fixture = {
  React, repo, allowed: true, toggleError: "Fixture permission denied", indexError: "Fixture indexing cooldown", syncError: "Fixture sync failed",
  cancelError: "Fixture cancellation failed", logsFail: false, indexCalls: 0, toggleCalls: 0, fastComplete: false, indexDelay: 0,
  logAttempt: null as string | null, indexAttemptId: null as string | null, omitIndexAttemptId: false, invalidIndexAttemptId: false,
  logFetches: 0, logDelay: 0, logHang: false, logAborts: 0,
  logs: [] as Array<{ message: string; level: string; timestamp: number }>,
  channel: {
    bind(event: string, callback: (data: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
    },
    unbind(event: string, callback: (data: unknown) => void) { listeners.get(event)?.delete(callback); },
  },
  emit(event: string, data: unknown) { for (const callback of listeners.get(event) ?? []) callback(data); },
  refresh: () => render(),
};
Object.assign(window, { repositoryFixture: fixture });
const originalFetch = window.fetch;
window.fetch = async (input, options) => {
  if (String(input).startsWith("/api/sync-logs")) {
    fixture.logFetches++;
    const snapshot = { logs: fixture.logs,
      ...(fixture.omitIndexAttemptId ? {} : { attempt: fixture.logAttempt, indexAttemptId: fixture.invalidIndexAttemptId ? 42 : fixture.indexAttemptId }) };
    if (fixture.logHang) {
      await new Promise<void>((_, reject) => options?.signal?.addEventListener("abort", () => {
        fixture.logAborts++;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true }));
    }
    if (fixture.logDelay) await new Promise(resolve => setTimeout(resolve, fixture.logDelay));
    return fixture.logsFail ? new Response("fixture failure", { status: 503 }) : Response.json(snapshot);
  }
  return originalFetch(input, options);
};
const root = createRoot(document.getElementById("root")!);
function render() {
  if (new URLSearchParams(location.search).get("view") === "dashboard") {
    root.render(<RepoTable repos={[{ ...repo, summary: null, purpose: null, pullRequests: [] }]} orgId="fixture-org" canManageRepos={fixture.allowed} />);
    return;
  }
  root.render(<RepositoriesContent
    repos={[{ ...repo }]} orgId="fixture-org" selectedRepoId={repo.id} githubAppSlug={null} favoriteRepoIds={[]}
    canManageRepos={fixture.allowed} canConfigureReviews={fixture.allowed}
  />);
}
render();
