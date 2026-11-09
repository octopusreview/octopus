export type GitHubRateWindow = {
  kind: "primary" | "retry-after" | "throttled";
  /** Null means GitHub asked for a delay but its safe end is unknown. */
  notBefore: number | null;
  verifyPrimary?: true;
  primaryReset?: number | null;
};

function parseHttpDate(value: string | null): number | null {
  if (!value || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toUTCString() === value ? date : null;
}

export function githubServerTime(response: Response): number | null {
  return parseHttpDate(response.headers.get("date"));
}

function retryAfterTime(value: string | null, now: number, serverTime: number | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    const deadline = now + seconds * 1000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(deadline) && deadline <= 8.64e15 ? deadline : null;
  }
  if (/^[+-]?\d/.test(text) && !/[A-Za-z]/.test(text)) return null;
  const date = parseHttpDate(text);
  if (date === null) return null;
  const deadline = Math.max(now, date, serverTime === null ? now : now + Math.max(0, date - serverTime));
  return Number.isSafeInteger(deadline) && deadline <= 8.64e15 ? deadline : null;
}

/** Interpret only fixed GitHub rate headers; an unmarked 403 remains unknown. */
export function githubRateWindow(response: Response, now = Date.now()): GitHubRateWindow | null {
  const serverTime = githubServerTime(response);
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterTime(retryAfterHeader, now, serverTime);
  const retryAfterDate = parseHttpDate(retryAfterHeader?.trim() ?? null);
  if (response.headers.get("x-ratelimit-remaining")?.trim() === "0") {
    const raw = response.headers.get("x-ratelimit-reset") ?? "";
    const parsed = /^\d+$/.test(raw) ? Number(raw) * 1000 : NaN;
    const reset = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 8.64e15 && (serverTime === null || parsed > serverTime) ? parsed : null;
    if (reset === null || serverTime === null || (retryAfterHeader !== null && retryAfter === null)) {
      return { kind: "primary", notBefore: null, verifyPrimary: true,
        primaryReset: retryAfterDate === null || retryAfterDate <= 0 ? reset : Math.max(reset ?? 0, retryAfterDate) };
    }
    const relativeReset = now + reset - serverTime;
    if (!Number.isSafeInteger(relativeReset) || relativeReset > 8.64e15) return { kind: "primary", notBefore: null, verifyPrimary: true, primaryReset: reset };
    return { kind: "primary", notBefore: Math.max(reset, retryAfter ?? now, relativeReset) };
  }
  if ((response.status === 403 || response.status === 429) && retryAfterDate !== null && serverTime === null) {
    return { kind: "retry-after", notBefore: null, verifyPrimary: true, primaryReset: retryAfterDate > 0 ? retryAfterDate : null };
  }
  if ((response.status === 403 || response.status === 429) && retryAfterHeader !== null) {
    return { kind: "retry-after", notBefore: retryAfter === null ? null : Math.max(now + 1000, retryAfter) };
  }
  if (response.status === 429) return { kind: "throttled", notBefore: now + 60_000 };
  return null;
}
