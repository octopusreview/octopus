import "server-only";
// STUB: Cloudflare R2 disabled for Databricks deployment.
// Avatar uploads return a deterministic jdenticon URL instead of uploading.
// Re-enable by setting FEATURES_R2=true and the R2_* env vars.

const r2Enabled = process.env.FEATURES_R2 === "true";

export const R2_BUCKET = process.env.R2_BUCKET ?? "";
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

export function isR2Configured(): boolean {
  return r2Enabled;
}

/** Returns a deterministic jdenticon-style URL keyed off the upload key. */
function jdenticonUrl(key: string): string {
  const seed = encodeURIComponent(key);
  // Use a public jdenticon service (no dependency on R2/cloud).
  // Falls back to GitHub identicons if needed.
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;
}

export async function uploadToR2(
  key: string,
  _body: Buffer,
  _contentType: string,
): Promise<string> {
  if (!r2Enabled) {
    console.log(`[r2-stub] uploadToR2 key=${key} → returning jdenticon URL`);
    return jdenticonUrl(key);
  }
  throw new Error("R2 was enabled but the stub implementation does not perform uploads. Restore the original lib/r2.ts to use real R2.");
}

export async function deleteFromR2(key: string): Promise<void> {
  if (!r2Enabled) {
    console.log(`[r2-stub] deleteFromR2 key=${key} (no-op)`);
    return;
  }
  console.warn("[r2-stub] R2 was enabled but stub is in use — no-op delete");
}

export function extractR2Key(url: string): string | null {
  if (!R2_PUBLIC_URL || !url.startsWith(R2_PUBLIC_URL + "/")) return null;
  return url.slice(R2_PUBLIC_URL.length + 1);
}
