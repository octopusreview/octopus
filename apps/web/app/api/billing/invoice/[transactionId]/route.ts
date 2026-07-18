import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { renderInvoicePdf, invoiceNumber } from "@/lib/invoice";

export const runtime = "nodejs";

// Only real payments get a receipt — usage/free_credit/coupon rows are not
// invoiceable (and refund rows are negative).
const INVOICEABLE_TYPES = ["purchase", "auto_reload", "subscription"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transactionId } = await params;

  const txn = await prisma.creditTransaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      amount: true,
      type: true,
      description: true,
      createdAt: true,
      organizationId: true,
      organization: { select: { name: true, slug: true, billingEmail: true } },
    },
  });

  if (!txn) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // Caller must be a member of the transaction's org (any role can view a
  // receipt for their own org).
  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: txn.organizationId,
      userId: session.user.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!INVOICEABLE_TYPES.includes(txn.type)) {
    return NextResponse.json({ error: "No receipt for this transaction" }, { status: 400 });
  }

  const pdf = await renderInvoicePdf({
    transactionId: txn.id,
    createdAt: txn.createdAt,
    amountUsd: Math.abs(Number(txn.amount)),
    description: txn.description ?? "Credit purchase",
    type: txn.type,
    org: txn.organization,
  });

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceNumber(txn.id)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
