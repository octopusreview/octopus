import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ── Key resolution ───────────────────────────────────────────────────────────
//
// Data encryption uses OCTOPUS_DATA_KEY when set, otherwise falls back to the
// legacy `sha256(BETTER_AUTH_SECRET)` derivation. Splitting the data key off
// the auth secret means BETTER_AUTH_SECRET can be rotated (for session/CSRF
// reasons) without invalidating every encrypted row in the database.
//
// Bootstrap paths for an existing deployment:
//
//   1. Zero-migration: set OCTOPUS_DATA_KEY to the hex-encoded current key
//      (i.e. hex(sha256(BETTER_AUTH_SECRET)) of the value already in use).
//      All existing ciphertext stays readable with bit-identical bytes, and
//      BETTER_AUTH_SECRET can then rotate freely. Use `scripts/print-data-key.ts`
//      to compute this value.
//
//   2. Fresh key: set OCTOPUS_DATA_KEY=$(openssl rand -hex 32). Existing
//      ciphertext is still readable because decryption falls back to the legacy
//      key when the primary key fails. New writes use the new key. Run a
//      re-encrypt migration to flip remaining rows over the new key.
//
// OCTOPUS_DATA_KEY is hex-encoded 32 bytes (64 lowercase hex characters).

function parseDataKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      "OCTOPUS_DATA_KEY must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32",
    );
  }
  return Buffer.from(trimmed, "hex");
}

function getPrimaryKey(): Buffer {
  const dataKey = process.env.OCTOPUS_DATA_KEY;
  if (dataKey) return parseDataKey(dataKey);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("OCTOPUS_DATA_KEY or BETTER_AUTH_SECRET must be set");
  }
  return createHash("sha256").update(secret).digest();
}

// Returns the legacy BETTER_AUTH_SECRET-derived key only when it differs from
// the primary key (i.e. OCTOPUS_DATA_KEY is set). Used as a decryption fallback
// during the transition; returns null when no fallback is needed or available.
function getLegacyKey(): Buffer | null {
  if (!process.env.OCTOPUS_DATA_KEY) return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function aeadEncrypt(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function aeadDecrypt(key: Buffer, token: string): Buffer {
  const buf = Buffer.from(token, "base64url");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Try the primary key; on AEAD failure (wrong tag, wrong key), try the legacy
// key if available. Any other failure (truncated payload, etc.) surfaces from
// the primary attempt.
function decryptWithFallback(token: string): Buffer {
  try {
    return aeadDecrypt(getPrimaryKey(), token);
  } catch (primaryErr) {
    const legacy = getLegacyKey();
    if (!legacy) throw primaryErr;
    try {
      return aeadDecrypt(legacy, token);
    } catch {
      throw primaryErr;
    }
  }
}

export function encryptJson(value: unknown): string {
  return aeadEncrypt(getPrimaryKey(), Buffer.from(JSON.stringify(value), "utf8"));
}

export function decryptJson<T>(token: string): T {
  return JSON.parse(decryptWithFallback(token).toString("utf8")) as T;
}

export function encryptString(value: string): string {
  return aeadEncrypt(getPrimaryKey(), Buffer.from(value, "utf8"));
}

export function decryptString(token: string): string {
  return decryptWithFallback(token).toString("utf8");
}

// Tries decryptString; on any failure (legacy plaintext row, truncated payload,
// bad auth tag from a key rotation) returns the input as-is. Used during the
// rolling encryption migration so reads still work against unmigrated rows;
// callers should re-persist the value encrypted whenever they refresh/write it.
export function decryptStringMaybeLegacy(value: string): string {
  try {
    return decryptString(value);
  } catch {
    return value;
  }
}
