import { createHash } from "node:crypto";
import type { AiCreateParams, AiProvider, AiResponse } from "./index";

export type AiRequestReceipt = { provider: AiProvider; model: string; sha256: string; inputPreserved: boolean };

/** Hash the JSON payload supplied to the SDK after adapter transformations. */
export function observeAiRequest<T>(params: AiCreateParams, provider: AiProvider, payload: T): T {
  if (params.onRequest) {
    const strings = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === "string") strings.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(payload);
    params.onRequest({ provider, model: params.model,
      sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      inputPreserved: params.messages.every(message => strings.has(message.content)),
    });
  }
  return payload;
}

/** Per-request SDK options; leaves the SDK default untouched unless the caller asked for no SDK retries. */
export function sdkRequestOptions(params: AiCreateParams): { maxRetries?: 0; signal?: AbortSignal } | undefined {
  return params.maxRetries === 0 || params.signal ? { ...(params.maxRetries === 0 ? { maxRetries: 0 } : {}), ...(params.signal ? { signal: params.signal } : {}) } : undefined;
}

export function completionEvidence(reason: string | null | undefined, completedReasons: string[]): NonNullable<AiResponse["completion"]> {
  return { state: reason == null ? "unknown" : completedReasons.includes(reason) ? "completed" : "incomplete", reason: reason ?? null };
}
