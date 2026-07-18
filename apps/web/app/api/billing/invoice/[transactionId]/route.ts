import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { renderInvoicePdf, invoiceNumber } from "@/lib/invoice";
import { INVOICEABLE_TXN_TYPES } from "@/lib/plans";

export const runtime = "nodejs";

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
      organization: { select: { name: true, billingEmail: true } },
    },
  });

  // Caller must be a member of the transaction's org. A missing transaction
  // and one belonging to another org return the SAME 404 — a distinct 403
  // would confirm the id exists, leaking transaction existence to a prober.
  const member = txn
    ? await prisma.organizationMember.findFirst({
        where: {
          organizationId: txn.organizationId,
          userId: session.user.id,
          deletedAt: null,
        },
        select: { id: true },
      })
    : null;

  if (!txn || !member) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  if (!INVOICEABLE_TXN_TYPES.includes(txn.type)) {
    return NextResponse.json({ error: "No receipt for this transaction" }, { status: 400 });
  }

  const pdf = await renderInvoicePdf({
    transactionId: txn.id,
    createdAt: txn.createdAt,
    amountUsd: Math.abs(Number(txn.amount)),
    description: txn.description ?? "Credit purchase",
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
