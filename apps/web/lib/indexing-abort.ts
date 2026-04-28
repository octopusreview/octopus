import { onCancel, publishCancel } from "./cancel-bus";

const controllers = new Map<string, AbortController>();

let listenerRegistered = false;
function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  onCancel("indexing", (repoId) => {
    const c = controllers.get(repoId);
    if (!c) return;
    c.abort();
    controllers.delete(repoId);
  });
}

export function createAbortController(repoId: string): AbortController {
  ensureListener();
  const existing = controllers.get(repoId);
  if (existing) existing.abort();

  const controller = new AbortController();
  controllers.set(repoId, controller);
  return controller;
}

export function abortIndexing(repoId: string): boolean {
  publishCancel("indexing", repoId);
  const controller = controllers.get(repoId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(repoId);
  return true;
}

export function clearAbortController(repoId: string) {
  controllers.delete(repoId);
}
