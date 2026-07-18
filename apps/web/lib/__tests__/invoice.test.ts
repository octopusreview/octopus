import { describe, expect, it } from "bun:test";
import { renderInvoicePdf, invoiceNumber } from "@/lib/invoice";

describe("invoice", () => {
  it("derives a stable, uppercase invoice number from the transaction id", () => {
    expect(invoiceNumber("clabc123def456")).toBe("OCT-C123DEF456");
    expect(invoiceNumber("x")).toBe("OCT-X");
    // Deterministic — same input, same output.
    expect(invoiceNumber("clabc123def456")).toBe(invoiceNumber("clabc123def456"));
  });

  it("renders a valid PDF buffer", async () => {
    const pdf = await renderInvoicePdf({
      transactionId: "cltest0001",
      createdAt: new Date("2026-07-18T00:00:00Z"),
      amountUsd: 100,
      description: "Credit purchase — $100",
      org: { name: "AOT", billingEmail: "cem@weezboo.com" },
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-8).toString("latin1")).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(800);
  });

  it("renders without a billing email", async () => {
    const pdf = await renderInvoicePdf({
      transactionId: "cltest0002",
      createdAt: new Date("2026-07-18T00:00:00Z"),
      amountUsd: 49,
      description: "Pro plan — $54 credits",
      org: { name: "AOT", billingEmail: null },
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
