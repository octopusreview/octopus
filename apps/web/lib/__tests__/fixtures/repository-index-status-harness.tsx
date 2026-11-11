import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { ComponentProps } from "react";

const react = await import("react");
let effects: Array<() => void | (() => void)> = [];
let states: unknown[] = [];
mock.module("react", () => ({
  ...react,
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useLayoutEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useState: (initial: unknown) => {
    const index = states.length;
    states.push(typeof initial === "function" ? initial() : initial);
    return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (compute: () => unknown) => compute(),
  useTransition: () => [false, (run: () => void) => run()],
}));
let persistedStatus = "indexing";
const refreshed: string[] = [];
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() { refreshed.push(persistedStatus); }, push() {} }), useSearchParams: () => new URLSearchParams() }));
mock.module("@/components/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));
mock.module("@/components/mermaid-diagram", () => ({ MermaidDiagram: () => null }));
mock.module("@/components/chat-provider", () => ({ useChat: () => ({ openWithRepoContext() {} }) }));
mock.module("@/app/(app)/actions", () => ({ indexRepository() {}, cancelIndexing() {}, syncRepos() {} }));
mock.module("@/app/(app)/repositories/actions", () => ({
  analyzeRepository() {}, cancelAnalysis() {}, toggleAutoReview() {}, toggleFavoriteRepository() {}, deletePullRequestReview() {},
  cancelPullRequestReview() {}, updateRepoModels() {}, transferRepository() {}, removeRepository() {}, restoreRepository() {}, getRepoDetail: async () => null, updateReviewConfig() {},
}));
const handlers = new Map<string, (data: unknown) => void>();
mock.module("@/lib/pubby-client", () => ({ getPubbyClient: () => ({ subscribe: () => ({
  bind: (event: string, handler: (data: unknown) => void) => handlers.set(event, handler),
  unbind: (event: string) => handlers.delete(event),
}) }) }));
mock.module("server-only", () => ({}));
let deliver!: () => void;
let delivery: Promise<void>;
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, event: string, data: unknown) => {
  await delivery;
  handlers.get(event)?.(data);
} } }));
globalThis.fetch = (async () => Response.json({ logs: [] })) as typeof fetch;
const { notifyRepositoryIndex } = await import("@/lib/repository-index-notifications");
const { RepositoriesContent } = await import("@/app/(app)/repositories/repositories-content");
const { RepoTable } = await import("@/components/dashboard/repo-table");
const { IndexingLogs } = await import("@/components/indexing-logs");
const repo = {
  id: "repo", name: "project", fullName: "team/project", provider: "github", defaultBranch: "main", isActive: true,
  autoReview: true, dismissedAt: null, isNew: true, indexStatus: "indexing", indexedAt: null, indexedFiles: 0,
  totalFiles: 0, totalChunks: 0, totalVectors: 0, indexDurationMs: null, contributorCount: 0, analysisStatus: "none",
  analyzedAt: null, reviewModelId: null, embedModelId: null, reviewConfig: {}, pullRequestCount: 0, pullRequests: [],
};
for (const render of [
  () => IndexingLogs({ repoId: repo.id, orgId: "org", provider: "github", initialStatus: repo.indexStatus }),
  () => RepoTable({ repos: [repo], orgId: "org", canManageRepos: true } as never),
  () => RepositoriesContent({ repos: [repo], orgId: "org", selectedRepoId: "repo", githubAppSlug: null, favoriteRepoIds: [], canManageRepos: true, canConfigureReviews: true } as never),
]) {
  effects = []; states = []; refreshed.length = 0; handlers.clear();
  render();
  const cleanup = effects.map(effect => effect());
  const handler = handlers.get("index-status");
  assert.ok(handler);
  for (const obsoleteStatus of ["indexed", "failed", "cancelled"]) {
    persistedStatus = obsoleteStatus;
    delivery = new Promise(resolve => { deliver = resolve; });
    const pending = notifyRepositoryIndex("presence-org-org", repo.id);
    persistedStatus = "indexing";
    deliver();
    await pending;
    handler({ repoId: repo.id, status: obsoleteStatus });
    assert.equal(refreshed.at(-1), "indexing");
    assert.ok(!states.includes(obsoleteStatus), "Logs must not adopt a delayed terminal status");
    for (const state of states) {
      if (state && typeof state === "object" && "repo" in state && typeof state.repo === "string") {
        assert.ok(state.repo === "indexing" || state.repo === "none", "Repository lists must retain the current snapshot until refresh");
      }
    }
  }
  assert.equal(refreshed.length, 6, "Every invalidation, including an obsolete event, must refresh persisted state");
  for (const stop of cleanup) if (typeof stop === "function") stop();
}
console.log("Delayed index notifications refresh persisted state in all three consumers");
