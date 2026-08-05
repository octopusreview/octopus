import "server-only";

import crypto from "node:crypto";
import { prisma } from "@octopus/db";

const MAX_DELIVERY_ID_LENGTH = 255;
const MAX_EVENT_TYPE_LENGTH = 100;
const MAX_ACTION_LENGTH = 100;
const MAX_PROVIDER_REPOSITORY_ID_LENGTH = 32;
const MAX_WEBHOOK_TOKEN_LENGTH = 512;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

export const WEBHOOK_TENANT_RESOLUTION_STATUSES = [
  "resolved",
  "installation_only",
  "missing_installation",
  "unmapped_installation",
  "repository_not_owned",
] as const;

export type WebhookTenantResolutionStatus =
  (typeof WEBHOOK_TENANT_RESOLUTION_STATUSES)[number];

export const WEBHOOK_TENANT_COMPARISON_STATUSES = [
  "matched",
  "mismatch",
  "ambiguous",
  "legacy_only",
  "shadow_only",
  "unresolved",
  "not_applicable",
] as const;

export type WebhookTenantComparisonStatus =
  (typeof WEBHOOK_TENANT_COMPARISON_STATUSES)[number];

export interface LegacyWebhookRepository {
  id: string;
  organizationId: string;
}

export interface GithubWebhookTenantInput {
  provider: "github";
  installationId: unknown;
  repositoryExternalId?: unknown;
}

export interface GithubWebhookTenantResolution {
  provider: "github";
  status: WebhookTenantResolutionStatus;
  organizationId: string | null;
  repositoryId: string | null;
}

export const GITLAB_WEBHOOK_TENANT_RESOLUTION_STATUSES = [
  "resolved",
  "missing_token",
  "unmapped_token",
  "ambiguous_token",
  "repository_not_owned",
  "repository_inactive",
] as const;

export type GitlabWebhookTenantResolutionStatus =
  (typeof GITLAB_WEBHOOK_TENANT_RESOLUTION_STATUSES)[number];

export interface GitlabWebhookIntegrationInput {
  provider: "gitlab";
  token: unknown;
}

export interface GitlabWebhookIntegrationResolution {
  provider: "gitlab";
  status: "resolved" | "missing_token" | "unmapped_token" | "ambiguous_token";
  organizationId: string | null;
}

export interface GitlabWebhookTenantInput {
  provider: "gitlab";
  organizationId: string;
  repositoryExternalId: unknown;
}

export interface GitlabWebhookRepository {
  id: string;
  organizationId: string;
  autoReview: boolean;
  fullName: string;
  isActive: boolean;
  dismissedAt: Date | null;
}

export interface GitlabWebhookTenantResolution {
  provider: "gitlab";
  status: GitlabWebhookTenantResolutionStatus;
  organizationId: string | null;
  repository: GitlabWebhookRepository | null;
}

interface OrganizationLookup {
  findUnique(args: {
    where: { githubInstallationId: number };
    select: { id: true };
  }): Promise<{ id: string } | null>;
}

interface RepositoryLookup {
  findUnique(args: {
    where: {
      provider_externalId_organizationId: {
        provider: "github";
        externalId: string;
        organizationId: string;
      };
    };
    select: { id: true; organizationId: true };
  }): Promise<{ id: string; organizationId: string } | null>;
}

export interface WebhookTenantStore {
  organization: OrganizationLookup;
  repository: RepositoryLookup;
}

export interface GitlabWebhookTenantStore {
  gitlabIntegration: {
    findMany(args: {
      where: { webhookSecret: string };
      select: { organizationId: true; webhookSecret: true };
      take: 2;
    }): Promise<Array<{ organizationId: string; webhookSecret: string | null }>>;
  };
  repository: {
    findUnique(args: {
      where: {
        provider_externalId_organizationId: {
          provider: "gitlab";
          externalId: string;
          organizationId: string;
        };
      };
      select: {
        id: true;
        organizationId: true;
        autoReview: true;
        fullName: true;
        isActive: true;
        dismissedAt: true;
      };
    }): Promise<GitlabWebhookRepository | null>;
  };
}

interface WebhookDeliveryUpsertArgs {
  where: {
    provider_deliveryId: { provider: "github"; deliveryId: string };
  };
  create: {
    provider: "github";
    deliveryId: string;
    deliveryIdSource: "provider" | "payload_sha256";
    eventType: string;
    action: string | null;
    payloadSha256: string;
    providerInstallationId: string | null;
    providerRepositoryId: string | null;
    resolvedOrganizationId: string | null;
    resolvedRepositoryId: string | null;
    legacyOrganizationId: string | null;
    legacyRepositoryId: string | null;
    resolutionStatus: WebhookTenantResolutionStatus;
    comparisonStatus: WebhookTenantComparisonStatus;
    legacyCandidateCount: number;
    lastSeenAt: Date;
  };
  update: {
    attemptCount: { increment: 1 };
    lastSeenAt: Date;
  };
  select: { attemptCount: true; payloadSha256: true };
}

interface WebhookDeliveryCollisionUpdateArgs {
  where: {
    provider_deliveryId: { provider: "github"; deliveryId: string };
  };
  data: { payloadHashCollisionCount: { increment: 1 } };
  select: { payloadHashCollisionCount: true };
}

export interface WebhookObservationStore extends WebhookTenantStore {
  repository: RepositoryLookup & {
    count(args: {
      where: { provider: "github"; externalId: string };
    }): Promise<number>;
  };
  webhookDelivery: {
    upsert(args: WebhookDeliveryUpsertArgs): Promise<{
      attemptCount: number;
      payloadSha256: string;
    }>;
    update(args: WebhookDeliveryCollisionUpdateArgs): Promise<{
      payloadHashCollisionCount: number;
    }>;
  };
  $transaction(
    callback: (transaction: {
      webhookDelivery: WebhookObservationStore["webhookDelivery"];
    }) => Promise<{
      attemptCount: number;
      payloadHashCollision: boolean;
    }>,
  ): Promise<{
    attemptCount: number;
    payloadHashCollision: boolean;
  }>;
}

export interface GithubWebhookObservationInput {
  deliveryId: unknown;
  eventType: unknown;
  action: unknown;
  payloadSha256: string;
  installationId: unknown;
  repositoryExternalId: unknown;
  // `undefined` means the legacy route did not perform a repository lookup.
  // `null` means it performed the lookup but found no row.
  legacyRepository?: LegacyWebhookRepository | null;
  // Installation lifecycle routes already resolve the binding before a delete
  // mutation. Passing that snapshot prevents post-response observation from
  // misclassifying a successful uninstall as an unmapped installation.
  tenantResolution?: GithubWebhookTenantResolution;
}

export interface GithubWebhookObservationResult {
  recorded: true;
  attemptCount: number;
  payloadHashCollision: boolean;
  resolutionStatus: WebhookTenantResolutionStatus;
  comparisonStatus: WebhookTenantComparisonStatus;
}

export interface WebhookObservationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface WebhookDeliveryRetentionStore {
  webhookDelivery: {
    deleteMany(args: {
      where: { lastSeenAt: { lt: Date } };
    }): Promise<{ count: number }>;
  };
}

export const WEBHOOK_DELIVERY_DEFAULT_RETENTION_DAYS = 30;
export const WEBHOOK_DELIVERY_MAX_RETENTION_DAYS = 365;

export function resolveWebhookDeliveryRetentionDays(
  retentionDays?: number,
): number {
  const envOverride = process.env.WEBHOOK_DELIVERY_RETENTION_DAYS?.trim();
  let days = retentionDays;
  if (days === undefined) {
    if (!envOverride) {
      days = WEBHOOK_DELIVERY_DEFAULT_RETENTION_DAYS;
    } else {
      days = /^\d+$/.test(envOverride) ? Number(envOverride) : Number.NaN;
    }
  }
  if (
    !Number.isFinite(days) ||
    !Number.isInteger(days) ||
    days <= 0 ||
    days > WEBHOOK_DELIVERY_MAX_RETENTION_DAYS
  ) {
    throw new Error(
      `Invalid webhook delivery retention window; expected an integer from 1 to ${WEBHOOK_DELIVERY_MAX_RETENTION_DAYS} days`,
    );
  }
  return days;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function boundedSecret(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return value;
}

function normalizeInstallationId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeRepositoryExternalId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  const normalized = boundedString(value, MAX_PROVIDER_REPOSITORY_ID_LENGTH);
  return normalized && POSITIVE_DECIMAL.test(normalized) ? normalized : null;
}

function secretsMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function resolveGithubWebhookTenant(
  input: GithubWebhookTenantInput,
  store: WebhookTenantStore = prisma,
): Promise<GithubWebhookTenantResolution> {
  const installationId = normalizeInstallationId(input.installationId);
  if (installationId === null) {
    return {
      provider: "github",
      status: "missing_installation",
      organizationId: null,
      repositoryId: null,
    };
  }

  // The signed installation ID is the sole tenant authority. Repository-level
  // installationId is intentionally ignored because the legacy route mutates it.
  const organization = await store.organization.findUnique({
    where: { githubInstallationId: installationId },
    select: { id: true },
  });
  if (!organization) {
    return {
      provider: "github",
      status: "unmapped_installation",
      organizationId: null,
      repositoryId: null,
    };
  }

  const repositoryExternalId = normalizeRepositoryExternalId(
    input.repositoryExternalId,
  );
  if (repositoryExternalId === null) {
    return {
      provider: "github",
      status: "installation_only",
      organizationId: organization.id,
      repositoryId: null,
    };
  }

  const repository = await store.repository.findUnique({
    where: {
      provider_externalId_organizationId: {
        provider: "github",
        externalId: repositoryExternalId,
        organizationId: organization.id,
      },
    },
    select: { id: true, organizationId: true },
  });
  if (!repository) {
    return {
      provider: "github",
      status: "repository_not_owned",
      organizationId: organization.id,
      repositoryId: null,
    };
  }

  return {
    provider: "github",
    status: "resolved",
    organizationId: organization.id,
    repositoryId: repository.id,
  };
}

export async function resolveGitlabWebhookIntegration(
  input: GitlabWebhookIntegrationInput,
  store: GitlabWebhookTenantStore = prisma,
): Promise<GitlabWebhookIntegrationResolution> {
  const token = boundedSecret(input.token, MAX_WEBHOOK_TOKEN_LENGTH);
  if (token === null) {
    return {
      provider: "gitlab",
      status: "missing_token",
      organizationId: null,
    };
  }

  const integrations = await store.gitlabIntegration.findMany({
    where: { webhookSecret: token },
    select: { organizationId: true, webhookSecret: true },
    take: 2,
  });
  if (integrations.length === 0) {
    return {
      provider: "gitlab",
      status: "unmapped_token",
      organizationId: null,
    };
  }
  if (
    integrations.length !== 1 ||
    !integrations[0]?.webhookSecret ||
    !secretsMatch(integrations[0].webhookSecret, token)
  ) {
    return {
      provider: "gitlab",
      status: "ambiguous_token",
      organizationId: null,
    };
  }

  return {
    provider: "gitlab",
    status: "resolved",
    organizationId: integrations[0].organizationId,
  };
}

export async function resolveGitlabWebhookTenant(
  input: GitlabWebhookTenantInput,
  store: GitlabWebhookTenantStore = prisma,
): Promise<GitlabWebhookTenantResolution> {
  const organizationId = input.organizationId;
  const repositoryExternalId = normalizeRepositoryExternalId(
    input.repositoryExternalId,
  );
  if (repositoryExternalId === null) {
    return {
      provider: "gitlab",
      status: "repository_not_owned",
      organizationId,
      repository: null,
    };
  }

  const repository = await store.repository.findUnique({
    where: {
      provider_externalId_organizationId: {
        provider: "gitlab",
        externalId: repositoryExternalId,
        organizationId,
      },
    },
    select: {
      id: true,
      organizationId: true,
      autoReview: true,
      fullName: true,
      isActive: true,
      dismissedAt: true,
    },
  });
  if (!repository) {
    return {
      provider: "gitlab",
      status: "repository_not_owned",
      organizationId,
      repository: null,
    };
  }
  if (!repository.isActive || repository.dismissedAt !== null) {
    return {
      provider: "gitlab",
      status: "repository_inactive",
      organizationId,
      repository: null,
    };
  }

  return {
    provider: "gitlab",
    status: "resolved",
    organizationId,
    repository,
  };
}

export function compareWebhookTenantResolution(
  resolution: GithubWebhookTenantResolution,
  legacyRepository: LegacyWebhookRepository | null | undefined,
  legacyCandidateCount: number,
): WebhookTenantComparisonStatus {
  if (legacyRepository === undefined) return "not_applicable";
  if (legacyCandidateCount > 1) return "ambiguous";
  if (legacyRepository === null && resolution.repositoryId === null) {
    return "unresolved";
  }
  if (legacyRepository === null) return "shadow_only";
  if (resolution.repositoryId === null) return "legacy_only";
  if (
    legacyRepository.id === resolution.repositoryId &&
    legacyRepository.organizationId === resolution.organizationId
  ) {
    return "matched";
  }
  return "mismatch";
}

export async function observeGithubWebhookDelivery(
  input: GithubWebhookObservationInput,
  store: WebhookObservationStore = prisma,
): Promise<GithubWebhookObservationResult> {
  if (!SHA256_HEX.test(input.payloadSha256)) {
    throw new Error("Invalid webhook payload SHA-256");
  }

  const providerDeliveryId = boundedString(
    input.deliveryId,
    MAX_DELIVERY_ID_LENGTH,
  );
  // GitHub's x-github-delivery header is not covered by the body HMAC. It is
  // an observation-only correlation key here. Any future deduplication or
  // routing enforcement must use identity derived from the verified body or
  // signature, never this provider header alone.
  const deliveryId = providerDeliveryId ?? `sha256:${input.payloadSha256}`;
  const deliveryIdSource = providerDeliveryId ? "provider" : "payload_sha256";
  const eventType =
    boundedString(input.eventType, MAX_EVENT_TYPE_LENGTH) ?? "unknown";
  const action = boundedString(input.action, MAX_ACTION_LENGTH);
  const installationId = normalizeInstallationId(input.installationId);
  const repositoryExternalId = normalizeRepositoryExternalId(
    input.repositoryExternalId,
  );

  const [resolution, legacyCandidateCount] = await Promise.all([
    input.tenantResolution
      ? Promise.resolve(input.tenantResolution)
      : resolveGithubWebhookTenant(
          {
            provider: "github",
            installationId,
            repositoryExternalId,
          },
          store,
        ),
    repositoryExternalId && input.legacyRepository !== undefined
      ? store.repository.count({
          where: { provider: "github", externalId: repositoryExternalId },
        })
      : Promise.resolve(0),
  ]);
  const comparisonStatus = compareWebhookTenantResolution(
    resolution,
    input.legacyRepository,
    legacyCandidateCount,
  );
  const now = new Date();
  const observation = {
    eventType,
    action,
    payloadSha256: input.payloadSha256,
    providerInstallationId:
      installationId === null ? null : String(installationId),
    providerRepositoryId: repositoryExternalId,
    resolvedOrganizationId: resolution.organizationId,
    resolvedRepositoryId: resolution.repositoryId,
    legacyOrganizationId: input.legacyRepository?.organizationId ?? null,
    legacyRepositoryId: input.legacyRepository?.id ?? null,
    resolutionStatus: resolution.status,
    comparisonStatus,
    legacyCandidateCount,
    lastSeenAt: now,
  };

  const delivery = await store.$transaction(async (transaction) => {
    const firstObservation = await transaction.webhookDelivery.upsert({
      where: {
        provider_deliveryId: { provider: "github", deliveryId },
      },
      create: {
        provider: "github",
        deliveryId,
        deliveryIdSource,
        ...observation,
      },
      update: {
        attemptCount: { increment: 1 },
        lastSeenAt: now,
      },
      select: { attemptCount: true, payloadSha256: true },
    });

    // Keep the first payload hash immutable, but distinguish a provider
    // delivery ID collision from a normal byte-for-byte redelivery. Both
    // counters commit together so collision telemetry cannot be partially lost.
    const payloadHashCollision =
      firstObservation.payloadSha256 !== input.payloadSha256;
    if (payloadHashCollision) {
      await transaction.webhookDelivery.update({
        where: {
          provider_deliveryId: { provider: "github", deliveryId },
        },
        data: { payloadHashCollisionCount: { increment: 1 } },
        select: { payloadHashCollisionCount: true },
      });
    }

    return {
      attemptCount: firstObservation.attemptCount,
      payloadHashCollision,
    };
  });

  return {
    recorded: true,
    attemptCount: delivery.attemptCount,
    payloadHashCollision: delivery.payloadHashCollision,
    resolutionStatus: resolution.status,
    comparisonStatus,
  };
}

/**
 * Best-effort telemetry wrapper. Delivery storage, retry counting, and provider
 * delivery IDs are observational only and must never become routing authority.
 */
export async function observeGithubWebhookDeliveryBestEffort(
  input: GithubWebhookObservationInput,
  store: WebhookObservationStore = prisma,
  logger: WebhookObservationLogger = console,
): Promise<GithubWebhookObservationResult | null> {
  try {
    const observation = await observeGithubWebhookDelivery(input, store);
    if (
      observation.comparisonStatus === "mismatch" ||
      observation.comparisonStatus === "ambiguous" ||
      observation.comparisonStatus === "legacy_only" ||
      observation.comparisonStatus === "shadow_only"
    ) {
      logger.warn(
        `[webhook] GitHub tenant comparison: ${observation.comparisonStatus} (resolution=${observation.resolutionStatus})`,
      );
    }
    if (observation.attemptCount > 1) {
      logger.info(
        `[webhook] GitHub delivery observed ${observation.attemptCount} times; telemetry remains observation-only`,
      );
    }
    if (observation.payloadHashCollision) {
      logger.warn(
        "[webhook] GitHub delivery ID payload collision detected; telemetry remains observation-only",
      );
    }
    return observation;
  } catch (error) {
    // Log only the error class. Prisma messages can contain query details, and
    // this boundary must never copy provider payload data into operational logs.
    const errorType = error instanceof Error ? error.name : "UnknownError";
    logger.warn(
      `[webhook] GitHub delivery observation failed; enforced routing continued (${errorType})`,
    );
    return null;
  }
}

/**
 * Delete expired delivery metadata. The window is intentionally short because
 * this is high-volume rollout telemetry, not a permanent audit log.
 */
export async function enforceWebhookDeliveryRetention(
  retentionDays?: number,
  store: WebhookDeliveryRetentionStore = prisma,
  logger: WebhookObservationLogger = console,
): Promise<number> {
  const days = resolveWebhookDeliveryRetentionDays(retentionDays);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await store.webhookDelivery.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });
  if (count > 0) {
    logger.info(
      `[webhook] Deleted ${count} delivery rows older than ${days} days`,
    );
  }
  return count;
}
