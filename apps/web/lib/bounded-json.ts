import "server-only";

import { stripLoneSurrogates } from "@/lib/providers/sanitize";

export type BoundedJsonResult =
  { ok: true; value: unknown } | { ok: false; reason: "invalid" | "too_large" };

export const MAX_REPO_FULL_NAMES = 500;
export const MAX_REPO_FULL_NAME_CODE_UNITS = 256;

export function isBoundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemCodeUnits: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length <= maxItemCodeUnits &&
        isPostgresSafeText(item),
    )
  );
}

/**
 * Cap a string at maxCodeUnits UTF-16 code units without leaving a split
 * surrogate pair at the cut — a trailing lone high surrogate serializes as an
 * unpaired \uXXXX escape, which Prisma's JSON protocol and Postgres jsonb
 * reject.
 */
export function truncateStringSafe(value: string, maxCodeUnits: number): string {
  if (value.length <= maxCodeUnits) return value;
  const sliced = value.slice(0, maxCodeUnits);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff
    ? sliced.slice(0, -1)
    : sliced;
}

/**
 * PostgreSQL text/jsonb cannot store NUL, and the JSON protocol rejects lone
 * UTF-16 surrogates. Replace only those invalid code units; valid emoji and
 * other surrogate pairs remain unchanged.
 */
export function sanitizePostgresText(value: string): string {
  return stripLoneSurrogates(value).replaceAll("\u0000", "\uFFFD");
}

export function isPostgresSafeText(value: string): boolean {
  return sanitizePostgresText(value) === value;
}

/** Check parsed JSON iteratively so hostile nesting cannot overflow the stack. */
export function isPostgresSafeJson(value: unknown): boolean {
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (!isPostgresSafeText(current)) return false;
    } else if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (current && typeof current === "object") {
      for (const [key, nested] of Object.entries(current)) {
        if (!isPostgresSafeText(key)) return false;
        pending.push(nested);
      }
    }
  }

  return true;
}

/** Sanitize every string and object key in parsed JSON before jsonb storage. */
export function sanitizePostgresJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizePostgresText(value);
  if (Array.isArray(value)) return value.map(sanitizePostgresJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        sanitizePostgresText(key),
        sanitizePostgresJson(nested),
      ]),
    );
  }
  return value;
}

/**
 * Read and parse a JSON request without buffering more than maxBytes.
 * Content-Length is only an early rejection hint; the stream limit remains
 * authoritative for chunked or dishonest requests.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await request.body?.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
  }

  if (!request.body) {
    return { ok: false, reason: "invalid" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}
