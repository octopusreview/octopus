import "server-only";

export type BoundedJsonResult =
  { ok: true; value: unknown } | { ok: false; reason: "invalid" | "too_large" };

export const MAX_REPO_FULL_NAMES = 500;
export const MAX_REPO_FULL_NAME_LENGTH = 256;

export function isBoundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (item) => typeof item === "string" && item.length <= maxItemLength,
    )
  );
}

/**
 * Cap a string at maxLength UTF-16 code units without leaving a split
 * surrogate pair at the cut — a trailing lone high surrogate serializes as an
 * unpaired \uXXXX escape, which Prisma's JSON protocol and Postgres jsonb
 * reject.
 */
export function truncateStringSafe(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff
    ? sliced.slice(0, -1)
    : sliced;
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
