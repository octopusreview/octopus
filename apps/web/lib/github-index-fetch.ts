import "server-only";
import { admitIndexRequest, completeIndexRateProbe, deferPrimaryVerification, recordIndexRateLimit } from "./github-index-rate-state";
import { githubRateWindow, githubServerTime, type GitHubRateWindow } from "./github-rate-window";
import { readReviewJson } from "./review-fetch";

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

async function indexRateWindow(response: Response, now: number): Promise<GitHubRateWindow | null> {
  const window = githubRateWindow(response, now);
  if (window || response.status !== 403) return window;
  try {
    const reader = response.clone().body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let size = 0, text = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) return null;
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    const body = JSON.parse(text + decoder.decode()) as { message?: unknown };
    if (typeof body?.message === "string" && /secondary rate limit/i.test(body.message)) {
      return { kind: "throttled" as const, notBefore: now + 60_000 };
    }
  } catch {}
  return null;
}

/** Each request consults the shared window; an expired window permits one bounded probe. */
export async function githubIndexFetch(scope: string, url: string, init: RequestInit = {}, allowPausedProbe = false): Promise<Response> {
  const signal = init.signal;
  signal?.throwIfAborted();
  const admission = await stateOperation(() => admitIndexRequest(scope, allowPausedProbe), signal);
  signal?.throwIfAborted();
  if (admission.kind === "blocked") throw new GitHubIndexDeferredError(undefined, admission.retryAfterMs ?? undefined, admission.paused);
  if (admission.kind === "probe" && admission.verifyPrimary) {
    let quota: Response;
    try {
      const headers = new Headers({ Accept: "application/vnd.github+json" });
      const authorization = new Headers(init.headers).get("authorization");
      if (!authorization || !/^Bearer \S+$/i.test(authorization)) throw new Error("Missing GitHub authorization");
      headers.set("authorization", authorization);
      const timeout = AbortSignal.timeout(30_000);
      quota = await fetch("https://api.github.com/rate_limit", { headers, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch {
      const state = await stateOperation(() => recordIndexRateLimit(scope, null), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(undefined, undefined, state.paused);
    }
    if (!quota.ok) {
      const now = Date.now();
      const window = await indexRateWindow(quota, now);
      const duration = !window || window.notBefore === null || window.kind === "throttled" ? null : Math.max(0, window.notBefore - now);
      const state = await stateOperation(() => recordIndexRateLimit(scope, duration, true,
        window?.verifyPrimary ? { resetMs: window.primaryReset ?? null } : undefined), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(quota.status, undefined, state.paused);
    }
    if (quota.headers.get("x-ratelimit-remaining")?.trim() === "0") {
      const now = Date.now();
      const window = githubRateWindow(quota, now)!;
      const duration = window.notBefore === null ? null : Math.max(0, window.notBefore - now);
      const state = await stateOperation(() => recordIndexRateLimit(scope, duration, duration === null,
        window.verifyPrimary ? { resetMs: window.primaryReset ?? null } : undefined), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(undefined, undefined, state.paused);
    }
    let serverTime: number;
    let remaining: number;
    let resetMs: number;
    try {
      serverTime = githubServerTime(quota) ?? NaN;
      const body = await readReviewJson<{ resources?: { core?: { remaining?: unknown; reset?: unknown } } }>(quota, 65_536);
      if (typeof body.resources?.core?.remaining !== "number" || typeof body.resources.core.reset !== "number") throw new Error("Invalid quota overview");
      remaining = body.resources.core.remaining;
      resetMs = body.resources.core.reset * 1000;
      if (!Number.isFinite(serverTime) || serverTime <= 0 || !Number.isSafeInteger(remaining) || remaining < 0 ||
          !Number.isSafeInteger(resetMs) || resetMs <= serverTime || resetMs > 8.64e15) throw new Error("Invalid quota overview");
    } catch {
      const state = await stateOperation(() => recordIndexRateLimit(scope, null), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(undefined, undefined, state.paused);
    }
    const priorReset = admission.primaryResetMs ?? 0;
    // A quota overview may lag request headers, so wait through its next reset too.
    if (!admission.primaryBaseline || remaining === 0 || serverTime <= priorReset) {
      const target = !admission.primaryBaseline || remaining === 0 ? Math.max(priorReset, resetMs) : priorReset;
      const wait = Math.max(1000, target - serverTime + 1000);
      await stateOperation(() => deferPrimaryVerification(scope, admission, target, wait), signal);
      signal?.throwIfAborted();
      throw new GitHubIndexDeferredError(undefined, wait, admission.paused);
    }
    await stateOperation(() => completeIndexRateProbe(scope, admission), signal);
    signal?.throwIfAborted();
    return githubIndexFetch(scope, url, init);
  }
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
  const window = await indexRateWindow(response, now);
  if (window) {
    const duration = window.notBefore === null || window.kind === "throttled" ? null : Math.max(0, window.notBefore - now);
    const state = await stateOperation(() => recordIndexRateLimit(scope, duration, window.kind !== "primary" || duration === null,
      window.verifyPrimary ? { resetMs: window.primaryReset ?? null } : undefined), signal);
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
