import crypto from "node:crypto";

export interface InstallStatePayload {
  uid: string;
  oid: string;
  rt: string;
  exp: number;
  jti: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

// Visible boot-time warning so ops notices a misconfigured secret before the
// first user click on the install flow, not as a 500 inside the OAuth redirect.
if (process.env.NODE_ENV !== "test") {
  const secret = process.env.GITHUB_STATE_SECRET;
  if (!secret) {
    console.warn(
      "[github-install-state] GITHUB_STATE_SECRET is not set — the GitHub install flow will fail until it is.",
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    console.warn(
      `[github-install-state] GITHUB_STATE_SECRET is too short (${secret.length} chars, min ${MIN_SECRET_LENGTH}).`,
    );
  }
}

function getSecret(): Buffer {
  const secret = process.env.GITHUB_STATE_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `GITHUB_STATE_SECRET is missing or too short (min ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  return Buffer.from(secret, "utf8");
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

export function signInstallState(input: Omit<InstallStatePayload, "exp" | "jti">): string {
  const payload: InstallStatePayload = {
    ...input,
    exp: Date.now() + STATE_TTL_MS,
    jti: crypto.randomBytes(16).toString("base64url"),
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: InstallStatePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyInstallState(state: string): VerifyResult {
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts;

  let expected: Buffer;
  try {
    expected = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest();
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let provided: Buffer;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: InstallStatePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof payload.uid !== "string" ||
    typeof payload.oid !== "string" ||
    typeof payload.rt !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp < Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

export function stateReplayKey(jti: string): string {
  return `gh:install:state:jti:${jti}`;
}
