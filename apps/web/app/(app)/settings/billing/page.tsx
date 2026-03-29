import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getOrgMonthlySpend } from "@/lib/cost";
import { getCustomerPaymentMethods } from "@/lib/stripe";
import { BillingSettings } from "./billing-settings";

export default async function BillingPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          creditBalance: true,
          freeCreditBalance: true,
          billingEmail: true,
          monthlySpendLimitUsd: true,
          stripeCustomerId: true,
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const org = member.organization;
  const isOwner = member.role === "owner" || member.role === "admin";

  const [autoReloadConfig, transactions, monthlySpend, paymentMethods] = await Promise.all([
    prisma.autoReloadConfig.findUnique({
      where: { organizationId: org.id },
    }),
    prisma.creditTransaction.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getOrgMonthlySpend(org.id),
    org.stripeCustomerId
      ? getCustomerPaymentMethods(org.stripeCustomerId)
      : Promise.resolve([]),
  ]);

  return (
    <BillingSettings
      key={org.id}
      isOwner={isOwner}
      orgId={org.id}
      creditBalance={Number(org.creditBalance)}
      freeCreditBalance={Number(org.freeCreditBalance)}
      billingEmail={org.billingEmail}
      monthlySpendLimitUsd={org.monthlySpendLimitUsd}
      stripeCustomerId={org.stripeCustomerId}
      autoReloadConfig={
        autoReloadConfig
          ? {
              enabled: autoReloadConfig.enabled,
              thresholdAmount: Number(autoReloadConfig.thresholdAmount),
              reloadAmount: Number(autoReloadConfig.reloadAmount),
            }
          : null
      }
      initialTransactions={transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        type: t.type,
        description: t.description,
        receiptUrl: t.receiptUrl,
        balanceAfter: Number(t.balanceAfter),
        createdAt: t.createdAt.toISOString(),
      }))}
      monthlySpend={monthlySpend}
      paymentMethods={paymentMethods}
    />
  );
}
