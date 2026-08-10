import { beforeEach, describe, expect, it, mock } from "bun:test";

type OrgState = {
  creditBalance: number;
  freeCreditBalance: number;
};

let orgState: OrgState;
let createdTransactions: unknown[];
let currentEvent: unknown;
let shouldRejectSignature = false;

let mockFindUniqueOrThrow = mock(() =>
  Promise.resolve({
    creditBalance: orgState.creditBalance,
    freeCreditBalance: orgState.freeCreditBalance,
  }),
);
let mockTxQueryRaw = mock(() =>
  Promise.resolve([
    {
      creditBalance: orgState.creditBalance,
      freeCreditBalance: orgState.freeCreditBalance,
    },
  ]),
);
let mockTxOrganizationUpdate = mock(
  ({ data }: { data: Partial<OrgState> & { creditBalance?: { increment: number }; freeCreditBalance?: { increment: number } } }) => {
    if (typeof data.creditBalance === "object" && "increment" in data.creditBalance) {
      orgState.creditBalance += data.creditBalance.increment;
    } else if (typeof data.creditBalance === "number") {
      orgState.creditBalance = data.creditBalance;
    }

    if (typeof data.freeCreditBalance === "object" && "increment" in data.freeCreditBalance) {
      orgState.freeCreditBalance += data.freeCreditBalance.increment;
    } else if (typeof data.freeCreditBalance === "number") {
      orgState.freeCreditBalance = data.freeCreditBalance;
    }

    return Promise.resolve({
      creditBalance: orgState.creditBalance,
      freeCreditBalance: orgState.freeCreditBalance,
    });
  },
);
let mockTxCreditTransactionCreate = mock(({ data }: { data: unknown }) => {
  createdTransactions.push(data);
  return Promise.resolve(data);
});
let mockCreditAggregate = mock(() =>
  Promise.resolve({
    _sum: { amount: 0 },
  }),
);
let mockCreditTransactionFindFirst = mock(() => Promise.resolve(null));
let mockCreditTransactionUpdate = mock(() => Promise.resolve());
let mockAutoReloadConfigFindUnique = mock(() => Promise.resolve(null));
let mockAutoReloadConfigUpsert = mock(({ create }: { create: unknown }) =>
  Promise.resolve(create),
);
let mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(null));
let mockAutoReloadAttemptFindFirst = mock(() => Promise.resolve(null));
let mockAutoReloadAttemptFindMany = mock(() => Promise.resolve([] as unknown[]));
let mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) =>
  Promise.resolve({ stripePaymentIntentId: null, ...data }),
);
let mockAutoReloadAttemptUpdateMany = mock(() => Promise.resolve({ count: 1 }));
let mockAutoReloadAttemptCount = mock(() => Promise.resolve(1));

async function mockAutoReloadAttemptCreateMany(
  args: { data: Record<string, unknown>; skipDuplicates?: boolean },
) {
  try {
    await mockAutoReloadAttemptCreate({ data: args.data });
    return { count: 1 };
  } catch (err) {
    if (args.skipDuplicates && (err as { code?: unknown } | null)?.code === "P2002") {
      return { count: 0 };
    }
    throw err;
  }
}
let mockOrganizationFindUnique = mock(() => Promise.resolve(null));
let mockOrganizationFindMany = mock(() => Promise.resolve([] as unknown[]));
let createdAiUsage: Array<{ id: string; usedOwnKey: boolean; chargedCostUsd: number | null }>;
let mockAvailableModelFindMany = mock(() =>
  Promise.resolve([{ modelId: "m", inputPrice: 10, outputPrice: 10 }] as unknown[]),
);
let mockOrganizationUpdate = mock((args: unknown) => {
  organizationUpdates.push(args);
  return Promise.resolve({});
});
let organizationUpdates: unknown[];

let mockConstructWebhookEvent = mock(() => currentEvent);
let mockChargesList = mock(() =>
  Promise.resolve({ data: [{ receipt_url: "https://stripe.test/receipt" }] }),
);
let mockCheckoutSessionsList = mock(() =>
  Promise.resolve({
    data: [{ metadata: { orgId: "org_1" } }],
  }),
);
let mockPaymentIntentsCreate = mock(() =>
  Promise.resolve({ status: "succeeded", latest_charge: null }),
);
let mockPaymentIntentsRetrieve = mock(() =>
  Promise.resolve({ status: "succeeded", latest_charge: null }),
);
let mockPaymentIntentsCancel = mock(() =>
  Promise.resolve({ status: "canceled", latest_charge: null }),
);
let mockChargesRetrieve = mock(() => Promise.resolve({ receipt_url: null }));

type StubRefund = { id: string; amount: number; status: string };
// The route auto-paginates refunds via `for await (... of stripe.refunds.list())`,
// so the stub must be async-iterable (mirrors the SDK's ApiListPromise).
function asyncRefundList(items: StubRefund[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}
let mockRefundsList = mock(() => asyncRefundList([]));

function asyncPaymentIntentList(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}
let mockPaymentIntentsList = mock(() => asyncPaymentIntentList([]));

mock.module("@octopus/db", () => ({
  prisma: {
    organization: {
      findUniqueOrThrow: (...args: unknown[]) => mockFindUniqueOrThrow(...args),
      findUnique: (...args: unknown[]) => mockOrganizationFindUnique(...args),
      findMany: (...args: unknown[]) => mockOrganizationFindMany(...args),
      update: (...args: unknown[]) => mockOrganizationUpdate(...args),
    },
    creditTransaction: {
      aggregate: (...args: unknown[]) => mockCreditAggregate(...args),
      findFirst: (...args: unknown[]) => mockCreditTransactionFindFirst(...args),
      update: (...args: unknown[]) => mockCreditTransactionUpdate(...args),
    },
    autoReloadConfig: {
      findUnique: (...args: unknown[]) => mockAutoReloadConfigFindUnique(...args),
      upsert: (...args: unknown[]) => mockAutoReloadConfigUpsert(...args as never),
    },
    autoReloadAttempt: {
      findUnique: (...args: unknown[]) => mockAutoReloadAttemptFindUnique(...args),
      findFirst: (...args: unknown[]) => mockAutoReloadAttemptFindFirst(...args),
      findMany: (...args: unknown[]) => mockAutoReloadAttemptFindMany(...args),
      create: (...args: unknown[]) => mockAutoReloadAttemptCreate(...args),
      createMany: (...args: unknown[]) => mockAutoReloadAttemptCreateMany(...args as never),
      updateMany: (...args: unknown[]) => mockAutoReloadAttemptUpdateMany(...args),
      count: (...args: unknown[]) => mockAutoReloadAttemptCount(...args),
    },
    aiUsage: {
      create: ({ data }: { data: { usedOwnKey: boolean } }) => {
        const row = { id: "ai_1", chargedCostUsd: null as number | null, ...data };
        createdAiUsage.push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: { chargedCostUsd: number } }) => {
        const row = createdAiUsage.find((u) => (u as { id: string }).id === where.id);
        if (row) row.chargedCostUsd = data.chargedCostUsd;
        return Promise.resolve(row);
      },
    },
    availableModel: {
      findMany: (...args: unknown[]) => mockAvailableModelFindMany(...args),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { ...orgState };
      try {
        return await callback({
          $queryRaw: (...args: unknown[]) => mockTxQueryRaw(...args),
          organization: {
            findUnique: (...args: unknown[]) => mockOrganizationFindUnique(...args),
            update: (...args: unknown[]) => mockTxOrganizationUpdate(...args),
          },
          creditTransaction: {
            create: (...args: unknown[]) => mockTxCreditTransactionCreate(...args),
          },
          autoReloadConfig: {
            findUnique: (...args: unknown[]) => mockAutoReloadConfigFindUnique(...args),
            upsert: (...args: unknown[]) => mockAutoReloadConfigUpsert(...args as never),
          },
          autoReloadAttempt: {
            findUnique: (...args: unknown[]) => mockAutoReloadAttemptFindUnique(...args),
            create: (...args: unknown[]) => mockAutoReloadAttemptCreate(...args),
            createMany: (...args: unknown[]) => mockAutoReloadAttemptCreateMany(...args as never),
            updateMany: (...args: unknown[]) => mockAutoReloadAttemptUpdateMany(...args),
            count: (...args: unknown[]) => mockAutoReloadAttemptCount(...args),
          },
        });
      } catch (err) {
        // Simulate transactional rollback so idempotency tests can assert the
        // balance is unchanged when the ledger insert hits a UNIQUE violation.
        orgState = snapshot;
        throw err;
      }
    },
  },
}));

let mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_default" as string | null));

// Capture emitted events; mocking the bus also stops the real observers (which
// hit prisma methods this harness doesn't stub) from registering on import.
let emittedEvents: Array<{ type: string; [k: string]: unknown }> = [];
mock.module("@/lib/events/bus", () => ({
  eventBus: {
    emit: (e: { type: string }) => emittedEvents.push(e as never),
    on: () => {},
    off: () => {},
  },
}));

mock.module("@/lib/stripe", () => ({
  constructWebhookEvent: (...args: unknown[]) => mockConstructWebhookEvent(...args),
  getOffSessionPaymentMethodId: (...args: unknown[]) => mockOffSessionPaymentMethodId(...args),
  getStripe: () => ({
    charges: {
      list: (...args: unknown[]) => mockChargesList(...args),
      retrieve: (...args: unknown[]) => mockChargesRetrieve(...args),
    },
    checkout: {
      sessions: {
        list: (...args: unknown[]) => mockCheckoutSessionsList(...args),
      },
    },
    refunds: {
      list: (...args: unknown[]) => mockRefundsList(...args),
    },
    paymentIntents: {
      create: (...args: unknown[]) => mockPaymentIntentsCreate(...args),
      retrieve: (...args: unknown[]) => mockPaymentIntentsRetrieve(...args),
      cancel: (...args: unknown[]) => mockPaymentIntentsCancel(...args),
      list: (...args: unknown[]) => mockPaymentIntentsList(...args),
    },
  }),
}));

mock.module("server-only", () => ({}));

const {
  addCredits,
  addFreeCredits,
  deductCredits,
  getOrgBalance,
  chargeCreditsOffSession,
  rearmAutoReloadAfterPaymentMethodChange,
  reconcileAutoReloadAttempts,
  triggerAutoReloadIfNeeded,
  updateAutoReloadConfigDurably,
} = await import("@/lib/credits");
const { POST } = await import("@/app/api/stripe/webhook/route");
const { addOneMonth, renewDueSubscriptions } = await import("@/lib/subscription");
const { volumeBonusUsd } = await import("@/lib/plans");
const { logAiUsage } = await import("@/lib/ai-usage");

function resetBillingMocks() {
  orgState = { creditBalance: 20, freeCreditBalance: 8 };
  createdTransactions = [];
  emittedEvents = [];
  currentEvent = { type: "unhandled.event", data: { object: {} } };
  shouldRejectSignature = false;

  mockFindUniqueOrThrow = mock(() =>
    Promise.resolve({
      creditBalance: orgState.creditBalance,
      freeCreditBalance: orgState.freeCreditBalance,
    }),
  );
  mockTxQueryRaw = mock(() =>
    Promise.resolve([
      {
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      },
    ]),
  );
  mockTxOrganizationUpdate = mock(
    ({ data }: { data: Partial<OrgState> & { creditBalance?: { increment: number }; freeCreditBalance?: { increment: number } } }) => {
      if (typeof data.creditBalance === "object" && "increment" in data.creditBalance) {
        orgState.creditBalance += data.creditBalance.increment;
      } else if (typeof data.creditBalance === "number") {
        orgState.creditBalance = data.creditBalance;
      }

      if (typeof data.freeCreditBalance === "object" && "increment" in data.freeCreditBalance) {
        orgState.freeCreditBalance += data.freeCreditBalance.increment;
      } else if (typeof data.freeCreditBalance === "number") {
        orgState.freeCreditBalance = data.freeCreditBalance;
      }

      return Promise.resolve({
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      });
    },
  );
  mockTxCreditTransactionCreate = mock(({ data }: { data: unknown }) => {
    createdTransactions.push(data);
    return Promise.resolve(data);
  });
  mockCreditAggregate = mock(() =>
    Promise.resolve({
      _sum: { amount: 0 },
    }),
  );
  mockCreditTransactionFindFirst = mock(() => Promise.resolve(null));
  mockCreditTransactionUpdate = mock(() => Promise.resolve());
  mockAutoReloadConfigFindUnique = mock(() => Promise.resolve(null));
  mockAutoReloadConfigUpsert = mock(({ create }: { create: unknown }) =>
    Promise.resolve(create),
  );
  mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(null));
  mockAutoReloadAttemptFindFirst = mock(() => Promise.resolve(null));
  mockAutoReloadAttemptFindMany = mock(() => Promise.resolve([] as unknown[]));
  mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ stripePaymentIntentId: null, ...data }),
  );
  mockAutoReloadAttemptUpdateMany = mock(() => Promise.resolve({ count: 1 }));
  mockAutoReloadAttemptCount = mock(() => Promise.resolve(1));
  mockOrganizationFindUnique = mock(() => Promise.resolve(null));
  organizationUpdates = [];
  createdAiUsage = [];
  mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_default" as string | null));
  mockOrganizationFindMany = mock(() => Promise.resolve([] as unknown[]));
  mockAvailableModelFindMany = mock(() =>
    Promise.resolve([{ modelId: "m", inputPrice: 10, outputPrice: 10 }] as unknown[]),
  );
  mockOrganizationUpdate = mock((args: unknown) => {
    organizationUpdates.push(args);
    return Promise.resolve({});
  });

  mockConstructWebhookEvent = mock((body: string, signature: string) => {
    expect(body).toBe("{}");
    expect(signature).toBe("sig_test");
    if (shouldRejectSignature) throw new Error("bad signature");
    return currentEvent;
  });
  mockChargesList = mock(() =>
    Promise.resolve({ data: [{ receipt_url: "https://stripe.test/receipt" }] }),
  );
  mockCheckoutSessionsList = mock(() =>
    Promise.resolve({
      data: [{ metadata: { orgId: "org_1" } }],
    }),
  );
  mockPaymentIntentsCreate = mock(() =>
    Promise.resolve({ status: "succeeded", latest_charge: null }),
  );
  mockPaymentIntentsRetrieve = mock(() =>
    Promise.resolve({ status: "succeeded", latest_charge: null }),
  );
  mockPaymentIntentsCancel = mock(() =>
    Promise.resolve({ status: "canceled", latest_charge: null }),
  );
  mockPaymentIntentsList = mock(() => asyncPaymentIntentList([]));
  mockChargesRetrieve = mock(() => Promise.resolve({ receipt_url: null }));
  mockRefundsList = mock(() => asyncRefundList([]));
}

function stripeRequest(body = "{}") {
  return new Request("https://octopus.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
    body,
  });
}

function succeededIntentFromCreateParams(
  params: Record<string, unknown>,
  id: string,
) {
  return {
    ...params,
    id,
    status: "succeeded",
    amount_received: params.amount,
    latest_charge: null,
  };
}

beforeEach(() => {
  resetBillingMocks();
});

describe("credits ledger", () => {
  it("returns free, purchased, and total balances", async () => {
    await expect(getOrgBalance("org_1")).resolves.toEqual({
      free: 8,
      purchased: 20,
      total: 28,
    });
  });

  it("adds purchased credits and records the combined balance", async () => {
    await addCredits("org_1", 15, "purchase", "Stripe top-up", "cs_123");

    expect(orgState).toEqual({ creditBalance: 35, freeCreditBalance: 8 });
    expect(createdTransactions).toEqual([
      {
        amount: 15,
        type: "purchase",
        description: "Stripe top-up",
        stripeSessionId: "cs_123",
        balanceAfter: 43,
        organizationId: "org_1",
      },
    ]);
  });

  it("adds free credits without touching the purchased balance", async () => {
    await addFreeCredits("org_1", 5, "Welcome credits");

    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 13 });
    expect(createdTransactions).toEqual([
      {
        amount: 5,
        type: "free_credit",
        description: "Welcome credits",
        balanceAfter: 33,
        organizationId: "org_1",
      },
    ]);
  });

  it("deducts free credits before purchased credits and records exact balance math", async () => {
    await deductCredits("org_1", 12, "Review run");

    expect(mockTxQueryRaw).toHaveBeenCalledTimes(1);
    expect(orgState).toEqual({ creditBalance: 16, freeCreditBalance: 0 });
    expect(createdTransactions).toEqual([
      {
        amount: -12,
        type: "usage",
        description: "Review run",
        balanceAfter: 16,
        organizationId: "org_1",
      },
    ]);
  });

  it("does not create ledger rows for zero or negative deductions", async () => {
    await deductCredits("org_1", 0, "noop");
    await deductCredits("org_1", -1, "noop");

    expect(mockTxQueryRaw).not.toHaveBeenCalled();
    expect(mockTxOrganizationUpdate).not.toHaveBeenCalled();
    expect(mockTxCreditTransactionCreate).not.toHaveBeenCalled();
  });

  it("records a truthful negative balance when usage exceeds the balance (post-paid)", async () => {
    // free 8 + purchased 20 = 28; a $30 deduction (tokens already spent) must
    // record the real overage, not clamp to zero.
    await deductCredits("org_1", 30, "Expensive review");

    expect(orgState).toEqual({ creditBalance: -2, freeCreditBalance: 0 });
    expect(createdTransactions).toEqual([
      {
        amount: -30,
        type: "usage",
        description: "Expensive review",
        balanceAfter: -2,
        organizationId: "org_1",
      },
    ]);
  });
});

describe("auto-reload failure notification", () => {
  it("emits auto-reload-failed when the reload charge is declined", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({
        enabled: true,
        thresholdAmount: 25,
        reloadAmount: 50,
      } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    const declined = new Error("Your card was declined.") as Error & {
      code: string;
      type: string;
    };
    declined.code = "card_declined";
    declined.type = "StripeCardError";
    mockPaymentIntentsCreate = mock(() => Promise.reject(declined));

    // Deduct into the auto-reload threshold; the fire-and-forget reload runs.
    await deductCredits("org_1", 6, "Review run");
    // Let the fire-and-forget triggerAutoReloadIfNeeded settle.
    await new Promise((r) => setTimeout(r, 0));

    const failed = emittedEvents.find((e) => e.type === "auto-reload-failed");
    expect(failed).toBeTruthy();
    expect(failed).toMatchObject({
      type: "auto-reload-failed",
      orgId: "org_1",
      reloadAmount: 50,
      reason: "card_declined",
    });
  });

  it("persists the exact Stripe parameters and reuses the stored idempotency key", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({
        enabled: true,
        thresholdAmount: 25,
        reloadAmount: 50,
      } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    let persisted: Record<string, unknown> | undefined;
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      persisted = data;
      return Promise.resolve({ stripePaymentIntentId: null, ...data });
    });
    let seenParams: Record<string, unknown> | undefined;
    let seenOpts: { idempotencyKey?: string } | undefined;
    mockPaymentIntentsCreate = mock((params: unknown, opts: unknown) => {
      seenParams = params as Record<string, unknown>;
      seenOpts = opts as { idempotencyKey?: string };
      return Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_auto_1") as never,
      );
    });

    await deductCredits("org_1", 6, "Review run");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persisted).toMatchObject({
      organizationId: "org_1",
      activeOrganizationId: "org_1",
      status: "initializing",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: null,
      leaseExpiresAt: expect.any(Date),
      retryUntil: expect.any(Date),
    });
    expect(persisted?.idempotencyKey).toMatch(/^auto-reload-[0-9a-f-]+$/);
    expect(seenOpts?.idempotencyKey).toBe(persisted?.idempotencyKey);
    expect(seenParams).toMatchObject({
      amount: 5000,
      customer: "cus_1",
      payment_method: "pm_1",
      metadata: {
        autoReloadAttemptId: persisted?.id,
        autoReloadKey: persisted?.idempotencyKey,
      },
    });
    expect(
      createdTransactions.filter((row) => (row as { type: string }).type === "auto_reload"),
    ).toHaveLength(1);
  });

  it.each([
    ["non-finite threshold", Number.NaN, 50],
    ["threshold below minimum", 0, 50],
    ["threshold above maximum", 1001, 1000],
    ["non-finite reload", 10, Number.POSITIVE_INFINITY],
    ["reload below minimum", 10, 4],
    ["reload above maximum", 10, 1001],
  ] as const)(
    "refuses to create an attempt for a legacy config with %s",
    async (_case, thresholdAmount, reloadAmount) => {
      mockAutoReloadConfigFindUnique = mock(() =>
        Promise.resolve({ enabled: true, thresholdAmount, reloadAmount } as never),
      );

      await triggerAutoReloadIfNeeded("org_1", 0);

      expect(mockOrganizationFindUnique).not.toHaveBeenCalled();
      expect(mockAutoReloadAttemptCreate).not.toHaveBeenCalled();
      expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    },
  );

  it("accepts a reload amount below the threshold", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 100, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1", creditBalance: 0, freeCreditBalance: 0 } as never),
    );
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_threshold") as never,
      ),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent worker to create the reload PaymentIntent", async () => {
    const config = { enabled: true, thresholdAmount: 30, reloadAmount: 50 };
    mockAutoReloadConfigFindUnique = mock(() => Promise.resolve(config as never));
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    let releaseFirst: (() => void) | undefined;
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      if (!releaseFirst) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ stripePaymentIntentId: null, ...data });
        });
      }
      releaseFirst();
      return Promise.reject(Object.assign(new Error("active attempt exists"), { code: "P2002" }));
    });
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_auto_once") as never,
      ),
    );

    await Promise.all([
      triggerAutoReloadIfNeeded("org_1", 0),
      triggerAutoReloadIfNeeded("org_1", 0),
    ]);

    expect(mockAutoReloadAttemptCreate).toHaveBeenCalledTimes(2);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
  });

  it("retries an unknown Stripe outcome with the persisted parameters after config changes", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      // A bad config edit must not change or discard an already-persisted
      // attempt; retrying its stable Stripe request remains safe.
      Promise.resolve({ enabled: true, thresholdAmount: 0, reloadAmount: 5000 } as never),
    );
    const attempt = {
      id: "attempt_1",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-stable-key",
      amountCents: 5000,
      stripeCustomerId: "cus_original",
      stripePaymentMethodId: "pm_original",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: null,
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    let seenParams: Record<string, unknown> | undefined;
    let seenOpts: Record<string, unknown> | undefined;
    const unknown = Object.assign(new Error("socket closed"), {
      type: "StripeConnectionError",
    });
    mockPaymentIntentsCreate = mock((params: unknown, opts: unknown) => {
      seenParams = params as Record<string, unknown>;
      seenOpts = opts as Record<string, unknown>;
      return Promise.reject(unknown);
    });

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(seenParams).toMatchObject({
      amount: 5000,
      customer: "cus_original",
      payment_method: "pm_original",
      metadata: {
        autoReloadAttemptId: "attempt_1",
        autoReloadKey: "auto-reload-stable-key",
      },
    });
    expect(seenOpts).toEqual({ idempotencyKey: "auto-reload-stable-key" });
    expect(mockOrganizationFindUnique).not.toHaveBeenCalled();
    expect(mockOffSessionPaymentMethodId).not.toHaveBeenCalled();
    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: "attempt_1",
        activeOrganizationId: "org_1",
        idempotencyKey: "auto-reload-stable-key",
        status: "submitting",
      },
      data: {
        status: "uncertain",
        leaseExpiresAt: expect.any(Date),
        failureReason: "payment_status_unknown",
      },
    });
  });

  it("keeps an idempotency conflict uncertain and active without a false failure notice", async () => {
    const attempt = {
      id: "attempt_idempotency",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-idempotency",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: null,
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsCreate = mock(() =>
      Promise.reject(Object.assign(new Error("key is currently in use"), {
        type: "StripeInvalidRequestError",
        code: "idempotency_key_in_use",
      })),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: attempt.id,
        activeOrganizationId: "org_1",
        idempotencyKey: attempt.idempotencyKey,
        status: "submitting",
      },
      data: {
        status: "uncertain",
        leaseExpiresAt: expect.any(Date),
        failureReason: "payment_status_unknown",
      },
    });
    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
  });

  it("persists a processing PaymentIntent as active instead of failing it", async () => {
    const attempt = {
      id: "attempt_processing",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-processing",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: null,
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve({
        ...(params as Record<string, unknown>),
        id: "pi_processing",
        status: "processing",
        amount_received: 0,
        latest_charge: null,
      } as never),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: attempt.id,
        organizationId: "org_1",
        idempotencyKey: attempt.idempotencyKey,
        activeOrganizationId: "org_1",
        status: { in: ["submitting", "processing", "uncertain"] },
        OR: [
          { stripePaymentIntentId: null },
          { stripePaymentIntentId: "pi_processing" },
        ],
      },
      data: {
        status: "processing",
        stripePaymentIntentId: "pi_processing",
        failureReason: null,
        leaseExpiresAt: expect.any(Date),
      },
    });
    expect(createdTransactions.some((row) => (row as { type: string }).type === "auto_reload")).toBe(false);
    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
  });

  it("retrieves a persisted processing PI and grants only after Stripe reports success", async () => {
    const attempt = {
      id: "attempt_processing_reconcile",
      organizationId: "org_1",
      status: "processing",
      idempotencyKey: "auto-reload-processing-reconcile",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: "pi_processing_reconcile",
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      failureReason: null,
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsRetrieve = mock(() =>
      Promise.resolve({
        id: attempt.stripePaymentIntentId,
        status: "succeeded",
        currency: "usd",
        amount: 5000,
        amount_received: 5000,
        customer: "cus_1",
        payment_method: "pm_1",
        latest_charge: null,
        metadata: {
          orgId: "org_1",
          type: "auto_reload",
          autoReloadAttemptId: attempt.id,
          autoReloadKey: attempt.idempotencyKey,
        },
      } as never),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_processing_reconcile");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(createdTransactions.some((row) => (row as { type: string }).type === "auto_reload")).toBe(true);
  });

  it("cancels a blocked nonterminal PI before marking the attempt failed", async () => {
    const attempt = {
      id: "attempt_requires_action",
      organizationId: "org_1",
      status: "processing",
      idempotencyKey: "auto-reload-requires-action",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: "pi_requires_action",
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      failureReason: null,
    };
    const intent = {
      id: attempt.stripePaymentIntentId,
      status: "requires_action",
      currency: "usd",
      amount: 5000,
      amount_received: 0,
      customer: "cus_1",
      payment_method: "pm_1",
      latest_charge: null,
      metadata: {
        orgId: "org_1",
        type: "auto_reload",
        autoReloadAttemptId: attempt.id,
        autoReloadKey: attempt.idempotencyKey,
      },
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsRetrieve = mock(() => Promise.resolve(intent as never));
    mockPaymentIntentsCancel = mock(() =>
      Promise.resolve({ ...intent, status: "canceled" } as never),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockPaymentIntentsCancel).toHaveBeenCalledWith("pi_requires_action");
    expect(emittedEvents).toContainEqual({
      type: "auto-reload-failed",
      orgId: "org_1",
      reloadAmount: 50,
      remainingBalance: 0,
      reason: "canceled",
    });
  });

  it("lists Stripe customer intents before retrying an uncertain attempt", async () => {
    const submittedAt = new Date(Date.now() - 60_000);
    const attempt = {
      id: "attempt_uncertain",
      organizationId: "org_1",
      status: "uncertain",
      idempotencyKey: "auto-reload-uncertain",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      lastSubmittedAt: submittedAt,
      createdAt: new Date(submittedAt.getTime() - 60_000),
      failureReason: "payment_status_unknown",
    };
    const order: string[] = [];
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsList = mock(() => {
      order.push("list");
      return asyncPaymentIntentList([]);
    });
    mockPaymentIntentsCreate = mock((params: unknown) => {
      order.push("create");
      return Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_after_list") as never,
      );
    });

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(order).toEqual(["list", "create"]);
    expect(mockPaymentIntentsList).toHaveBeenCalledWith({
      customer: "cus_1",
      created: { gte: expect.any(Number) },
      limit: 100,
    });
  });

  it("lists Stripe customer intents before releasing a settled uncertain attempt", async () => {
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const attempt = {
      id: "attempt_expired_uncertain",
      organizationId: "org_1",
      status: "uncertain",
      idempotencyKey: "auto-reload-expired-uncertain",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(0),
      lastSubmittedAt: submittedAt,
      createdAt: new Date(submittedAt.getTime() - 60_000),
      failureReason: "payment_status_unknown",
    };
    let reads = 0;
    mockAutoReloadAttemptFindUnique = mock(() =>
      Promise.resolve((reads++ === 0 ? attempt : null) as never),
    );
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: false, thresholdAmount: 25, reloadAmount: 50 } as never),
    );
    const order: string[] = [];
    mockPaymentIntentsList = mock(() => {
      order.push("list");
      return asyncPaymentIntentList([]);
    });
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      if ((args as { data?: { activeOrganizationId?: unknown } }).data?.activeOrganizationId === null) {
        order.push("release");
      }
      return Promise.resolve({ count: 1 });
    });

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(order).toEqual(["list", "release"]);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("does not release a recently submitted uncertain attempt when Stripe lists no PI yet", async () => {
    const submittedAt = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = {
      id: "attempt_recent_uncertain",
      organizationId: "org_1",
      status: "uncertain",
      idempotencyKey: "auto-reload-recent-uncertain",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(0),
      lastSubmittedAt: submittedAt,
      createdAt: new Date(submittedAt.getTime() - 60_000),
      failureReason: "payment_status_unknown",
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsList = mock(() => asyncPaymentIntentList([]));

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: attempt.id,
        activeOrganizationId: "org_1",
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["submitting", "processing", "uncertain"] },
        stripePaymentIntentId: null,
      },
      data: {
        status: "uncertain",
        failureReason: "awaiting_stripe_settlement",
        leaseExpiresAt: expect.any(Date),
      },
    });
    expect(
      mockAutoReloadAttemptUpdateMany.mock.calls.some(
        ([args]) => (args as { data?: { activeOrganizationId?: unknown } }).data
          ?.activeOrganizationId === null,
      ),
    ).toBe(false);
  });

  it("commits the durable claim before deduction returns and does not await Stripe I/O", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 25, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );

    let persistedData: Record<string, unknown> | undefined;
    let resolveClaim!: (value: unknown) => void;
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      persistedData = data;
      return new Promise((resolve) => {
        resolveClaim = resolve;
      });
    });
    let resolvePaymentMethod!: (value: string | null) => void;
    mockOffSessionPaymentMethodId = mock(() =>
      new Promise((resolve) => {
        resolvePaymentMethod = resolve;
      }),
    );

    let settled = false;
    const deduction = deductCredits("org_1", 6, "Review run").then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAutoReloadAttemptCreate).toHaveBeenCalledTimes(1);
    expect(mockOffSessionPaymentMethodId).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    resolveClaim({ stripePaymentIntentId: null, ...persistedData });
    await deduction;

    expect(settled).toBe(true);
    expect(mockOffSessionPaymentMethodId).toHaveBeenCalledTimes(1);
    resolvePaymentMethod(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("does not create durable or Stripe work for a disabled configuration", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: false, thresholdAmount: 25, reloadAmount: 50 } as never),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockAutoReloadAttemptCreate).not.toHaveBeenCalled();
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("atomically saves enable-at-zero with its first durable attempt", async () => {
    orgState = { creditBalance: 0, freeCreditBalance: 0 };
    const order: string[] = [];
    let enabled = false;
    mockAutoReloadConfigUpsert = mock(({ create }: { create: { enabled: boolean } }) => {
      enabled = create.enabled;
      order.push("config");
      return Promise.resolve(create);
    });
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve(
        enabled
          ? { enabled: true, thresholdAmount: 10, reloadAmount: 50 }
          : null,
      ) as never,
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: 0,
        freeCreditBalance: 0,
      } as never),
    );
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      order.push("claim");
      return Promise.resolve({ stripePaymentIntentId: null, ...data });
    });
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    await updateAutoReloadConfigDurably("org_1", true, 10, 50);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order.slice(0, 2)).toEqual(["config", "claim"]);
    expect(mockAutoReloadConfigUpsert).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      create: {
        organizationId: "org_1",
        enabled: true,
        pausedForDurableUpgrade: false,
        thresholdAmount: 10,
        reloadAmount: 50,
      },
      update: {
        enabled: true,
        pausedForDurableUpgrade: false,
        thresholdAmount: 10,
        reloadAmount: 50,
      },
    });
    expect(mockAutoReloadAttemptCreate).toHaveBeenCalledTimes(1);
  });

  it("explicit re-enable rearms a safe failed attempt even during its cooldown", async () => {
    orgState = { creditBalance: 0, freeCreditBalance: 0 };
    const failedAttempt = {
      id: "attempt_enable_retry",
      organizationId: "org_1",
      status: "failed",
      idempotencyKey: "auto-reload-enable-retry",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: null,
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      retryUntil: new Date(0),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: "no_payment_method",
    };
    let active: Record<string, unknown> | null = failedAttempt;
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(active as never));
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      const input = args as { data: { activeOrganizationId?: string | null } };
      if (input.data.activeOrganizationId === null) active = null;
      return Promise.resolve({ count: 1 });
    });
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 10, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1", creditBalance: 0, freeCreditBalance: 0 } as never),
    );
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      active = { stripePaymentIntentId: null, failureReason: null, ...data };
      return Promise.resolve(active);
    });
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    await updateAutoReloadConfigDurably("org_1", true, 10, 50);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        id: failedAttempt.id,
        activeOrganizationId: "org_1",
        status: "failed",
      },
      data: {
        status: "disabled",
        activeOrganizationId: null,
        failureReason: "owner_retry_requested",
        completedAt: expect.any(Date),
      },
    });
    expect(mockAutoReloadAttemptCreate).toHaveBeenCalledTimes(1);
  });

  it("disabling retires only attempts proven never submitted", async () => {
    await updateAutoReloadConfigDurably("org_1", false, 10, 50);

    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        activeOrganizationId: "org_1",
        status: { in: ["initializing", "pending"] },
        stripePaymentIntentId: null,
        lastSubmittedAt: null,
      },
      data: {
        status: "disabled",
        activeOrganizationId: null,
        failureReason: "auto_reload_disabled",
        completedAt: expect.any(Date),
      },
    });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("does not charge when disable wins after a worker leases a pending attempt", async () => {
    const attempt = {
      id: "attempt_disable_race",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-disable-race",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(0),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: null,
    };
    let state = "pending";
    let signalLeaseStarted!: () => void;
    const leaseStarted = new Promise<void>((resolve) => {
      signalLeaseStarted = resolve;
    });
    let releaseLease!: () => void;
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      const input = args as {
        where: { status?: unknown };
        data: { status?: string; leaseExpiresAt?: Date };
      };
      if (input.data.status === "disabled") {
        const won = state === "pending";
        if (won) state = "disabled";
        return Promise.resolve({ count: won ? 1 : 0 });
      }
      if (input.where.status === "pending" && !input.data.status) {
        signalLeaseStarted();
        return new Promise((resolve) => {
          releaseLease = () => resolve({ count: 1 });
        });
      }
      if (input.data.status === "submitting") {
        const won = state === "pending";
        if (won) state = "submitting";
        return Promise.resolve({ count: won ? 1 : 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    const worker = triggerAutoReloadIfNeeded("org_1", 0);
    await leaseStarted;
    await updateAutoReloadConfigDurably("org_1", false, 10, 50);
    releaseLease();
    await worker;

    expect(state).toBe("disabled");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("does not charge when disable wins during initializing card lookup", async () => {
    const attempt = {
      id: "attempt_disable_lookup",
      organizationId: "org_1",
      status: "initializing",
      idempotencyKey: "auto-reload-disable-lookup",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: null,
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(0),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: null,
    };
    let state = "initializing";
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 10, reloadAmount: 50 } as never),
    );
    let signalLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      signalLookupStarted = resolve;
    });
    let resolvePaymentMethod!: (value: string | null) => void;
    mockOffSessionPaymentMethodId = mock(() => {
      signalLookupStarted();
      return new Promise((resolve) => {
        resolvePaymentMethod = resolve;
      });
    });
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      const input = args as { where: { status?: unknown }; data: { status?: string } };
      if (input.data.status === "disabled") {
        const won = state === "initializing";
        if (won) state = "disabled";
        return Promise.resolve({ count: won ? 1 : 0 });
      }
      if (input.data.status === "pending") {
        const won = state === "initializing";
        if (won) state = "pending";
        return Promise.resolve({ count: won ? 1 : 0 });
      }
      return Promise.resolve({ count: state === "initializing" ? 1 : 0 });
    });

    const worker = triggerAutoReloadIfNeeded("org_1", 0);
    await lookupStarted;
    await updateAutoReloadConfigDurably("org_1", false, 10, 50);
    resolvePaymentMethod("pm_new");
    await worker;

    expect(state).toBe("disabled");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("starts the idempotency retry window at the first Stripe submission", async () => {
    const attempt = {
      id: "attempt_late_submission",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-late-submission",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(0),
      lastSubmittedAt: null,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      failureReason: null,
    };
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve({
        ...(params as Record<string, unknown>),
        id: "pi_late_submission",
        status: "processing",
        amount_received: 0,
        latest_charge: null,
      } as never),
    );

    const before = Date.now();
    await triggerAutoReloadIfNeeded("org_1", 0);

    const submittingCall = mockAutoReloadAttemptUpdateMany.mock.calls.find(
      ([args]) => (args as { data?: { status?: string } }).data?.status === "submitting",
    );
    const submittingData = (submittingCall?.[0] as {
      data: { lastSubmittedAt: Date; retryUntil: Date };
    }).data;
    expect(submittingData.lastSubmittedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(submittingData.retryUntil.getTime()).toBeGreaterThan(
      before + 22 * 60 * 60 * 1000,
    );
  });

  it("rearms a no-card failure after the owner saves a payment method", async () => {
    const failedAttempt = {
      id: "attempt_no_card",
      organizationId: "org_1",
      status: "failed",
      idempotencyKey: "auto-reload-no-card",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: null,
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryUntil: new Date(0),
      lastSubmittedAt: null,
      createdAt: new Date(),
      failureReason: "no_payment_method",
    };
    let active: Record<string, unknown> | null = failedAttempt;
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(active as never));
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      const input = args as { data: { activeOrganizationId?: string | null } };
      if (input.data.activeOrganizationId === null) active = null;
      return Promise.resolve({ count: 1 });
    });
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 30, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1", creditBalance: 0, freeCreditBalance: 0 } as never),
    );
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      active = { stripePaymentIntentId: null, failureReason: null, ...data };
      return Promise.resolve(active);
    });
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    await rearmAutoReloadAfterPaymentMethodChange("org_1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPaymentIntentsList).not.toHaveBeenCalled();
    expect(mockAutoReloadAttemptCreate).toHaveBeenCalledTimes(1);
  });

  it("settles a submitted failed PI with Stripe before card replacement rearms it", async () => {
    const submittedAt = new Date(Date.now() - 10 * 60 * 1000);
    const failedAttempt = {
      id: "attempt_declined_card",
      organizationId: "org_1",
      status: "failed",
      idempotencyKey: "auto-reload-declined-card",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_old",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryUntil: new Date(Date.now() + 60_000),
      lastSubmittedAt: submittedAt,
      createdAt: new Date(submittedAt.getTime() - 60_000),
      failureReason: "card_declined",
    };
    const oldIntent = {
      id: "pi_declined_card",
      status: "requires_payment_method",
      currency: "usd",
      amount: 5000,
      amount_received: 0,
      customer: "cus_1",
      payment_method: "pm_old",
      latest_charge: null,
      metadata: {
        orgId: "org_1",
        type: "auto_reload",
        autoReloadAttemptId: failedAttempt.id,
        autoReloadKey: failedAttempt.idempotencyKey,
      },
      last_payment_error: { code: "card_declined" },
    };
    let active: Record<string, unknown> | null = failedAttempt;
    const order: string[] = [];
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(active as never));
    mockAutoReloadAttemptFindFirst = mock(() => Promise.resolve(active as never));
    mockPaymentIntentsList = mock(() => {
      order.push("list");
      return asyncPaymentIntentList([oldIntent]);
    });
    mockPaymentIntentsCancel = mock(() => {
      order.push("cancel");
      return Promise.resolve({ ...oldIntent, status: "canceled" } as never);
    });
    mockAutoReloadAttemptUpdateMany = mock((args: unknown) => {
      const input = args as {
        where: { status?: unknown };
        data: { status?: string; activeOrganizationId?: string | null; stripePaymentIntentId?: string };
      };
      if (input.data.status === "disabled") {
        order.push("release");
        active = null;
        return Promise.resolve({ count: 1 });
      }
      if (input.data.stripePaymentIntentId && !input.data.status && active) {
        active = { ...active, stripePaymentIntentId: input.data.stripePaymentIntentId };
        return Promise.resolve({ count: 1 });
      }
      if (input.data.status === "failed") {
        if (input.where.status === "initializing" && active?.status === "initializing") {
          active = { ...active, status: "failed" };
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 30, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1", creditBalance: 0, freeCreditBalance: 0 } as never),
    );
    mockAutoReloadAttemptCreate = mock(({ data }: { data: Record<string, unknown> }) => {
      order.push("claim");
      active = { stripePaymentIntentId: null, failureReason: null, ...data };
      return Promise.resolve(active);
    });
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    await rearmAutoReloadAfterPaymentMethodChange("org_1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order.slice(0, 4)).toEqual(["list", "cancel", "release", "claim"]);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("scheduled reconciliation replays an expired pending attempt with its exact persisted request", async () => {
    const attempt = {
      id: "attempt_sweep_pending",
      organizationId: "org_1",
      status: "pending",
      idempotencyKey: "auto-reload-sweep-stable",
      amountCents: 5000,
      stripeCustomerId: "cus_original",
      stripePaymentMethodId: "pm_original",
      stripePaymentIntentId: null,
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      failureReason: null,
    };
    mockAutoReloadAttemptFindMany = mock(() =>
      Promise.resolve([{ id: attempt.id, organizationId: "org_1" }] as never),
    );
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));
    // An already-authorized attempt must finish even if auto-reload was disabled
    // after its original request became indeterminate.
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: false, thresholdAmount: 10, reloadAmount: 50 } as never),
    );
    let seenParams: Record<string, unknown> | undefined;
    let seenOpts: Record<string, unknown> | undefined;
    mockPaymentIntentsCreate = mock((params: unknown, opts: unknown) => {
      seenParams = params as Record<string, unknown>;
      seenOpts = opts as Record<string, unknown>;
      return Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_sweep_pending") as never,
      );
    });

    await expect(reconcileAutoReloadAttempts()).resolves.toEqual({
      scanned: 1,
      attempted: 1,
      failed: 0,
    });

    expect(seenParams).toMatchObject({
      amount: 5000,
      currency: "usd",
      customer: "cus_original",
      payment_method: "pm_original",
      off_session: true,
      confirm: true,
      metadata: {
        orgId: "org_1",
        type: "auto_reload",
        amountUsd: "50",
        autoReloadAttemptId: attempt.id,
        autoReloadKey: attempt.idempotencyKey,
      },
    });
    expect(seenOpts).toEqual({ idempotencyKey: attempt.idempotencyKey });
    expect(mockAutoReloadConfigFindUnique).not.toHaveBeenCalled();
    expect(
      createdTransactions.filter((row) => (row as { type: string }).type === "auto_reload"),
    ).toHaveLength(1);
  });

  it("scheduled reconciliation grants a charged attempt without creating another PaymentIntent", async () => {
    const attempt = {
      id: "attempt_sweep_charged",
      organizationId: "org_1",
      status: "charged",
      idempotencyKey: "auto-reload-charged-stable",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: "pi_already_charged",
      leaseExpiresAt: new Date(0),
      retryUntil: new Date(Date.now() + 60_000),
      failureReason: null,
    };
    mockAutoReloadAttemptFindMany = mock(() =>
      Promise.resolve([{ id: attempt.id, organizationId: "org_1" }] as never),
    );
    mockAutoReloadAttemptFindUnique = mock(() => Promise.resolve(attempt as never));

    await expect(reconcileAutoReloadAttempts()).resolves.toEqual({
      scanned: 1,
      attempted: 1,
      failed: 0,
    });

    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(createdTransactions).toContainEqual({
      amount: 50,
      type: "auto_reload",
      description: "Auto-reload — $50",
      stripeSessionId: "pi_already_charged",
      balanceAfter: 78,
      organizationId: "org_1",
    });
    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        id: attempt.id,
        organizationId: "org_1",
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["initializing", "pending", "submitting", "processing", "charged", "failed", "uncertain"] },
      },
      data: {
        status: "completed",
        activeOrganizationId: null,
        stripePaymentIntentId: "pi_already_charged",
        failureReason: null,
        completedAt: expect.any(Date),
      },
    });
  });

  it("bounds scheduled reconciliation to expired pending and charged attempts", async () => {
    await expect(reconcileAutoReloadAttempts()).resolves.toEqual({
      scanned: 0,
      attempted: 0,
      failed: 0,
    });

    expect(mockAutoReloadAttemptFindMany).toHaveBeenCalledWith({
      where: {
        activeOrganizationId: { not: null },
        status: { in: ["initializing", "pending", "submitting", "processing", "charged", "uncertain"] },
        leaseExpiresAt: { lte: expect.any(Date) },
      },
      select: { id: true, organizationId: true },
      orderBy: { leaseExpiresAt: "asc" },
      take: 100,
    });
  });

  it("isolates a failed candidate and continues the reconciliation batch", async () => {
    mockAutoReloadAttemptFindMany = mock(() =>
      Promise.resolve([
        { id: "attempt_bad", organizationId: "org_bad" },
        { id: "attempt_good", organizationId: "org_good" },
      ] as never),
    );
    let balanceReads = 0;
    mockFindUniqueOrThrow = mock(async () => {
      balanceReads += 1;
      if (balanceReads === 1) throw new Error("org balance unavailable");
      return { creditBalance: orgState.creditBalance, freeCreditBalance: orgState.freeCreditBalance };
    });
    mockAutoReloadAttemptFindUnique = mock(() =>
      Promise.resolve({
        id: "attempt_good",
        organizationId: "org_good",
        status: "pending",
        idempotencyKey: "auto-reload-good",
        amountCents: 5000,
        stripeCustomerId: "cus_good",
        stripePaymentMethodId: "pm_good",
        stripePaymentIntentId: null,
        leaseExpiresAt: new Date(0),
        retryUntil: new Date(Date.now() + 60_000),
        failureReason: null,
      } as never),
    );
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_good") as never,
      ),
    );

    await expect(reconcileAutoReloadAttempts()).resolves.toEqual({
      scanned: 2,
      attempted: 1,
      failed: 1,
    });
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(
      createdTransactions.filter((row) => (row as { type: string }).type === "auto_reload"),
    ).toHaveLength(1);
  });

  it("suppresses a decline notice when a raced webhook already completed the attempt", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 25, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    mockAutoReloadAttemptUpdateMany = mock(() => Promise.resolve({ count: 0 }));
    mockPaymentIntentsCreate = mock(() =>
      Promise.reject(Object.assign(new Error("declined"), {
        type: "StripeCardError",
        code: "card_declined",
      })),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
  });

  it("suppresses a non-succeeded notice when a raced webhook already completed the attempt", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 25, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    mockAutoReloadAttemptUpdateMany = mock(() => Promise.resolve({ count: 0 }));
    mockPaymentIntentsCreate = mock(() =>
      Promise.resolve({ id: "pi_action", status: "requires_action", latest_charge: null } as never),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
  });

  it("can trigger immediately at zero balance without waiting for a deduction", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({ enabled: true, thresholdAmount: 10, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1", creditBalance: 0, freeCreditBalance: 0 } as never),
    );
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_zero") as never,
      ),
    );

    await triggerAutoReloadIfNeeded("org_1", 0);

    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
  });

  it("does not report a successful charge as failed when only the credit grant fails", async () => {
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({
        enabled: true,
        thresholdAmount: 25,
        reloadAmount: 50,
      } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        stripeCustomerId: "cus_1",
        creditBalance: orgState.creditBalance,
        freeCreditBalance: orgState.freeCreditBalance,
      } as never),
    );
    mockPaymentIntentsCreate = mock((params: unknown) =>
      Promise.resolve(
        succeededIntentFromCreateParams(params as Record<string, unknown>, "pi_auto_recover") as never,
      ),
    );
    mockTxCreditTransactionCreate = mock(({ data }: { data: unknown }) => {
      if ((data as { type: string }).type === "auto_reload") {
        return Promise.reject(new Error("database unavailable"));
      }
      createdTransactions.push(data);
      return Promise.resolve(data);
    });

    await deductCredits("org_1", 6, "Review run");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
    expect(
      createdTransactions.filter((row) => (row as { type: string }).type === "auto_reload"),
    ).toHaveLength(0);
  });
});

describe("Stripe webhook route", () => {
  it("rejects unsigned webhook requests before processing the event", async () => {
    const response = await POST(
      new Request("https://octopus.test/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing signature" });
    expect(mockConstructWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects events when Stripe signature verification fails", async () => {
    shouldRejectSignature = true;

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" });
    expect(createdTransactions).toEqual([]);
  });

  it("adds credits for completed credit-purchase checkout sessions and stores receipt URL", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
          payment_status: "paid",
          metadata: {
            orgId: "org_1",
            type: "credit_purchase",
            amountUsd: "25",
          },
          payment_intent: "pi_123",
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(createdTransactions).toEqual([
      {
        amount: 25,
        type: "purchase",
        description: "Credit purchase — $25",
        stripeSessionId: "cs_123",
        balanceAfter: 53,
        organizationId: "org_1",
      },
    ]);
    expect(mockChargesList).toHaveBeenCalledWith({
      payment_intent: "pi_123",
      limit: 1,
    });
    expect(mockCreditTransactionUpdate).toHaveBeenCalledWith({
      where: { stripeSessionId: "cs_123" },
      data: { receiptUrl: "https://stripe.test/receipt" },
    });
  });

  it("does not credit malformed checkout sessions", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bad",
          metadata: {
            orgId: "org_1",
            type: "credit_purchase",
            amountUsd: "0",
          },
          payment_intent: "pi_bad",
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions).toEqual([]);
    expect(mockChargesList).not.toHaveBeenCalled();
  });

  it("deducts credits when Stripe reports a refund and maps the payment intent back to the org", async () => {
    // Even with auto-reload enabled and the resulting balance below threshold,
    // a refund must never charge the customer again.
    mockAutoReloadConfigFindUnique = mock(() =>
      Promise.resolve({
        id: "arc_refund",
        enabled: true,
        thresholdAmount: 25,
        reloadAmount: 50,
        updatedAt: new Date(0),
      } as never),
    );
    currentEvent = {
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_refund",
          payment_intent: "pi_refund",
          amount_refunded: 1250,
        },
      },
    };
    mockRefundsList = mock(() =>
      asyncRefundList([{ id: "re_1", amount: 1250, status: "succeeded" }]),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(mockCheckoutSessionsList).toHaveBeenCalledWith({
      payment_intent: "pi_refund",
      limit: 1,
    });
    // Per-refund amount keyed on the refund id (idempotency), not the cumulative
    // charge.amount_refunded.
    expect(mockRefundsList).toHaveBeenCalledWith({ charge: "ch_refund" });
    expect(orgState).toEqual({ creditBalance: 15.5, freeCreditBalance: 0 });
    expect(createdTransactions).toEqual([
      {
        amount: -12.5,
        type: "usage",
        description: "Refund — $12.5",
        stripeRefundId: "re_1",
        balanceAfter: 15.5,
        organizationId: "org_1",
      },
    ]);
    expect(mockAutoReloadConfigFindUnique).not.toHaveBeenCalled();
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("deducts each partial refund by its own amount, not the cumulative charge total", async () => {
    currentEvent = {
      type: "charge.refunded",
      data: {
        object: { id: "ch_multi", payment_intent: "pi_multi", amount_refunded: 1000 },
      },
    };
    // Two $5 partial refunds: charge.amount_refunded is the cumulative 1000, but
    // the handler must deduct 5 + 5 keyed per refund id (not 10 + 10).
    mockRefundsList = mock(() =>
      asyncRefundList([
        { id: "re_a", amount: 500, status: "succeeded" },
        { id: "re_b", amount: 500, status: "succeeded" },
      ]),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions.map((t) => (t as { amount: number }).amount)).toEqual([-5, -5]);
    expect(
      createdTransactions.map((t) => (t as { stripeRefundId: string }).stripeRefundId),
    ).toEqual(["re_a", "re_b"]);
  });

  it("acknowledges a duplicate refund delivery (P2002) with 200 instead of erroring", async () => {
    currentEvent = {
      type: "charge.refunded",
      data: {
        object: { id: "ch_dup", payment_intent: "pi_dup", amount_refunded: 500 },
      },
    };
    mockRefundsList = mock(() =>
      asyncRefundList([{ id: "re_dup", amount: 500, status: "succeeded" }]),
    );
    // Redelivered refund hits the UNIQUE(stripeRefundId) constraint → P2002 →
    // the transaction rolls back, so the balance must be left untouched.
    mockTxCreditTransactionCreate = mock(() =>
      Promise.reject(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });

  it("skips refunds that did not actually move money (non-succeeded status)", async () => {
    currentEvent = {
      type: "charge.refunded",
      data: {
        object: { id: "ch_pending", payment_intent: "pi_pending", amount_refunded: 500 },
      },
    };
    // A pending/failed refund still carries a nonzero amount but moved no money.
    mockRefundsList = mock(() =>
      asyncRefundList([{ id: "re_pending", amount: 500, status: "pending" }]),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions).toEqual([]);
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });

  it("returns 500 so Stripe retries when a credit grant fails transiently", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_fail",
          payment_status: "paid",
          metadata: { orgId: "org_1", type: "credit_purchase", amountUsd: "25" },
          payment_intent: "pi_fail",
        },
      },
    };
    // Non-duplicate (transient) DB error mid-grant must NOT be ACKed with 200,
    // otherwise Stripe never retries and the paid customer loses the credits.
    mockTxCreditTransactionCreate = mock(() =>
      Promise.reject(new Error("connection terminated")),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "processing failed" });
  });

  it("acknowledges unknown event types without touching credits", async () => {
    currentEvent = { type: "customer.created", data: { object: { id: "cus_123" } } };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(createdTransactions).toEqual([]);
  });
});

describe("subscription renewals", () => {
  it("addOneMonth clamps the day (Jan 31 → Feb 28)", () => {
    expect(addOneMonth(new Date(Date.UTC(2026, 0, 31))).toISOString()).toBe(
      new Date(Date.UTC(2026, 1, 28)).toISOString(),
    );
  });

  it("renews a due org: charges, grants credits, advances from the due date", async () => {
    const due = new Date(Date.UTC(2026, 6, 15));
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: due, planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockPaymentIntentsCreate = mock(() =>
      Promise.resolve({ id: "pi_sub_1", status: "succeeded", latest_charge: null } as never),
    );

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 1, canceled: 0, downgraded: 0, failed: 0 });
    expect(orgState.creditBalance).toBe(20 + 54); // Pro grants $54
    expect(createdTransactions).toHaveLength(1);
    expect((createdTransactions[0] as { type: string }).type).toBe("subscription");
    const stamp = organizationUpdates.find(
      (u) => (u as { data: { planTier?: string } }).data.planTier === "pro",
    ) as { data: { planRenewsAt: Date } };
    expect(stamp.data.planRenewsAt.toISOString()).toBe(
      new Date(Date.UTC(2026, 7, 15)).toISOString(),
    );
  });

  it("downgrades a cancel-at-period-end org without charging", async () => {
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: new Date(), planCancelAtPeriodEnd: true },
      ]),
    );

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 0, canceled: 1, downgraded: 0, failed: 0 });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(orgState.creditBalance).toBe(20);
    expect(organizationUpdates).toEqual([
      {
        where: { id: "org_1" },
        data: { planTier: "free", planRenewsAt: null, planCancelAtPeriodEnd: false },
      },
    ]);
  });

  it("keeps retrying a failed charge inside the grace window", async () => {
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockPaymentIntentsCreate = mock(() => Promise.reject(new Error("card_declined")));

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 0, canceled: 0, downgraded: 0, failed: 1 });
    expect(orgState.creditBalance).toBe(20);
    expect(organizationUpdates).toEqual([]);
  });

  it("downgrades after the grace window of failed charges", async () => {
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockPaymentIntentsCreate = mock(() => Promise.reject(new Error("card_declined")));

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 0, canceled: 0, downgraded: 1, failed: 0 });
    expect(organizationUpdates).toEqual([
      {
        where: { id: "org_1" },
        data: { planTier: "free", planRenewsAt: null, planCancelAtPeriodEnd: false },
      },
    ]);
  });

  it("treats a duplicate grant (P2002) as already processed — no double credit, no re-stamp", async () => {
    const due = new Date(Date.UTC(2026, 6, 15));
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: due, planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockPaymentIntentsCreate = mock(() =>
      Promise.resolve({ id: "pi_sub_dup", status: "succeeded", latest_charge: null } as never),
    );
    mockTxCreditTransactionCreate = mock(() => {
      const err = new Error("unique") as Error & { code: string };
      err.code = "P2002";
      return Promise.reject(err);
    });

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 1, canceled: 0, downgraded: 0, failed: 0 });
    expect(orgState.creditBalance).toBe(20); // rolled back, not re-granted
    expect(organizationUpdates).toEqual([]); // plan state untouched
  });
});

describe("subscription webhook", () => {
  it("grants the first period and stamps the plan for a paid subscription_start session", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sub_1",
          payment_status: "paid",
          metadata: { orgId: "org_1", type: "subscription_start", tier: "pro" },
          payment_intent: "pi_sub_1",
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(orgState.creditBalance).toBe(20 + 54);
    expect(createdTransactions).toHaveLength(1);
    expect((createdTransactions[0] as { type: string; stripeSessionId: string }).type).toBe(
      "subscription",
    );
    expect(
      (createdTransactions[0] as { stripeSessionId: string }).stripeSessionId,
    ).toBe("cs_sub_1");
    const stamp = organizationUpdates[0] as { data: { planTier: string } };
    expect(stamp.data.planTier).toBe("pro");
  });

  it("does not grant when the session is not paid yet", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sub_unpaid",
          payment_status: "unpaid",
          metadata: { orgId: "org_1", type: "subscription_start", tier: "pro" },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions).toEqual([]);
    expect(organizationUpdates).toEqual([]);
    expect(orgState.creditBalance).toBe(20);
  });

  it("ignores unknown tiers without granting", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sub_bad",
          payment_status: "paid",
          metadata: { orgId: "org_1", type: "subscription_start", tier: "mega" },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions).toEqual([]);
    expect(organizationUpdates).toEqual([]);
  });
});

describe("off-session payment method resolution", () => {
  it("does not charge a renewal when the org has no saved card", async () => {
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: new Date(), planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    const result = await renewDueSubscriptions();

    // No card → charge returns null → treated as a failed charge (grace retry).
    expect(result).toEqual({ renewed: 0, canceled: 0, downgraded: 0, failed: 1 });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(orgState.creditBalance).toBe(20);
  });

  it("does not downgrade on a Stripe API error resolving the card (transient)", async () => {
    mockOrganizationFindMany = mock(() =>
      Promise.resolve([
        { id: "org_1", planTier: "pro", planRenewsAt: new Date(), planCancelAtPeriodEnd: false },
      ]),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    // A Stripe outage must NOT read as "no card" — it should count as a failed
    // charge (grace retry), never a downgrade.
    mockOffSessionPaymentMethodId = mock(() => Promise.reject(new Error("stripe down")));

    const result = await renewDueSubscriptions();

    expect(result).toEqual({ renewed: 0, canceled: 0, downgraded: 0, failed: 1 });
    expect(orgState.creditBalance).toBe(20);
  });
});


describe("volume purchase bonus", () => {
  it("computes tiered bonus (50% at $100, 60% at $250, 70% at $500+)", () => {
    expect(volumeBonusUsd(25)).toBe(0);
    expect(volumeBonusUsd(99)).toBe(0);
    expect(volumeBonusUsd(100)).toBe(50);
    expect(volumeBonusUsd(250)).toBe(150);
    expect(volumeBonusUsd(500)).toBe(350);
    expect(volumeBonusUsd(1000)).toBe(700);
    expect(volumeBonusUsd(0)).toBe(0);
    expect(volumeBonusUsd(-5)).toBe(0);
  });

  it("grants purchase + a separate free_credit bonus row on a $100 top-up", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bonus",
          payment_status: "paid",
          metadata: { orgId: "org_1", type: "credit_purchase", amountUsd: "100" },
          payment_intent: "pi_bonus",
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    // free 8 + purchased 20, then +100 purchased, +50 free bonus.
    expect(orgState).toEqual({ creditBalance: 120, freeCreditBalance: 58 });
    const types = createdTransactions.map((t) => (t as { type: string }).type);
    expect(types).toContain("purchase");
    expect(types).toContain("free_credit");
    const bonus = createdTransactions.find(
      (t) => (t as { type: string }).type === "free_credit",
    ) as { amount: number };
    expect(bonus.amount).toBe(50); // NOT part of the purchase/revenue row
  });

  it("grants no bonus row for a sub-$100 top-up", async () => {
    currentEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_nobonus",
          payment_status: "paid",
          metadata: { orgId: "org_1", type: "credit_purchase", amountUsd: "50" },
          payment_intent: "pi_nobonus",
        },
      },
    };

    await POST(stripeRequest() as never);

    const types = createdTransactions.map((t) => (t as { type: string }).type);
    expect(types).toContain("purchase");
    expect(types).not.toContain("free_credit");
  });
});

describe("off-session credit purchase", () => {
  it("no_card when the org has no saved payment method", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: "cus_1" } as never));
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve(null));

    const res = await chargeCreditsOffSession("org_1", 100, "idem-test");
    expect(res).toEqual({ status: "no_card" });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("no_card when the org has no stripe customer at all", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: null } as never));
    const res = await chargeCreditsOffSession("org_1", 100, "idem-test");
    expect(res).toEqual({ status: "no_card" });
  });

  it("passes the idempotency key to Stripe so SDK retries can't double-charge", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: "cus_1" } as never));
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    let seenOpts: unknown;
    mockPaymentIntentsCreate = mock((_params: unknown, opts: unknown) => {
      seenOpts = opts;
      return Promise.resolve({ id: "pi_idem", status: "succeeded", latest_charge: null } as never);
    });

    await chargeCreditsOffSession("org_1", 25, "idem-abc");

    expect(seenOpts).toEqual({ idempotencyKey: "idem-abc" });
  });

  it("charges the saved card and grants purchase + volume bonus keyed on the PI id", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: "cus_1" } as never));
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    mockPaymentIntentsCreate = mock(() =>
      Promise.resolve({ id: "pi_buy", status: "succeeded", latest_charge: null } as never),
    );

    const res = await chargeCreditsOffSession("org_1", 100, "idem-test");

    expect(res).toEqual({ status: "succeeded", paymentIntentId: "pi_buy" });
    // free 8 + purchased 20, then +100 purchased and +50 free bonus.
    expect(orgState).toEqual({ creditBalance: 120, freeCreditBalance: 58 });
    const purchase = createdTransactions.find((t) => (t as { type: string }).type === "purchase") as {
      stripeSessionId: string;
      amount: number;
    };
    expect(purchase.stripeSessionId).toBe("pi_buy");
    expect(purchase.amount).toBe(100);
    const bonus = createdTransactions.find((t) => (t as { type: string }).type === "free_credit") as {
      amount: number;
    };
    expect(bonus.amount).toBe(50);
  });

  it("failed with cardError=true when the saved card is genuinely declined", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: "cus_1" } as never));
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    // Real Stripe card declines are StripeCardError with a decline code.
    const declined = new Error("declined") as Error & { code: string; type: string };
    declined.code = "card_declined";
    declined.type = "StripeCardError";
    mockPaymentIntentsCreate = mock(() => Promise.reject(declined));

    const res = await chargeCreditsOffSession("org_1", 25, "idem-test");

    expect(res).toEqual({ status: "failed", cardError: true, reason: "card_declined" });
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 }); // untouched
  });

  it("failed with cardError=false for a platform/config error (not blamed on the card)", async () => {
    mockOrganizationFindUnique = mock(() => Promise.resolve({ stripeCustomerId: "cus_1" } as never));
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    // e.g. bad API key / invalid request — NOT a card decline.
    const apiErr = new Error("No such price") as Error & { code: string; type: string };
    apiErr.code = "resource_missing";
    apiErr.type = "StripeInvalidRequestError";
    mockPaymentIntentsCreate = mock(() => Promise.reject(apiErr));

    const res = await chargeCreditsOffSession("org_1", 25, "idem-test");

    expect(res).toEqual({ status: "failed", cardError: false, reason: "resource_missing" });
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 }); // untouched
  });
});

describe("payment_intent.succeeded backfill (charge-without-grant recovery)", () => {
  it("grants purchase + volume bonus for a direct off-session credit_purchase PI", async () => {
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_direct",
          latest_charge: null,
          metadata: { orgId: "org_1", type: "credit_purchase", amountUsd: "100" },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    // +100 purchased, +50 bonus.
    expect(orgState).toEqual({ creditBalance: 120, freeCreditBalance: 58 });
    const purchase = createdTransactions.find((t) => (t as { type: string }).type === "purchase") as {
      stripeSessionId: string;
    };
    expect(purchase.stripeSessionId).toBe("pi_direct");
  });

  it("is a no-op when the inline grant already ran (same PI id → P2002)", async () => {
    // Simulate 'already granted': the ledger insert hits the unique constraint.
    mockTxCreditTransactionCreate = mock(() => {
      const err = new Error("dup") as Error & { code: string };
      err.code = "P2002";
      return Promise.reject(err);
    });
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_dup",
          latest_charge: null,
          metadata: { orgId: "org_1", type: "credit_purchase", amountUsd: "100" },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 }); // unchanged, no double-grant
  });

  it("recovers an auto-reload charge by granting credits keyed on the PI id", async () => {
    mockAutoReloadAttemptFindFirst = mock(() =>
      Promise.resolve({
        id: "attempt_recover",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-recover",
        amountCents: 5000,
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        stripePaymentIntentId: null,
      } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_auto_recover",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 5000,
          customer: "cus_1",
          payment_method: "pm_1",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "999",
            autoReloadAttemptId: "attempt_recover",
            autoReloadKey: "auto-reload-recover",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(orgState).toEqual({ creditBalance: 70, freeCreditBalance: 8 });
    expect(createdTransactions).toContainEqual({
      amount: 50,
      type: "auto_reload",
      description: "Auto-reload — $50",
      stripeSessionId: "pi_auto_recover",
      balanceAfter: 78,
      organizationId: "org_1",
    });
    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "attempt_recover",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-recover",
        status: { in: ["initializing", "pending", "submitting", "processing", "charged", "failed", "uncertain"] },
      },
      data: {
        status: "completed",
        activeOrganizationId: null,
        stripePaymentIntentId: "pi_auto_recover",
        failureReason: null,
        completedAt: expect.any(Date),
      },
    });
  });

  it("acknowledges an already-granted auto-reload PI without double-crediting", async () => {
    mockTxCreditTransactionCreate = mock(() =>
      Promise.reject(Object.assign(new Error("duplicate"), { code: "P2002" })),
    );
    mockAutoReloadAttemptFindFirst = mock(() =>
      Promise.resolve({
        id: "attempt_duplicate",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-duplicate",
        amountCents: 5000,
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        stripePaymentIntentId: "pi_auto_duplicate",
      } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_auto_duplicate",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 5000,
          customer: "cus_1",
          payment_method: "pm_1",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "50",
            autoReloadAttemptId: "attempt_duplicate",
            autoReloadKey: "auto-reload-duplicate",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });

  it("recovers a tightly validated legacy auto-reload PI during a rolling deploy", async () => {
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_legacy" } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_legacy_auto_reload",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 5000,
          customer: "cus_legacy",
          payment_method: "pm_legacy",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "50",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions).toContainEqual({
      amount: 50,
      type: "auto_reload",
      description: "Auto-reload — $50",
      stripeSessionId: "pi_legacy_auto_reload",
      balanceAfter: 78,
      organizationId: "org_1",
    });
    expect(mockAutoReloadAttemptFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a legacy auto-reload PI whose Stripe customer does not match the org", async () => {
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_expected" } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_legacy_wrong_customer",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 5000,
          customer: "cus_other",
          payment_method: "pm_legacy",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "50",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(500);
    expect(createdTransactions).toEqual([]);
  });

  it("returns 500 so Stripe retries a transient auto-reload grant failure", async () => {
    mockTxCreditTransactionCreate = mock(() =>
      Promise.reject(new Error("database unavailable")),
    );
    mockAutoReloadAttemptFindFirst = mock(() =>
      Promise.resolve({
        id: "attempt_retry",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-retry",
        amountCents: 5000,
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        stripePaymentIntentId: null,
      } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_auto_retry",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 5000,
          customer: "cus_1",
          payment_method: "pm_1",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "50",
            autoReloadAttemptId: "attempt_retry",
            autoReloadKey: "auto-reload-retry",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "processing failed" });
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });

  it("does not trust auto-reload metadata when the paid amount mismatches the persisted attempt", async () => {
    mockAutoReloadAttemptFindFirst = mock(() =>
      Promise.resolve({
        id: "attempt_mismatch",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-mismatch",
        amountCents: 5000,
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        stripePaymentIntentId: null,
      } as never),
    );
    currentEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_auto_mismatch",
          status: "succeeded",
          currency: "usd",
          amount: 5000,
          amount_received: 4000,
          customer: "cus_1",
          payment_method: "pm_1",
          latest_charge: null,
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            amountUsd: "5000",
            autoReloadAttemptId: "attempt_mismatch",
            autoReloadKey: "auto-reload-mismatch",
          },
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(500);
    expect(createdTransactions).toEqual([]);
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
    expect(mockAutoReloadAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it("finalizes only the matching durable attempt on payment_intent.payment_failed", async () => {
    mockAutoReloadAttemptFindFirst = mock(() =>
      Promise.resolve({
        id: "attempt_failed",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-failed",
        amountCents: 5000,
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        stripePaymentIntentId: null,
      } as never),
    );
    let finalized = false;
    mockAutoReloadAttemptUpdateMany = mock(() => {
      if (finalized) return Promise.resolve({ count: 0 });
      finalized = true;
      return Promise.resolve({ count: 1 });
    });
    currentEvent = {
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_auto_failed",
          status: "requires_payment_method",
          currency: "usd",
          amount: 5000,
          amount_received: 0,
          customer: "cus_1",
          payment_method: "pm_1",
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            autoReloadAttemptId: "attempt_failed",
            autoReloadKey: "auto-reload-failed",
          },
          last_payment_error: { code: "card_declined", message: "declined" },
        },
      },
    };
    mockPaymentIntentsRetrieve = mock(() =>
      Promise.resolve({
        ...(currentEvent as { data: { object: Record<string, unknown> } }).data.object,
        status: "canceled",
      } as never),
    );

    const response = await POST(stripeRequest() as never);
    const duplicateResponse = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(mockAutoReloadAttemptUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "attempt_failed",
        organizationId: "org_1",
        idempotencyKey: "auto-reload-failed",
        activeOrganizationId: "org_1",
        status: { in: ["submitting", "processing", "uncertain"] },
      },
      data: {
        status: "failed",
        stripePaymentIntentId: "pi_auto_failed",
        failureReason: "card_declined",
        leaseExpiresAt: expect.any(Date),
        completedAt: expect.any(Date),
      },
    });
    expect(
      emittedEvents.filter((event) => event.type === "auto-reload-failed"),
    ).toEqual([
      {
        type: "auto-reload-failed",
        orgId: "org_1",
        reloadAmount: 50,
        remainingBalance: 28,
        reason: "card_declined",
      },
    ]);
  });

  it("uses current Stripe state so an older failed event cannot demote a succeeded PI", async () => {
    const attempt = {
      id: "attempt_out_of_order",
      organizationId: "org_1",
      idempotencyKey: "auto-reload-out-of-order",
      amountCents: 5000,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      stripePaymentIntentId: "pi_out_of_order",
    };
    mockAutoReloadAttemptFindFirst = mock(() => Promise.resolve(attempt as never));
    currentEvent = {
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_out_of_order",
          status: "requires_payment_method",
          currency: "usd",
          amount: 5000,
          amount_received: 0,
          customer: "cus_1",
          payment_method: "pm_1",
          metadata: {
            orgId: "org_1",
            type: "auto_reload",
            autoReloadAttemptId: attempt.id,
            autoReloadKey: attempt.idempotencyKey,
          },
          last_payment_error: { code: "card_declined", message: "declined" },
        },
      },
    };
    mockPaymentIntentsRetrieve = mock(() =>
      Promise.resolve({
        id: "pi_out_of_order",
        status: "succeeded",
        currency: "usd",
        amount: 5000,
        amount_received: 5000,
        customer: "cus_1",
        payment_method: "pm_1",
        latest_charge: null,
        metadata: {
          orgId: "org_1",
          type: "auto_reload",
          autoReloadAttemptId: attempt.id,
          autoReloadKey: attempt.idempotencyKey,
        },
      } as never),
    );

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(createdTransactions.some((row) => (row as { type: string }).type === "auto_reload")).toBe(true);
    expect(emittedEvents.some((event) => event.type === "auto-reload-failed")).toBe(false);
  });

  it("ignores a Checkout PI (no metadata.type) so it can't double-grant a checkout purchase", async () => {
    currentEvent = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_checkout", latest_charge: null, metadata: {} } },
    };

    await POST(stripeRequest() as never);

    expect(createdTransactions).toEqual([]);
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });
});

describe("AiUsage cost snapshot", () => {
  it("stores chargedCostUsd = deducted cost for platform-key usage", async () => {
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        anthropicApiKey: null,
        openaiApiKey: null,
        cohereApiKey: null,
        googleApiKey: null,
        grokApiKey: null,
        openrouterApiKey: null,
        claudeCodeApiKey: null,
        claudeCodeAuthMode: null,
      } as never),
    );

    await logAiUsage({
      provider: "anthropic",
      model: "m",
      operation: "review",
      inputTokens: 1_000_000,
      outputTokens: 0,
      organizationId: "org_1",
    });

    // 1M input × $10/1M × 1.2 markup = $12.
    expect(createdAiUsage).toHaveLength(1);
    expect(createdAiUsage[0].usedOwnKey).toBe(false);
    expect(createdAiUsage[0].chargedCostUsd).toBeCloseTo(12, 6);
    // Deducted from the ledger: free 8 → 0, purchased 20 → 16.
    expect(orgState).toEqual({ creditBalance: 16, freeCreditBalance: 0 });
  });

  it("leaves chargedCostUsd null when the deduction fails (usage served, not charged)", async () => {
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        anthropicApiKey: null,
        openaiApiKey: null,
        cohereApiKey: null,
        googleApiKey: null,
        grokApiKey: null,
        openrouterApiKey: null,
        claudeCodeApiKey: null,
        claudeCodeAuthMode: null,
      } as never),
    );
    // Deduction blows up mid-transaction.
    mockTxCreditTransactionCreate = mock(() => Promise.reject(new Error("db down")));

    await logAiUsage({
      provider: "anthropic",
      model: "m",
      operation: "review",
      inputTokens: 1_000_000,
      outputTokens: 0,
      organizationId: "org_1",
    });

    // Usage row exists (usage happened) but the snapshot was never stamped.
    expect(createdAiUsage).toHaveLength(1);
    expect(createdAiUsage[0].chargedCostUsd).toBeNull();
  });

  it("stores null chargedCostUsd for own-key usage and never deducts", async () => {
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({
        anthropicApiKey: "sk-ant-user",
        openaiApiKey: null,
        cohereApiKey: null,
        googleApiKey: null,
        grokApiKey: null,
        openrouterApiKey: null,
        claudeCodeApiKey: null,
        claudeCodeAuthMode: null,
      } as never),
    );

    await logAiUsage({
      provider: "anthropic",
      model: "m",
      operation: "review",
      inputTokens: 1_000_000,
      outputTokens: 0,
      organizationId: "org_1",
    });

    expect(createdAiUsage[0].usedOwnKey).toBe(true);
    expect(createdAiUsage[0].chargedCostUsd).toBeNull();
    expect(orgState).toEqual({ creditBalance: 20, freeCreditBalance: 8 });
  });
});
