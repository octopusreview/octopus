import "server-only";
import { prisma } from "@octopus/db";
import { encryptString, decryptStringMaybeLegacy } from "@/lib/crypto";

/**
 * Resolved GitHub App credentials. Source is the SystemConfig singleton when a
 * self-hoster provisioned an App via the manifest flow (lib/github-app-config
 * saveGithubAppConfig), otherwise the GITHUB_APP_* / NEXT_PUBLIC_GITHUB_APP_SLUG
 * env vars (cloud + manually-configured self-host). DB wins over env.
 */
export type GithubAppConfig = {
  appId: string;
  privateKey: string;
  webhookSecret: string | null;
  slug: string | null;
  clientId: string | null;
  clientSecret: string | null;
  htmlUrl: string | null;
};

// Small in-process memo so we don't hit the DB on every GitHub API call /
// webhook. Invalidated explicitly after a manifest write (clearCache).
const TTL_MS = 30_000;
let cache: { value: GithubAppConfig | null; at: number } | null = null;

export function clearGithubAppConfigCache(): void {
  cache = null;
}

function fromEnv(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return null;
  return {
    appId,
    privateKey,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? null,
    slug: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? null,
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? null,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? null,
    htmlUrl: null,
  };
}

async function resolve(): Promise<GithubAppConfig | null> {
  // DB-first: a manifest-provisioned App overrides env. On any DB error, fall
  // back to env rather than breaking every GitHub call (mirrors review-effort).
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: {
        githubAppId: true,
        githubAppSlug: true,
        githubAppClientId: true,
        githubAppHtmlUrl: true,
        githubAppPrivateKeyEnc: true,
        githubAppWebhookSecretEnc: true,
        githubAppClientSecretEnc: true,
      },
    });
    if (row?.githubAppId && row.githubAppPrivateKeyEnc) {
      return {
        appId: row.githubAppId,
        privateKey: decryptStringMaybeLegacy(row.githubAppPrivateKeyEnc),
        webhookSecret: row.githubAppWebhookSecretEnc
          ? decryptStringMaybeLegacy(row.githubAppWebhookSecretEnc)
          : null,
        slug: row.githubAppSlug,
        clientId: row.githubAppClientId,
        clientSecret: row.githubAppClientSecretEnc
          ? decryptStringMaybeLegacy(row.githubAppClientSecretEnc)
          : null,
        htmlUrl: row.githubAppHtmlUrl,
      };
    }
  } catch (err) {
    console.error("[github-app-config] DB read failed, falling back to env:", err);
  }
  return fromEnv();
}

/** Resolved GitHub App config (DB-first, env fallback), memoized ~30s. */
export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await resolve();
  cache = { value, at: Date.now() };
  return value;
}

/** Whether a GitHub App is configured at all (DB or env). */
/**
 * The install callback verifies that the installing user can access the
 * installation through a GitHub App user-authorization hop, which needs the
 * App's OAuth client credentials. Without them every install completes on
 * GitHub and then fails to bind (github_verification_not_configured) — which
 * is exactly what happened on Octopus Cloud from v1.0.90 until the env was
 * fixed. So: no App at all is fine (Connect is hidden), but an App without
 * client credentials is a misconfiguration. Cloud refuses to start (the deploy
 * health gate keeps the previous version serving); self-host logs loudly.
 */
export function assertGithubAppVerificationConfig(input: {
  selfHosted: boolean;
  appConfig: Pick<GithubAppConfig, "clientId" | "clientSecret"> | null;
}): void {
  if (!input.appConfig) return;
  if (input.appConfig.clientId && input.appConfig.clientSecret) return;
  const message =
    "[github-app] GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET missing — GitHub installs will fail with github_verification_not_configured";
  if (!input.selfHosted) throw new Error(message);
  console.error(message);
}

export async function isGithubAppConfigured(): Promise<boolean> {
  return (await getGithubAppConfig()) !== null;
}

/** Whether an App is configured specifically in the DB (manifest-provisioned). */
export async function hasDbGithubApp(): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { githubAppId: true },
    });
    return Boolean(row?.githubAppId);
  } catch {
    return false;
  }
}

export type SaveGithubAppInput = {
  appId: string | number;
  slug: string;
  htmlUrl?: string | null;
  clientId?: string | null;
  privateKey: string; // PEM
  webhookSecret?: string | null;
  clientSecret?: string | null;
};

/**
 * Persist manifest-provisioned App credentials (secrets encrypted). Writes
 * CONDITIONALLY — only when no App is configured yet — so a concurrent second
 * manifest flow can never clobber the first (a plain upsert would overwrite).
 * Returns true if it wrote, false if an App already existed. Clears the memo on write.
 */
export async function saveGithubAppConfig(input: SaveGithubAppInput): Promise<boolean> {
  const data = {
    githubAppId: String(input.appId),
    githubAppSlug: input.slug,
    githubAppHtmlUrl: input.htmlUrl ?? null,
    githubAppClientId: input.clientId ?? null,
    githubAppPrivateKeyEnc: encryptString(input.privateKey),
    githubAppWebhookSecretEnc: input.webhookSecret ? encryptString(input.webhookSecret) : null,
    githubAppClientSecretEnc: input.clientSecret ? encryptString(input.clientSecret) : null,
  };

  // Atomic guard: update the singleton only while githubAppId is still null.
  const updated = await prisma.systemConfig.updateMany({
    where: { id: "singleton", githubAppId: null },
    data,
  });
  if (updated.count > 0) {
    clearGithubAppConfigCache();
    return true;
  }

  // count 0 → the singleton row is missing, or an App is already set.
  const existing = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { githubAppId: true },
  });
  if (existing?.githubAppId) return false; // already configured — never clobber
  if (!existing) {
    try {
      await prisma.systemConfig.create({ data: { id: "singleton", ...data } });
      clearGithubAppConfigCache();
      return true;
    } catch {
      // lost the create race on the singleton PK → someone else configured it.
      return false;
    }
  }
  return false;
}
