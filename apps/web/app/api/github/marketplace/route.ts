import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";

function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

interface MarketplacePurchasePayload {
  action:
    | "purchased"
    | "cancelled"
    | "changed"
    | "pending_change"
    | "pending_change_cancelled";
  effective_date: string;
  sender: { login: string; id: number };
  marketplace_purchase: {
    account: {
      type: string; // "Organization" | "User"
      id: number;
      login: string;
      email: string | null;
    };
    billing_cycle: string; // "monthly" | "yearly"
    unit_count: number;
    on_free_trial: boolean;
    free_trial_ends_on: string | null;
    next_billing_date: string | null;
    plan: {
      id: number;
      name: string;
      description: string;
      monthly_price_in_cents: number;
      yearly_price_in_cents: number;
      price_model: string; // "flat-rate" | "per-unit" | "free"
      has_free_trial: boolean;
      unit_name: string | null;
      bullets: string[];
    };
  };
  previous_marketplace_purchase?: {
    account: { type: string; id: number; login: string };
    plan: { id: number; name: string };
  };
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload: MarketplacePurchasePayload = JSON.parse(body);
  const { action, marketplace_purchase: purchase } = payload;
  const account = purchase.account;
  const plan = purchase.plan;

  console.log(
    `[github-marketplace] action=${action} account=${account.login} (${account.id}) plan=${plan.name} (${plan.id}) free_trial=${purchase.on_free_trial}`,
  );

  // Try to find org by marketplace account ID first, then by slug
  let org: { id: string } | null = await prisma.organization.findUnique({
    where: { githubMarketplaceAccountId: account.id },
    select: { id: true },
  });

  if (!org) {
    // First-time marketplace purchase: try to match by org slug
    // GitHub account login often matches the org slug
    org = await prisma.organization.findFirst({
      where: {
        slug: account.login.toLowerCase(),
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  switch (action) {
    case "purchased": {
      if (org) {
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            githubMarketplaceAccountId: account.id,
            githubMarketplacePlanId: plan.id,
            githubMarketplacePlanName: plan.name,
            githubMarketplaceOnFreeTrial: purchase.on_free_trial,
            githubMarketplaceFreeTrialEndsOn: purchase.free_trial_ends_on
              ? new Date(purchase.free_trial_ends_on)
              : null,
          },
        });
        console.log(
          `[github-marketplace] Org ${org.id} linked to marketplace plan "${plan.name}"`,
        );
      } else {
        // No matching org found — log for manual resolution
        console.warn(
          `[github-marketplace] No org found for account ${account.login} (${account.id}). Plan: ${plan.name}. Manual linking may be required.`,
        );
      }
      break;
    }

    case "changed": {
      if (org) {
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            githubMarketplacePlanId: plan.id,
            githubMarketplacePlanName: plan.name,
            githubMarketplaceOnFreeTrial: purchase.on_free_trial,
            githubMarketplaceFreeTrialEndsOn: purchase.free_trial_ends_on
              ? new Date(purchase.free_trial_ends_on)
              : null,
          },
        });
        console.log(
          `[github-marketplace] Org ${org.id} plan changed to "${plan.name}"`,
        );
      }
      break;
    }

    case "cancelled": {
      if (org) {
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            githubMarketplacePlanId: null,
            githubMarketplacePlanName: null,
            githubMarketplaceOnFreeTrial: false,
            githubMarketplaceFreeTrialEndsOn: null,
          },
        });
        console.log(
          `[github-marketplace] Org ${org.id} marketplace plan cancelled`,
        );
      }
      break;
    }

    case "pending_change": {
      // A plan change is scheduled but not yet effective
      // Log it; actual change will come via "changed" action
      console.log(
        `[github-marketplace] Pending plan change for account ${account.login}: ${plan.name} (effective: ${payload.effective_date})`,
      );
      break;
    }

    case "pending_change_cancelled": {
      console.log(
        `[github-marketplace] Pending plan change cancelled for account ${account.login}`,
      );
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
