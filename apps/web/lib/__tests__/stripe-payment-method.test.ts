import { beforeEach, describe, expect, it, mock } from "bun:test";

let mockCustomerRetrieve = mock(() => Promise.resolve({ deleted: false } as never));
let mockPaymentMethodRetrieve = mock(() => Promise.resolve({} as never));
let mockPaymentMethodList = mock(() => Promise.resolve({ data: [] } as never));

const stripeClient = {
  customers: {
    retrieve: (...args: unknown[]) => mockCustomerRetrieve(...args),
  },
  paymentMethods: {
    retrieve: (...args: unknown[]) => mockPaymentMethodRetrieve(...args),
    list: (...args: unknown[]) => mockPaymentMethodList(...args),
  },
};

mock.module("server-only", () => ({}));

const { resolveOffSessionCardPaymentMethodId } = await import("@/lib/stripe-payment-method");

function resolveCard(customerId: string) {
  return resolveOffSessionCardPaymentMethodId(stripeClient as never, customerId);
}

beforeEach(() => {
  mockCustomerRetrieve = mock(() => Promise.resolve({ deleted: false } as never));
  mockPaymentMethodRetrieve = mock(() => Promise.resolve({} as never));
  mockPaymentMethodList = mock(() => Promise.resolve({ data: [] } as never));
});

describe("off-session card resolution", () => {
  it("retrieves a string default and accepts it only when it is this customer's card", async () => {
    mockCustomerRetrieve = mock(() =>
      Promise.resolve({
        deleted: false,
        invoice_settings: { default_payment_method: "pm_default" },
      } as never),
    );
    mockPaymentMethodRetrieve = mock(() =>
      Promise.resolve({ id: "pm_default", type: "card", customer: "cus_1" } as never),
    );

    await expect(resolveCard("cus_1")).resolves.toBe("pm_default");

    expect(mockPaymentMethodRetrieve).toHaveBeenCalledWith("pm_default");
    expect(mockPaymentMethodList).not.toHaveBeenCalled();
  });

  it("falls back to one attached card when the default is non-card or belongs elsewhere", async () => {
    mockCustomerRetrieve = mock(() =>
      Promise.resolve({
        deleted: false,
        invoice_settings: { default_payment_method: "pm_bank" },
      } as never),
    );
    mockPaymentMethodRetrieve = mock(() =>
      Promise.resolve({ id: "pm_bank", type: "us_bank_account", customer: "cus_1" } as never),
    );
    mockPaymentMethodList = mock(() =>
      Promise.resolve({ data: [{ id: "pm_card", type: "card", customer: "cus_1" }] } as never),
    );

    await expect(resolveCard("cus_1")).resolves.toBe("pm_card");

    expect(mockPaymentMethodList).toHaveBeenCalledWith({
      customer: "cus_1",
      type: "card",
      limit: 1,
    });
  });

  it("propagates a Stripe outage instead of misreporting it as no saved card", async () => {
    mockCustomerRetrieve = mock(() =>
      Promise.resolve({
        deleted: false,
        invoice_settings: { default_payment_method: "pm_default" },
      } as never),
    );
    mockPaymentMethodRetrieve = mock(() => Promise.reject(new Error("stripe unavailable")));

    await expect(resolveCard("cus_1")).rejects.toThrow("stripe unavailable");
    expect(mockPaymentMethodList).not.toHaveBeenCalled();
  });
});
