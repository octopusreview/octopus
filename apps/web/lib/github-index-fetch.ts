import "server-only";
import { admitIndexRequest, completeIndexRateProbe, recordIndexRateLimit } from "./github-index-rate-state";
import { githubRateWindow } from "./github-rate-window";

export class GitHubIndexDeferredError extends Error {
  constructor(readonly status?: number, readonly retryAfterMs?: number) {
    super("GitHub indexing is temporarily rate limited");
    this.name = "GitHubIndexDeferredError";
  }
}

async function stateOperation<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  try { return await operation(); }
  catch {
    signal?.throwIfAborted();
    throw new Error("GitHub indexing temporarily unavailable");
  }
}

/** Each request consults the shared window; an expired window permits one bounded probe. */
export async function githubIndexFetch(scope: string, url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  const admission = await stateOperation(() => admitIndexRequest(scope), signal);
  signal?.throwIfAborted();
  if (admission.kind === "blocked") throw new GitHubIndexDeferredError(undefined, admission.retryAfterMs);
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(30_000);
    response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch {
    if (admission.kind === "probe") await stateOperation(() => recordIndexRateLimit(scope, null), signal);
    signal?.throwIfAborted();
    throw new Error("GitHub indexing request failed");
  }
  const now = Date.now();
  const window = githubRateWindow(response, now);
  if (window) {
    const duration = window.notBefore === null || window.kind === "throttled" ? null : Math.max(0, window.notBefore - now);
    await stateOperation(() => recordIndexRateLimit(scope, duration), signal);
    signal?.throwIfAborted();
    if (!response.ok) throw new GitHubIndexDeferredError(response.status);
  } else if (admission.kind === "probe") {
    if (response.ok) await stateOperation(() => completeIndexRateProbe(scope, admission), signal);
    else {
      await stateOperation(() => recordIndexRateLimit(scope, null), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(response.status);
    }
  }
  signal?.throwIfAborted();
  return response;
}
