"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { createCheckoutSession, getStripe } from "@/lib/stripe";

async function getOwnerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return { error: "Only organization owners and admins can manage billing." };
  }

  return { orgId };
}

export async function purchaseCredits(
  amount: number,
): Promise<{ url?: string; error?: string }> {
  if (typeof amount !== "number" || amount < 5 || amount > 1000) {
    return { error: "Amount must be between $5 and $1,000." };
  }

  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const url = await createCheckoutSession(
    result.orgId,
    amount,
    `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/settings/billing`,
  );

  return { url };
}

export async function updateAutoReload(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const enabled = formData.get("enabled") === "true";
  const thresholdAmount = Number(formData.get("thresholdAmount"));
  const reloadAmount = Number(formData.get("reloadAmount"));

  if (enabled && (isNaN(thresholdAmount) || thresholdAmount < 1)) {
    return { error: "Threshold must be at least $1." };
  }

  if (enabled && (isNaN(reloadAmount) || reloadAmount < 5)) {
    return { error: "Reload amount must be at least $5." };
  }

  await prisma.autoReloadConfig.upsert({
    where: { organizationId: result.orgId },
    create: {
      organizationId: result.orgId,
      enabled,
      thresholdAmount: thresholdAmount || 10,
      reloadAmount: reloadAmount || 50,
    },
    update: {
      enabled,
      thresholdAmount: thresholdAmount || 10,
      reloadAmount: reloadAmount || 50,
    },
  });

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function updateBillingEmail(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const billingEmail = (formData.get("billingEmail") as string)?.trim() || null;

  if (billingEmail && !billingEmail.includes("@")) {
    return { error: "Invalid email address." };
  }

  const org = await prisma.organization.update({
    where: { id: result.orgId },
    data: { billingEmail },
    select: { stripeCustomerId: true },
  });

  // Sync email to Stripe customer
  if (org.stripeCustomerId && billingEmail) {
    await getStripe().customers.update(org.stripeCustomerId, {
      email: billingEmail,
    }).catch((err) => console.error("[billing] Failed to update Stripe email:", err));
  }

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function updateSpendLimit(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const raw = formData.get("monthlySpendLimitUsd") as string;
  const monthlySpendLimitUsd = raw ? Number(raw) : null;

  if (monthlySpendLimitUsd !== null && (isNaN(monthlySpendLimitUsd) || monthlySpendLimitUsd < 0)) {
    return { error: "Invalid spend limit." };
  }

  await prisma.organization.update({
    where: { id: result.orgId },
    data: { monthlySpendLimitUsd },
  });

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function loadMoreTransactions(
  orgId: string,
  offset: number,
  limit: number = 20,
): Promise<
  {
    id: string;
    amount: number;
    type: string;
    description: string | null;
    receiptUrl: string | null;
    balanceAfter: number;
    createdAt: string;
  }[]
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return [];

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
  });

  if (!member) return [];

  const rows = await prisma.creditTransaction.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit,
  });

  return rows.map((t) => ({
    id: t.id,
    amount: Number(t.amount),
    type: t.type,
    description: t.description,
    receiptUrl: t.receiptUrl,
    balanceAfter: Number(t.balanceAfter),
    createdAt: t.createdAt.toISOString(),
  }));
}
