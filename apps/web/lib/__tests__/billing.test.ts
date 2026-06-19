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

mock.module("@octopus/db", () => ({
  prisma: {
    organization: {
      findUniqueOrThrow: (...args: unknown[]) => mockFindUniqueOrThrow(...args),
      findUnique: (...args: unknown[]) => mockOrganizationFindUnique(...args),
    },
    creditTransaction: {
      aggregate: (...args: unknown[]) => mockCreditAggregate(...args),
      findFirst: (...args: unknown[]) => mockCreditTransactionFindFirst(...args),
      update: (...args: unknown[]) => mockCreditTransactionUpdate(...args),
    },
    autoReloadConfig: {
      findUnique: (...args: unknown[]) => mockAutoReloadConfigFindUnique(...args),
    },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: (...args: unknown[]) => mockTxQueryRaw(...args),
        organization: {
          update: (...args: unknown[]) => mockTxOrganizationUpdate(...args),
        },
        creditTransaction: {
          create: (...args: unknown[]) => mockTxCreditTransactionCreate(...args),
        },
      }),
  },
}));

mock.module("@/lib/stripe", () => ({
  constructWebhookEvent: (...args: unknown[]) => mockConstructWebhookEvent(...args),
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

function resetBillingMocks() {
  orgState = { creditBalance: 20, freeCreditBalance: 8 };
  createdTransactions = [];
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
          payment_intent: "pi_refund",
          amount_refunded: 1250,
        },
      },
    };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    expect(mockCheckoutSessionsList).toHaveBeenCalledWith({
      payment_intent: "pi_refund",
      limit: 1,
    });
    expect(orgState).toEqual({ creditBalance: 15.5, freeCreditBalance: 0 });
    expect(createdTransactions).toEqual([
      {
        amount: -12.5,
        type: "usage",
        description: "Refund — $12.5",
        balanceAfter: 15.5,
        organizationId: "org_1",
      },
    ]);
  });

  it("acknowledges unknown event types without touching credits", async () => {
    currentEvent = { type: "customer.created", data: { object: { id: "cus_123" } } };

    const response = await POST(stripeRequest() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(createdTransactions).toEqual([]);
  });
});
