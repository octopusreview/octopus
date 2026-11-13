import "server-only";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import {
  exchangeGithubAppUserCode,
  userCanAccessInstallation,
} from "@/lib/github";
import { getGithubAppConfig } from "@/lib/github-app-config";
import { syncOrgRepos } from "@/lib/repo-sync";
import { getRedis } from "@/lib/redis";
import { writeAuditLog } from "@/lib/audit";
import {
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_INSTALL_STATE_TTL_MS,
  safeReturnPath,
  signInstallationVerificationState,
  stateReplayKey,
  verifyInstallationVerificationState,
  verifyInstallState,
  type InstallStatePayload,
  type InstallationVerificationStatePayload,
} from "@/lib/github-install-state";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const callbackUrl = new URL("/api/github/callback", baseUrl).toString();
// One brief reconnect must not reject a connect; a real outage still fails closed after under a second.
const STATE_STORE_ATTEMPTS = 3;

type FailureActor = { actorId: string; organizationId: string };

async function errorRedirect(
  reason: string,
  who?: FailureActor,
  githubError?: string | null,
) {
  // Funnel: every failed connect attempt is recorded with its reason and, once
  // the signed state has been verified, with the user and organization it was
  // for — so affected customers can be found. writeAuditLog swallows its own
  // errors. A *_not_configured reason is OUR misconfiguration: shout in logs.
  if (reason.endsWith("_not_configured")) {
    console.error(`[github/callback] misconfiguration: ${reason} — GitHub installs cannot complete`);
  }
  await writeAuditLog({
    action: "integration.install_failed",
    category: "system",
    actorId: who?.actorId ?? null,
    organizationId: who?.organizationId ?? null,
    metadata: { provider: "github", reason, ...(githubError ? { githubError } : {}) },
  });
  const url = new URL("/settings/integrations", baseUrl);
  url.searchParams.set("error", reason);
  const response = NextResponse.redirect(url);
  response.cookies.delete({
    name: GITHUB_INSTALL_STATE_COOKIE,
    path: "/api/github/callback",
  });
  return response;
}

function loginResumeRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

function parseInstallationId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function consumeState(jti: string, exp: number): Promise<"ok" | "replay" | "unavailable"> {
  const redis = getRedis();
  if (!redis) {
    // The OAuth code and browser nonce remain one-time authorization controls
    // when Redis is intentionally omitted in a small self-hosted deployment.
    console.warn("[github/callback] Redis unavailable — relying on OAuth code and browser nonce replay controls");
    return "ok";
  }
  const key = stateReplayKey(jti);
  const ttlMs = Math.max(exp - Date.now(), 0) + 60_000;
  // Identifies this request's own write, so a retry can tell it apart from a replay.
  const token = crypto.randomUUID();
  for (let attempt = 1; ; attempt++) {
    try {
      if (await redis.set(key, token, "PX", ttlMs, "NX") === "OK") return "ok";
      // A failed attempt may have reached Redis before its reply was lost; the key then holds our token.
      return attempt > 1 && await redis.get(key) === token ? "ok" : "replay";
    } catch (error) {
      if (attempt === STATE_STORE_ATTEMPTS) {
        console.error("[github/callback] state replay store failed:", error);
        Sentry.captureException(error, { tags: { failure_stage: "github_callback_state_store" } });
        return "unavailable";
      }
      // The shared client rejects commands at once while it reconnects (enableOfflineQueue: false).
      await delay(250 * attempt);
    }
  }
}

async function requireMatchingSession(
  payload: InstallStatePayload | InstallationVerificationStatePayload,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false as const, reason: "session_required" };
  if (session.user.id !== payload.uid) {
    return { ok: false as const, reason: "state_user_mismatch" };
  }

  const cookieStore = await cookies();
  const nonce = cookieStore.get(GITHUB_INSTALL_STATE_COOKIE)?.value;
  if (!nonce || nonce !== payload.nonce) {
    return { ok: false as const, reason: "state_browser_mismatch" };
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      organizationId: payload.oid,
      deletedAt: null,
    },
    select: { organizationId: true },
  });
  if (!membership) return { ok: false as const, reason: "not_a_member" };

  return { ok: true as const, organizationId: membership.organizationId };
}

async function bindAndSyncInstallation(
  installationId: number,
  organizationId: string,
) {
  let existingBinding = await prisma.organization.findUnique({
    where: { githubInstallationId: installationId },
    select: { id: true, deletedAt: true },
  });

  // A soft-deleted organization must not squat the installation forever
  // (deleteOrganization keeps the column): release it and bind here instead.
  if (existingBinding && existingBinding.id !== organizationId && existingBinding.deletedAt) {
    await prisma.organization.update({
      where: { id: existingBinding.id },
      data: { githubInstallationId: null },
    });
    existingBinding = null;
  }

  if (existingBinding && existingBinding.id !== organizationId) {
    return { ok: false as const, reason: "installation_already_bound" };
  }

  if (!existingBinding) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { githubInstallationId: installationId },
    });
  }

  try {
    // The callback lists only the newly verified org binding, never legacy repo installations.
    const result = await syncOrgRepos(organizationId, { source: "webhook", providers: ["github"] });
    return { ok: true as const, setupError: result.error ?? null };
  } catch {
    const message = "GitHub access was authorized, but repository setup did not finish. Retry setup in Settings → Integrations.";
    await prisma.organization.updateMany({ where: { id: organizationId, githubInstallationId: installationId }, data: {
      githubSetupStatus: {
        sync: { status: "failed", checkedAt: new Date().toISOString(), error: message },
        webhook: { status: "unknown", checkedAt: null, error: null },
      },
    } });
    return { ok: true as const, setupError: message };
  }

}

async function beginVerification(request: NextRequest, stateParam: string) {
  const verified = verifyInstallState(stateParam);
  if (!verified.ok) return errorRedirect(`invalid_state_${verified.reason}`);
  const who: FailureActor = { actorId: verified.payload.uid, organizationId: verified.payload.oid };

  const caller = await requireMatchingSession(verified.payload);
  if (!caller.ok) {
    return caller.reason === "session_required"
      ? loginResumeRedirect(request)
      : errorRedirect(caller.reason, who);
  }

  const replay = await consumeState(verified.payload.jti, verified.payload.exp);
  if (replay === "replay") return errorRedirect("replay_detected", who);
  if (replay === "unavailable") return errorRedirect("state_store_unavailable", who);

  const rawInstallationId = request.nextUrl.searchParams.get("installation_id");
  if (!rawInstallationId) {
    // GitHub sends the user back without an installation when the install
    // still needs an organization owner's approval (setup_action=request).
    // Not an error for the user, but record it so the funnel is not silent.
    void writeAuditLog({
      action: "integration.install_failed",
      category: "system",
      actorId: who.actorId,
      organizationId: who.organizationId,
      metadata: {
        provider: "github",
        reason: "installation_pending_approval",
        setupAction: request.nextUrl.searchParams.get("setup_action"),
      },
    }).catch(() => {});
    const response = NextResponse.redirect(
      new URL(safeReturnPath(verified.payload.rt), baseUrl),
    );
    response.cookies.delete({
      name: GITHUB_INSTALL_STATE_COOKIE,
      path: "/api/github/callback",
    });
    return response;
  }
  const installationId = parseInstallationId(rawInstallationId);
  if (!installationId) return errorRedirect("invalid_installation_id", who);

  const appConfig = await getGithubAppConfig();
  if (!appConfig?.clientId || !appConfig.clientSecret) {
    return errorRedirect("github_verification_not_configured", who);
  }

  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = signInstallationVerificationState({
    uid: verified.payload.uid,
    oid: caller.organizationId,
    rt: safeReturnPath(verified.payload.rt),
    nonce,
    installationId,
  });
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", appConfig.clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/github/callback",
    maxAge: Math.floor(GITHUB_INSTALL_STATE_TTL_MS / 1000),
  });
  return response;
}

async function finishVerification(request: NextRequest, stateParam: string) {
  const verified = verifyInstallationVerificationState(stateParam);
  if (!verified.ok) return errorRedirect(`invalid_state_${verified.reason}`);
  const who: FailureActor = { actorId: verified.payload.uid, organizationId: verified.payload.oid };

  const caller = await requireMatchingSession(verified.payload);
  if (!caller.ok) {
    return caller.reason === "session_required"
      ? loginResumeRedirect(request)
      : errorRedirect(caller.reason, who);
  }

  const replay = await consumeState(verified.payload.jti, verified.payload.exp);
  if (replay === "replay") return errorRedirect("replay_detected", who);
  if (replay === "unavailable") return errorRedirect("state_store_unavailable", who);

  const githubError = request.nextUrl.searchParams.get("error");
  if (githubError) {
    // e.g. access_denied (user declined) vs redirect_uri_mismatch (our App's
    // callback URL is wrong): keep GitHub's code so the two are distinguishable.
    return errorRedirect("github_authorization_denied", who, githubError);
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return errorRedirect("github_authorization_failed", who);

  const appConfig = await getGithubAppConfig();
  if (!appConfig?.clientId || !appConfig.clientSecret) {
    return errorRedirect("github_verification_not_configured", who);
  }

  let userAccessToken: string;
  try {
    userAccessToken = await exchangeGithubAppUserCode({
      clientId: appConfig.clientId,
      clientSecret: appConfig.clientSecret,
      code,
      redirectUri: callbackUrl,
    });
  } catch (error) {
    console.error("[github/callback] user token exchange failed:", error);
    return errorRedirect("github_authorization_failed", who);
  }

  try {
    const accessible = await userCanAccessInstallation(
      userAccessToken,
      verified.payload.installationId,
    );
    if (!accessible) return errorRedirect("installation_not_accessible", who);
  } catch (error) {
    console.error("[github/callback] installation ownership verification failed:", error);
    return errorRedirect("github_authorization_failed", who);
  }

  const binding = await bindAndSyncInstallation(
    verified.payload.installationId,
    caller.organizationId,
  );
  if (!binding.ok) return errorRedirect(binding.reason, who);

  // Funnel: install completed and bound to the org.
  await writeAuditLog({
    action: "integration.connected",
    category: "system",
    actorId: verified.payload.uid,
    organizationId: caller.organizationId,
    targetType: "Organization",
    targetId: caller.organizationId,
    metadata: {
      provider: "github",
      installationId: verified.payload.installationId,
    },
  });

  revalidatePath("/", "layout");
  revalidatePath("/");
  const returnUrl = new URL(safeReturnPath(verified.payload.rt), baseUrl);
  if (binding.setupError) returnUrl.searchParams.set("setup", "attention");
  const response = NextResponse.redirect(returnUrl);
  response.cookies.delete({
    name: GITHUB_INSTALL_STATE_COOKIE,
    path: "/api/github/callback",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const stateParam = request.nextUrl.searchParams.get("state");
  if (!stateParam) {
    // GitHub-initiated installs (github.com/apps/<slug> or the Marketplace)
    // land here without state. Bounce through login → /api/github/install,
    // which mints the signed state server-side before resuming the flow.
    const loginUrl = new URL("/login", baseUrl);
    const returnTo = new URL("/api/github/install", baseUrl);
    returnTo.searchParams.set("returnTo", "/settings/integrations");
    loginUrl.searchParams.set(
      "callbackUrl",
      returnTo.pathname + returnTo.search,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (
    request.nextUrl.searchParams.has("code") ||
    request.nextUrl.searchParams.has("error")
  ) {
    return finishVerification(request, stateParam);
  }
  return beginVerification(request, stateParam);
}
