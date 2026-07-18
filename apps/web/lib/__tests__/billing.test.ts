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
let mockOrganizationFindUnique = mock(() => Promise.resolve(null));
let mockOrganizationFindMany = mock(() => Promise.resolve([] as unknown[]));
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
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { ...orgState };
      try {
        return await callback({
          $queryRaw: (...args: unknown[]) => mockTxQueryRaw(...args),
          organization: {
            update: (...args: unknown[]) => mockTxOrganizationUpdate(...args),
          },
          creditTransaction: {
            create: (...args: unknown[]) => mockTxCreditTransactionCreate(...args),
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
    },
  }),
}));

const {
  addCredits,
  addFreeCredits,
  deductCredits,
  getOrgBalance,
} = await import("@/lib/credits");
const { POST } = await import("@/app/api/stripe/webhook/route");
const { addOneMonth, renewDueSubscriptions } = await import("@/lib/subscription");

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
  mockOrganizationFindUnique = mock(() => Promise.resolve(null));
  organizationUpdates = [];
  mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_default" as string | null));
  mockOrganizationFindMany = mock(() => Promise.resolve([] as unknown[]));
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
      Promise.resolve({ enabled: true, thresholdAmount: 25, reloadAmount: 50 } as never),
    );
    mockOrganizationFindUnique = mock(() =>
      Promise.resolve({ stripeCustomerId: "cus_1" } as never),
    );
    mockCreditTransactionFindFirst = mock(() => Promise.resolve(null)); // no recent reload
    mockOffSessionPaymentMethodId = mock(() => Promise.resolve("pm_1"));
    const declined = new Error("Your card was declined.") as Error & { code: string };
    declined.code = "card_declined";
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
