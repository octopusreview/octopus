import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));

const {
  compareWebhookTenantResolution,
  enforceWebhookDeliveryRetention,
  observeGithubWebhookDelivery,
  observeGithubWebhookDeliveryBestEffort,
  resolveGitlabWebhookIntegration,
  resolveGitlabWebhookTenant,
  resolveWebhookDeliveryRetentionDays,
  resolveGithubWebhookTenant,
} = await import("@/lib/webhook-tenant");

const PAYLOAD_SHA = "a".repeat(64);

function createStore() {
  const webhookDelivery = {
    upsert: mock(() =>
      Promise.resolve({ attemptCount: 1, payloadSha256: PAYLOAD_SHA }),
    ),
    update: mock(() =>
      Promise.resolve({ payloadHashCollisionCount: 1 }),
    ),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  };
  return {
    organization: {
      findUnique: mock(() => Promise.resolve({ id: "org_b" } as { id: string } | null)),
    },
    repository: {
      findUnique: mock(() =>
        Promise.resolve({ id: "repo_b", organizationId: "org_b" } as {
          id: string;
          organizationId: string;
        } | null),
      ),
      count: mock(() => Promise.resolve(1)),
    },
    webhookDelivery,
    $transaction: async <T>(
      callback: (transaction: { webhookDelivery: typeof webhookDelivery }) =>
        Promise<T>,
    ) => callback({ webhookDelivery }),
  };
}

function createGitlabStore() {
  return {
    gitlabIntegration: {
      findMany: mock(() =>
        Promise.resolve([
          { organizationId: "org_current", webhookSecret: "current-secret" },
        ]),
      ),
    },
    repository: {
      findUnique: mock(() =>
        Promise.resolve({
          id: "repo_current",
          organizationId: "org_current",
          autoReview: true,
          fullName: "current/project",
          isActive: true,
          dismissedAt: null,
        } as {
          id: string;
          organizationId: string;
          autoReview: boolean;
          fullName: string;
          isActive: boolean;
          dismissedAt: Date | null;
        } | null),
      ),
    },
  };
}

describe("resolveGithubWebhookTenant", () => {
  it("resolves a GitHub repository only inside the installation-owned organization", async () => {
    const store = createStore();

    const result = await resolveGithubWebhookTenant(
      {
        provider: "github",
        installationId: 222,
        repositoryExternalId: "9001",
      },
      store,
    );

    expect(result).toEqual({
      provider: "github",
      status: "resolved",
      organizationId: "org_b",
      repositoryId: "repo_b",
    });
    expect(store.organization.findUnique).toHaveBeenCalledWith({
      where: { githubInstallationId: 222 },
      select: { id: true },
    });
    expect(store.repository.findUnique).toHaveBeenCalledWith({
      where: {
        provider_externalId_organizationId: {
          provider: "github",
          externalId: "9001",
          organizationId: "org_b",
        },
      },
      select: { id: true, organizationId: true },
    });
  });

  it("never falls back to a repository-only lookup for an unmapped installation", async () => {
    const store = createStore();
    store.organization.findUnique.mockResolvedValue(null);

    const result = await resolveGithubWebhookTenant(
      {
        provider: "github",
        installationId: 999,
        repositoryExternalId: "9001",
      },
      store,
    );

    expect(result).toEqual({
      provider: "github",
      status: "unmapped_installation",
      organizationId: null,
      repositoryId: null,
    });
    expect(store.repository.findUnique).not.toHaveBeenCalled();
  });

  it("supports installation events that do not carry a repository", async () => {
    const store = createStore();

    const result = await resolveGithubWebhookTenant(
      { provider: "github", installationId: 222, repositoryExternalId: null },
      store,
    );

    expect(result).toEqual({
      provider: "github",
      status: "installation_only",
      organizationId: "org_b",
      repositoryId: null,
    });
    expect(store.repository.findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveGitlabWebhookTenant", () => {
  it("selects the organization by hook secret before the compound repository lookup", async () => {
    const store = createGitlabStore();

    const integration = await resolveGitlabWebhookIntegration(
      {
        provider: "gitlab",
        token: "current-secret",
      },
      store,
    );
    expect(integration).toEqual({
      provider: "gitlab",
      status: "resolved",
      organizationId: "org_current",
    });

    const result = await resolveGitlabWebhookTenant(
      {
        provider: "gitlab",
        organizationId: "org_current",
        repositoryExternalId: 9001,
      },
      store,
    );

    expect(result).toEqual({
      provider: "gitlab",
      status: "resolved",
      organizationId: "org_current",
      repository: {
        id: "repo_current",
        organizationId: "org_current",
        autoReview: true,
        fullName: "current/project",
        isActive: true,
        dismissedAt: null,
      },
    });
    expect(store.gitlabIntegration.findMany).toHaveBeenCalledWith({
      where: { webhookSecret: "current-secret" },
      select: { organizationId: true, webhookSecret: true },
      take: 2,
    });
    expect(store.repository.findUnique).toHaveBeenCalledWith({
      where: {
        provider_externalId_organizationId: {
          provider: "gitlab",
          externalId: "9001",
          organizationId: "org_current",
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
  });

  it("rejects unknown and duplicated hook secrets before repository access", async () => {
    const store = createGitlabStore();
    store.gitlabIntegration.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { organizationId: "org_a", webhookSecret: "shared-secret" },
        { organizationId: "org_b", webhookSecret: "shared-secret" },
      ]);

    await expect(
      resolveGitlabWebhookIntegration(
        { provider: "gitlab", token: "unknown" },
        store,
      ),
    ).resolves.toMatchObject({ status: "unmapped_token", organizationId: null });
    await expect(
      resolveGitlabWebhookIntegration(
        {
          provider: "gitlab",
          token: "shared-secret",
        },
        store,
      ),
    ).resolves.toMatchObject({ status: "ambiguous_token", organizationId: null });
    expect(store.repository.findUnique).not.toHaveBeenCalled();
  });

  it("requires the hook secret to match exactly", async () => {
    const store = createGitlabStore();
    store.gitlabIntegration.findMany.mockResolvedValue([]);

    await expect(
      resolveGitlabWebhookIntegration(
        {
          provider: "gitlab",
          token: " current-secret ",
        },
        store,
      ),
    ).resolves.toMatchObject({ status: "unmapped_token" });
    expect(store.gitlabIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { webhookSecret: " current-secret " } }),
    );
  });

  it("never falls back to another tenant when the authenticated organization does not own the project", async () => {
    const store = createGitlabStore();
    store.repository.findUnique.mockResolvedValue(null);

    const result = await resolveGitlabWebhookTenant(
      {
        provider: "gitlab",
        organizationId: "org_current",
        repositoryExternalId: 9001,
      },
      store,
    );

    expect(result).toMatchObject({
      status: "repository_not_owned",
      organizationId: "org_current",
      repository: null,
    });
  });

  it("rejects inactive or dismissed repositories", async () => {
    const store = createGitlabStore();
    store.repository.findUnique.mockResolvedValue({
      id: "repo_current",
      organizationId: "org_current",
      autoReview: true,
      fullName: "current/project",
      isActive: false,
      dismissedAt: new Date("2026-08-05T00:00:00Z"),
    });

    await expect(
      resolveGitlabWebhookTenant(
        {
          provider: "gitlab",
          organizationId: "org_current",
          repositoryExternalId: 9001,
        },
        store,
      ),
    ).resolves.toMatchObject({
      status: "repository_inactive",
      organizationId: "org_current",
      repository: null,
    });
  });
});

describe("compareWebhookTenantResolution", () => {
  it("reports a cross-tenant legacy selection without changing either result", () => {
    expect(
      compareWebhookTenantResolution(
        {
          provider: "github",
          status: "resolved",
          organizationId: "org_b",
          repositoryId: "repo_b",
        },
        { id: "repo_a", organizationId: "org_a" },
        1,
      ),
    ).toBe("mismatch");
  });

  it("reports duplicate tenant rows as ambiguous even if the legacy row happens to match", () => {
    expect(
      compareWebhookTenantResolution(
        {
          provider: "github",
          status: "resolved",
          organizationId: "org_b",
          repositoryId: "repo_b",
        },
        { id: "repo_b", organizationId: "org_b" },
        2,
      ),
    ).toBe("ambiguous");
  });
});

describe("observeGithubWebhookDelivery", () => {
  let store = createStore();

  beforeEach(() => {
    store = createStore();
  });

  it("records only bounded metadata and the trusted tenant resolution", async () => {
    store.repository.count.mockResolvedValue(2);

    const result = await observeGithubWebhookDelivery(
      {
        deliveryId: "delivery-123",
        eventType: "pull_request",
        action: "opened",
        payloadSha256: PAYLOAD_SHA,
        installationId: 222,
        repositoryExternalId: "9001",
        legacyRepository: { id: "repo_a", organizationId: "org_a" },
      },
      store,
    );

    expect(result).toEqual({
      recorded: true,
      attemptCount: 1,
      payloadHashCollision: false,
      resolutionStatus: "resolved",
      comparisonStatus: "ambiguous",
    });
    expect(store.webhookDelivery.upsert).toHaveBeenCalledTimes(1);
    const [{ create, update, where }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(where).toEqual({
      provider_deliveryId: { provider: "github", deliveryId: "delivery-123" },
    });
    expect(create).toMatchObject({
      provider: "github",
      deliveryId: "delivery-123",
      deliveryIdSource: "provider",
      eventType: "pull_request",
      action: "opened",
      payloadSha256: PAYLOAD_SHA,
      providerInstallationId: "222",
      providerRepositoryId: "9001",
      resolvedOrganizationId: "org_b",
      resolvedRepositoryId: "repo_b",
      legacyOrganizationId: "org_a",
      legacyRepositoryId: "repo_a",
      resolutionStatus: "resolved",
      comparisonStatus: "ambiguous",
      legacyCandidateCount: 2,
    });
    expect(create).not.toHaveProperty("payload");
    expect(create).not.toHaveProperty("signature");
    expect(update).toMatchObject({
      attemptCount: { increment: 1 },
    });
    expect(update).not.toHaveProperty("payloadSha256");
    expect(update).not.toHaveProperty("comparisonStatus");
  });

  it("uses the verified payload hash when GitHub omits its delivery id", async () => {
    await observeGithubWebhookDelivery(
      {
        deliveryId: null,
        eventType: "ping",
        action: null,
        payloadSha256: PAYLOAD_SHA,
        installationId: null,
        repositoryExternalId: null,
        legacyRepository: undefined,
      },
      store,
    );

    const [{ create, where }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(where.provider_deliveryId.deliveryId).toBe(`sha256:${PAYLOAD_SHA}`);
    expect(create.deliveryIdSource).toBe("payload_sha256");
  });

  it("skips the legacy collision query when the route did not perform a lookup", async () => {
    await observeGithubWebhookDelivery(
      {
        deliveryId: "delivery-no-legacy-lookup",
        eventType: "push",
        action: null,
        payloadSha256: PAYLOAD_SHA,
        installationId: 222,
        repositoryExternalId: "9001",
        legacyRepository: undefined,
      },
      store,
    );

    expect(store.repository.count).not.toHaveBeenCalled();
    const [{ create }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(create).toMatchObject({
      comparisonStatus: "not_applicable",
      legacyCandidateCount: 0,
    });
  });

  it("increments attempts for a duplicate without treating it as an enforcement decision", async () => {
    store.webhookDelivery.upsert.mockResolvedValue({
      attemptCount: 2,
      payloadSha256: PAYLOAD_SHA,
    });

    const result = await observeGithubWebhookDelivery(
      {
        deliveryId: "delivery-123",
        eventType: "pull_request",
        action: "opened",
        payloadSha256: PAYLOAD_SHA,
        installationId: 222,
        repositoryExternalId: "9001",
        legacyRepository: { id: "repo_b", organizationId: "org_b" },
      },
      store,
    );

    expect(result.recorded).toBe(true);
    expect(result.attemptCount).toBe(2);
    expect(result.payloadHashCollision).toBe(false);
    expect(store.webhookDelivery.update).not.toHaveBeenCalled();
    const [{ update }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(update.attemptCount).toEqual({ increment: 1 });
    expect(update).not.toHaveProperty("processingStatus");
  });

  it("preserves first evidence and flags a changed payload for the same delivery id", async () => {
    store.webhookDelivery.upsert.mockResolvedValue({
      attemptCount: 2,
      payloadSha256: PAYLOAD_SHA,
    });

    const result = await observeGithubWebhookDelivery(
      {
        deliveryId: "delivery-123",
        eventType: "pull_request",
        action: "synchronize",
        payloadSha256: "b".repeat(64),
        installationId: 333,
        repositoryExternalId: "9001",
        legacyRepository: { id: "repo_changed", organizationId: "org_changed" },
      },
      store,
    );

    const [{ update }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(update).toEqual({
      attemptCount: { increment: 1 },
      lastSeenAt: expect.any(Date),
    });
    expect(store.webhookDelivery.update).toHaveBeenCalledWith({
      where: {
        provider_deliveryId: {
          provider: "github",
          deliveryId: "delivery-123",
        },
      },
      data: { payloadHashCollisionCount: { increment: 1 } },
      select: { payloadHashCollisionCount: true },
    });
    expect(result.payloadHashCollision).toBe(true);
  });

  it("uses a tenant snapshot captured before an installation deletion", async () => {
    const tenantResolution = {
      provider: "github" as const,
      status: "installation_only" as const,
      organizationId: "org_b",
      repositoryId: null,
    };

    await observeGithubWebhookDelivery(
      {
        deliveryId: "delivery-uninstall",
        eventType: "installation",
        action: "deleted",
        payloadSha256: PAYLOAD_SHA,
        installationId: 222,
        repositoryExternalId: null,
        legacyRepository: undefined,
        tenantResolution,
      },
      store,
    );

    expect(store.organization.findUnique).not.toHaveBeenCalled();
    const [{ create }] = store.webhookDelivery.upsert.mock.calls[0];
    expect(create).toMatchObject({
      resolvedOrganizationId: "org_b",
      resolutionStatus: "installation_only",
      comparisonStatus: "not_applicable",
    });
  });

  it("keeps a ledger failure non-fatal and logs no database error details", async () => {
    store.webhookDelivery.upsert.mockRejectedValueOnce(
      new Error("query failed with sensitive detail"),
    );
    const logger = {
      info: mock((_message: string) => undefined),
      warn: mock((_message: string) => undefined),
    };

    const result = await observeGithubWebhookDeliveryBestEffort(
      {
        deliveryId: "delivery-123",
        eventType: "pull_request",
        action: "opened",
        payloadSha256: PAYLOAD_SHA,
        installationId: 222,
        repositoryExternalId: "9001",
        legacyRepository: { id: "repo_b", organizationId: "org_b" },
      },
      store,
      logger,
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "[webhook] GitHub delivery observation failed; enforced routing continued (Error)",
    );
    expect(logger.warn.mock.calls[0]?.[0]).not.toContain("sensitive detail");
  });
});

describe("GitHub webhook boundary wiring", () => {
  it("keeps the installation tenant authority unique in the Prisma schema", async () => {
    const schema = await Bun.file(
      new URL("../../../../packages/db/prisma/schema.prisma", import.meta.url),
    ).text();

    expect(schema).toMatch(/githubInstallationId\s+Int\?\s+@unique\b/);
  });

  it("registers trusted observation only after signature verification", async () => {
    const routeSource = await Bun.file(
      new URL("../../app/api/github/webhook/route.ts", import.meta.url),
    ).text();
    const signatureGuard = routeSource.indexOf(
      "if (!(await verifySignature(body, signature)))",
    );
    const payloadParse = routeSource.indexOf("const payload = JSON.parse(body)");
    const observationCall = routeSource.indexOf(
      "observeGithubWebhookDeliveryBestEffort({",
      payloadParse,
    );

    expect(signatureGuard).toBeGreaterThan(-1);
    expect(payloadParse).toBeGreaterThan(signatureGuard);
    expect(observationCall).toBeGreaterThan(payloadParse);
  });

  it("validates delivery retention before queue startup", async () => {
    const instrumentationSource = await Bun.file(
      new URL("../../instrumentation.ts", import.meta.url),
    ).text();
    const validationCall = instrumentationSource.indexOf(
      "resolveWebhookDeliveryRetentionDays();",
    );
    const queueStart = instrumentationSource.indexOf("await startQueue()");

    expect(validationCall).toBeGreaterThan(-1);
    expect(queueStart).toBeGreaterThan(validationCall);
  });
});

describe("enforceWebhookDeliveryRetention", () => {
  it("defaults an unset retention window to 30 days", () => {
    const previous = process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;

    try {
      delete process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;
      expect(resolveWebhookDeliveryRetentionDays()).toBe(30);
    } finally {
      if (previous !== undefined) {
        process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = previous;
      }
    }
  });

  it("deletes rows whose last delivery attempt is outside the window", async () => {
    const store = createStore();
    store.webhookDelivery.deleteMany.mockResolvedValue({ count: 4 });
    const before = Date.now();

    const deleted = await enforceWebhookDeliveryRetention(30, store);

    const after = Date.now();
    expect(deleted).toBe(4);
    const [{ where }] = store.webhookDelivery.deleteMany.mock.calls[0];
    const cutoff = where.lastSeenAt.lt.getTime();
    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - retentionMs);
    expect(cutoff).toBeLessThanOrEqual(after - retentionMs);
  });

  it("fails fast for invalid environment retention windows", async () => {
    const store = createStore();
    const previous = process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;

    try {
      for (const invalidValue of ["0", "366", "not-a-number"]) {
        process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = invalidValue;
        await expect(
          enforceWebhookDeliveryRetention(undefined, store),
        ).rejects.toThrow(
          "Invalid webhook delivery retention window; expected an integer from 1 to 365 days",
        );
      }
      expect(store.webhookDelivery.deleteMany).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;
      } else {
        process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = previous;
      }
    }
  });

  it("accepts the maximum environment retention window", async () => {
    const store = createStore();
    const previous = process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;

    try {
      process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = "365";
      await expect(
        enforceWebhookDeliveryRetention(undefined, store),
      ).resolves.toBe(0);
      expect(store.webhookDelivery.deleteMany).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) {
        delete process.env.WEBHOOK_DELIVERY_RETENTION_DAYS;
      } else {
        process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = previous;
      }
    }
  });
});
