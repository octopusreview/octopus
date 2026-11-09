import "server-only";
import { admitIndexRequest, completeIndexRateProbe, recordIndexRateLimit } from "./github-index-rate-state";
import { githubRateWindow } from "./github-rate-window";

export class GitHubIndexDeferredError extends Error {
  constructor(readonly status?: number, readonly retryAfterMs?: number, readonly paused = false) {
    super(paused ? "GitHub indexing paused after repeated rate limits. Check GitHub limits before retrying." : "GitHub indexing is temporarily rate limited");
    this.name = "GitHubIndexDeferredError";
  }
}

export class GitHubIndexUnavailableError extends Error {
  constructor() {
    super("GitHub indexing temporarily unavailable");
    this.name = "GitHubIndexUnavailableError";
  }
}

async function stateOperation<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  try { return await operation(); }
  catch {
    signal?.throwIfAborted();
    throw new GitHubIndexUnavailableError();
  }
}

/** Each request consults the shared window; an expired window permits one bounded probe. */
export async function githubIndexFetch(scope: string, url: string, init: RequestInit = {}, allowPausedProbe = false): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  const admission = await stateOperation(() => admitIndexRequest(scope, allowPausedProbe), signal);
  signal?.throwIfAborted();
  if (admission.kind === "blocked") throw new GitHubIndexDeferredError(undefined, admission.retryAfterMs ?? undefined, admission.paused);
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(30_000);
    response = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch {
    const state = admission.kind === "probe" ? await stateOperation(() => recordIndexRateLimit(scope, null), signal) : null;
    signal?.throwIfAborted();
    if (state) throw new GitHubIndexDeferredError(undefined, undefined, state.paused);
    throw new Error("GitHub indexing request failed");
  }
  const now = Date.now();
  const window = githubRateWindow(response, now);
  if (window) {
    const duration = window.notBefore === null || window.kind === "throttled" ? null : Math.max(0, window.notBefore - now);
    const state = await stateOperation(() => recordIndexRateLimit(scope, duration, window.kind !== "primary" || duration === null), signal);
    signal?.throwIfAborted();
    if (!response.ok) throw new GitHubIndexDeferredError(response.status, undefined, state.paused);
  } else if (admission.kind === "probe") {
    if (response.ok) await stateOperation(() => completeIndexRateProbe(scope, admission), signal);
    else {
      const state = await stateOperation(() => recordIndexRateLimit(scope, null), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(response.status, undefined, state.paused);
    }
  }
  signal?.throwIfAborted();
  return response;
}
