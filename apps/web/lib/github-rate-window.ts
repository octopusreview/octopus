export type GitHubRateWindow = {
  kind: "primary" | "retry-after" | "throttled";
  /** Null means the primary limit was exhausted but its reset is unknown. */
  notBefore: number | null;
};

function retryAfterTime(value: string | null, now: number, serverTime: number | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    const deadline = now + seconds * 1000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(deadline) && deadline <= 8.64e15 ? deadline : null;
  }
  if (/^[+-]?\d/.test(text) && !/[A-Za-z]/.test(text)) return null;
  const date = Date.parse(text);
  if (!Number.isFinite(date)) return null;
  return Math.max(now, date, serverTime === null ? now : now + Math.max(0, date - serverTime));
}

/** Interpret only fixed GitHub rate headers; an unmarked 403 remains unknown. */
export function githubRateWindow(response: Response, now = Date.now()): GitHubRateWindow | null {
  const date = Date.parse(response.headers.get("date") ?? "");
  const serverTime = Number.isFinite(date) ? date : null;
  const retryAfter = retryAfterTime(response.headers.get("retry-after"), now, serverTime);
  if (response.headers.get("x-ratelimit-remaining")?.trim() === "0") {
    const raw = response.headers.get("x-ratelimit-reset") ?? "";
    if (!/^\d+$/.test(raw)) return { kind: "primary", notBefore: null };
    const reset = Number(raw) * 1000;
    if (!Number.isSafeInteger(reset) || reset > 8.64e15 || reset <= (serverTime ?? now)) return { kind: "primary", notBefore: null };
    const relativeReset = serverTime === null ? now : now + reset - serverTime;
    if (!Number.isSafeInteger(relativeReset) || relativeReset > 8.64e15) return { kind: "primary", notBefore: null };
    return { kind: "primary", notBefore: Math.max(reset, retryAfter ?? now, relativeReset) };
  }
  if ((response.status === 403 || response.status === 429) && retryAfter !== null) {
    return { kind: "retry-after", notBefore: Math.max(now + 1000, retryAfter) };
  }
  if (response.status === 429) return { kind: "throttled", notBefore: now + 60_000 };
  return null;
}
