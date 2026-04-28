import { onCancel, publishCancel } from "./cancel-bus";

const controllers = new Map<string, AbortController>();

let listenerRegistered = false;
function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  onCancel("analysis", (repoId) => {
    const c = controllers.get(repoId);
    if (!c) return;
    c.abort();
    controllers.delete(repoId);
  });
}

export function createAnalysisAbortController(repoId: string): AbortController {
  ensureListener();
  const existing = controllers.get(repoId);
  if (existing) existing.abort();

  const controller = new AbortController();
  controllers.set(repoId, controller);
  return controller;
}

export function abortAnalysis(repoId: string): boolean {
  publishCancel("analysis", repoId);
  const controller = controllers.get(repoId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(repoId);
  return true;
}

export function clearAnalysisAbortController(repoId: string) {
  controllers.delete(repoId);
}
