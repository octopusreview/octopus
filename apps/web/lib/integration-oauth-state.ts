import { randomBytes, timingSafeEqual } from "node:crypto";
import { decryptJson, encryptJson } from "@/lib/crypto";

export type IntegrationOAuthProvider = "linear" | "jira" | "bitbucket";

export const INTEGRATION_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type IntegrationOAuthState = {
  v: 1;
  provider: IntegrationOAuthProvider;
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
  context?: Record<string, string>;
};

type VerifiedState =
  | { ok: true; state: IntegrationOAuthState }
  | { ok: false; error: "invalid_state" | "state_expired" };

export function integrationOAuthStateCookie(
  provider: IntegrationOAuthProvider,
): string {
  return `${provider}_oauth_state`;
}

export function createIntegrationOAuthState(input: {
  provider: IntegrationOAuthProvider;
  orgId: string;
  userId: string;
  context?: Record<string, string>;
  now?: number;
}): { state: string; nonce: string } {
  const nonce = randomBytes(32).toString("base64url");
  const value: IntegrationOAuthState = {
    v: 1,
    provider: input.provider,
    orgId: input.orgId,
    userId: input.userId,
    nonce,
    exp: (input.now ?? Date.now()) + INTEGRATION_OAUTH_STATE_TTL_MS,
    ...(input.context ? { context: input.context } : {}),
  };

  return { state: encryptJson(value), nonce };
}

export function integrationOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(INTEGRATION_OAUTH_STATE_TTL_MS / 1000),
  };
}

export function verifyIntegrationOAuthState(input: {
  state: string;
  cookieNonce: string | undefined;
  provider: IntegrationOAuthProvider;
  now?: number;
}): VerifiedState {
  let value: IntegrationOAuthState;
  try {
    value = decryptJson<IntegrationOAuthState>(input.state);
  } catch {
    return { ok: false, error: "invalid_state" };
  }

  if (
    value?.v !== 1 ||
    value.provider !== input.provider ||
    typeof value.orgId !== "string" ||
    !value.orgId ||
    typeof value.userId !== "string" ||
    !value.userId ||
    typeof value.nonce !== "string" ||
    !value.nonce ||
    typeof value.exp !== "number"
  ) {
    return { ok: false, error: "invalid_state" };
  }

  if ((input.now ?? Date.now()) > value.exp) {
    return { ok: false, error: "state_expired" };
  }

  if (!input.cookieNonce || !noncesMatch(input.cookieNonce, value.nonce)) {
    return { ok: false, error: "invalid_state" };
  }

  return { ok: true, state: value };
}

function noncesMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
