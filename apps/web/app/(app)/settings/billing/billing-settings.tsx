"use client";

import { useState, useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IconPlus,
  IconExternalLink,
  IconLoader2,
  IconReceipt,
  IconFileInvoice,
  IconCreditCard,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { PurchaseDialog } from "./purchase-dialog";
import { CardSetupDialog } from "./card-setup-dialog";
import {
  getAutoReloadDisplayStatus,
  summarizeMonthlySpend,
} from "@/lib/billing-period";
import { SUBSCRIPTION_PLANS, INVOICEABLE_TXN_TYPES } from "@/lib/plans";
import {
  updateAutoReload,
  updateBillingEmail,
  updateSpendLimit,
  loadMoreTransactions,
  subscribeToPlan,
  setSubscriptionCancel,
  type TransactionDTO,
} from "./actions";

type Transaction = TransactionDTO;

type PaymentMethod = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

type Props = {
  canManageBilling: boolean;
  orgId: string;
  creditBalance: number;
  freeCreditBalance: number;
  billingEmail: string | null;
  monthlySpendLimitUsd: number | null;
  stripeCustomerId: string | null;
  // Read server-side (runtime env) and passed down — NOT read from
  // process.env in the client, where NEXT_PUBLIC_* is inlined at build time
  // and the CI build has no Stripe key (would bake in an empty string).
  stripePublishableKey: string;
  planTier: string;
  planRenewsAt: string | null;
  planCancelAtPeriodEnd: boolean;
  autoReloadConfig: {
    enabled: boolean;
    pausedForDurableUpgrade: boolean;
    thresholdAmount: number;
    reloadAmount: number;
  } | null;
  initialTransactions: Transaction[];
  totalTransactions: number;
  monthlySpend: number;
  monthlyResetLabel: string;
  paymentMethods: PaymentMethod[];
};

function formatUsd(n: number): string {
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(n: number): string {
  if (n > 0 && n < 1) return "<1%";
  return `${Math.round(n)}%`;
}

function typeBadgeVariant(type: string) {
  switch (type) {
    case "purchase":
      return "default" as const;
    case "usage":
      return "secondary" as const;
    case "free_credit":
      return "outline" as const;
    case "auto_reload":
      return "default" as const;
    case "coupon":
      return "outline" as const;
    case "subscription":
      return "default" as const;
    default:
      return "secondary" as const;
  }
}

function typeBadgeClass(type: string) {
  switch (type) {
    case "purchase":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800";
    case "free_credit":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800";
    case "auto_reload":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800";
    case "coupon":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800";
    case "subscription":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800";
    default:
      return "";
  }
}

export function BillingSettings({
  canManageBilling,
  orgId,
  creditBalance,
  freeCreditBalance,
  billingEmail,
  monthlySpendLimitUsd,
  stripeCustomerId,
  stripePublishableKey,
  planTier,
  planRenewsAt,
  planCancelAtPeriodEnd,
  autoReloadConfig,
  initialTransactions,
  totalTransactions,
  monthlySpend,
  monthlyResetLabel,
  paymentMethods,
}: Props) {
  const router = useRouter();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [spendLimitOpen, setSpendLimitOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [hasMore, setHasMore] = useState(initialTransactions.length < totalTransactions);
  const [loadingMore, setLoadingMore] = useState(false);
  const [portalLoading, startPortalTransition] = useTransition();
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const [autoReloadState, autoReloadAction, autoReloadPending] =
    useActionState(updateAutoReload, {});
  const [emailState, emailAction, emailPending] =
    useActionState(updateBillingEmail, {});
  const [spendState, spendAction, spendPending] =
    useActionState(updateSpendLimit, {});

  const [autoReloadEnabled, setAutoReloadEnabled] = useState(
    autoReloadConfig?.enabled ?? false,
  );
  const autoReloadActive = autoReloadConfig?.enabled ?? false;
  const autoReloadPaused = autoReloadConfig?.pausedForDurableUpgrade ?? false;
  const autoReloadStatus = getAutoReloadDisplayStatus(
    autoReloadActive,
    autoReloadPaused,
  );

  const [planPending, startPlanTransition] = useTransition();
  const [planError, setPlanError] = useState<string | null>(null);

  const handleSubscribe = (tier: string) => {
    setPlanError(null);
    // No saved card yet — capture one in-app first, then they subscribe with
    // the card on file (a saved card makes subscribeToPlan charge directly,
    // no Stripe redirect).
    if (paymentMethods.length === 0) {
      setCardOpen(true);
      return;
    }
    startPlanTransition(async () => {
      const res = await subscribeToPlan(tier);
      if (res.error) setPlanError(res.error);
      else if (res.url) window.location.href = res.url;
      // On success the server action revalidates the page.
    });
  };

  const handleCancelToggle = (cancel: boolean) => {
    setPlanError(null);
    startPlanTransition(async () => {
      const res = await setSubscriptionCancel(cancel);
      if (res.error) setPlanError(res.error);
    });
  };

  const total = creditBalance + freeCreditBalance;
  const spendSummary = summarizeMonthlySpend(
    monthlySpend,
    monthlySpendLimitUsd,
  );

  const handleLoadMore = async (): Promise<boolean> => {
    setLoadingMore(true);
    try {
      const more = await loadMoreTransactions(orgId, transactions.length, 20);
      if (more.length > 0) {
        setTransactions((prev) => [...prev, ...more]);
      }
      if (more.length < 20) setHasMore(false);
      return more.length > 0;
    } catch {
      return false;
    } finally {
      setLoadingMore(false);
    }
  };

  const handlePortal = () => {
    startPortalTransition(async () => {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Billing Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Settings</CardTitle>
          <CardDescription>
            Configure auto-reload and billing contact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {autoReloadPaused && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              Auto-reload was paused during the billing safety upgrade. Review
              the amounts and save to re-enable it.
            </div>
          )}
          {/* Auto-reload */}
          <form
            id="auto-reload-settings"
            action={autoReloadAction}
            className="scroll-mt-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Auto-Reload</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically purchase credits when balance is low.
                </p>
              </div>
              <Switch
                checked={autoReloadEnabled}
                onCheckedChange={(checked) => setAutoReloadEnabled(checked)}
                disabled={!canManageBilling}
                aria-label="Enable auto-reload"
              />
            </div>
            <input type="hidden" name="enabled" value={String(autoReloadEnabled)} />
            {!autoReloadEnabled && (
              <>
                <input
                  type="hidden"
                  name="thresholdAmount"
                  value={autoReloadConfig?.thresholdAmount ?? 10}
                />
                <input
                  type="hidden"
                  name="reloadAmount"
                  value={autoReloadConfig?.reloadAmount ?? 50}
                />
              </>
            )}

            {autoReloadEnabled && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="thresholdAmount">
                    When balance falls below
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="thresholdAmount"
                      name="thresholdAmount"
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      defaultValue={autoReloadConfig?.thresholdAmount ?? 10}
                      disabled={!canManageBilling}
                      className="pl-7"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reloadAmount">Reload amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="reloadAmount"
                      name="reloadAmount"
                      type="number"
                      min={5}
                      max={1000}
                      step={1}
                      defaultValue={autoReloadConfig?.reloadAmount ?? 50}
                      disabled={!canManageBilling}
                      className="pl-7"
                    />
                  </div>
                </div>
              </div>
            )}

            {autoReloadState.error && (
              <p className="text-sm text-destructive">
                {autoReloadState.error}
              </p>
            )}
            {autoReloadState.success && (
              <p className="text-sm text-green-600">Auto-reload updated.</p>
            )}

            {canManageBilling && (
              <Button
                type="submit"
                size="sm"
                disabled={autoReloadPending}
              >
                {autoReloadPending
                  ? "Saving..."
                  : !autoReloadEnabled && autoReloadConfig?.enabled
                    ? "Turn Off Auto-Reload"
                    : "Save Auto-Reload"}
              </Button>
            )}
          </form>

          <Separator />

          {/* Billing Email */}
          <form action={emailAction} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="billingEmail">Billing Email</Label>
              <Input
                id="billingEmail"
                name="billingEmail"
                type="email"
                defaultValue={billingEmail ?? ""}
                disabled={!canManageBilling}
                placeholder="billing@company.com"
              />
              <p className="text-xs text-muted-foreground">
                Receipts and billing notifications will be sent to this email.
              </p>
            </div>
            {emailState.error && (
              <p className="text-sm text-destructive">{emailState.error}</p>
            )}
            {emailState.success && (
              <p className="text-sm text-green-600">Billing email updated.</p>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={emailPending || !canManageBilling}
            >
              {emailPending ? "Saving..." : "Update Email"}
            </Button>
          </form>

          {!canManageBilling && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners and admins can manage billing settings.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1">
        <h2
          id="usage-spend-limits-heading"
          className="text-xl font-semibold tracking-tight sm:text-2xl"
        >
          Usage and spend limits
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your organization&apos;s AI usage charges and available credits.
        </p>
      </div>

      <Card
        className="gap-0 py-0"
        role="region"
        aria-labelledby="usage-spend-limits-heading"
      >
        <CardContent className="p-0">
          <div className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-3xl font-semibold tracking-tight">
                  {formatUsd(spendSummary.spendUsd)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Spent this month
                  <span className="px-1.5" aria-hidden="true">
                    ·
                  </span>
                  Resets {monthlyResetLabel}
                </p>
              </div>
              {spendSummary.percentUsed != null ? (
                <p
                  className={`text-sm font-medium ${
                    spendSummary.limitReached ? "text-destructive" : ""
                  }`}
                >
                  {formatPercent(spendSummary.percentUsed)} used
                </p>
              ) : (
                <Badge variant="secondary">Unlimited</Badge>
              )}
            </div>

            {spendSummary.limitUsd != null &&
              spendSummary.progressPercent != null && (
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Monthly spend used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(spendSummary.progressPercent)}
                  aria-valuetext={`${formatUsd(spendSummary.spendUsd)} of ${formatUsd(spendSummary.limitUsd)} used`}
                >
                  <div
                    className={`h-full rounded-full ${
                      spendSummary.limitReached
                        ? "bg-destructive"
                        : "bg-primary"
                    }`}
                    style={{ width: `${spendSummary.progressPercent}%` }}
                  />
                </div>
              )}
          </div>

          <Separator />

          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-medium">
                {spendSummary.limitUsd != null
                  ? `${formatUsd(spendSummary.limitUsd)} monthly spend limit`
                  : "No monthly spend limit"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {spendSummary.remainingUsd != null
                  ? `${formatUsd(spendSummary.remainingUsd)} remaining this month`
                  : "AI usage is not capped for this organization."}
              </p>
            </div>
            {canManageBilling && (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setSpendLimitOpen(true)}
              >
                Adjust limit
              </Button>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-2xl font-semibold tracking-tight">
                {formatUsd(total)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                <span>Current balance</span>
                <span aria-hidden="true">·</span>
                <a
                  href="#auto-reload-settings"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Auto-reload
                </a>
                <Badge
                  variant={autoReloadStatus === "on" ? "default" : "secondary"}
                  className="ml-0.5"
                >
                  {autoReloadStatus === "on"
                    ? "On"
                    : autoReloadStatus === "paused"
                      ? "Paused"
                      : "Off"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Free {formatUsd(freeCreditBalance)} · Purchased{" "}
                {formatUsd(creditBalance)}
              </p>
            </div>
            {canManageBilling && (
              <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => setPurchaseOpen(true)}
                >
                  <IconPlus className="size-4" />
                  Buy usage credits
                </Button>
                <p className="text-center text-xs text-muted-foreground sm:text-right">
                  Up to 70% bonus credits
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card: Subscription */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            Monthly plans charge your saved card and grant bonus credits into
            your balance each month. Credits never expire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.entries(SUBSCRIPTION_PLANS) as [string, { name: string; priceUsd: number; creditsUsd: number }][]).map(
              ([tier, plan]) => {
                const isCurrent = planTier === tier;
                return (
                  <div
                    key={tier}
                    className={`rounded-lg border p-4 space-y-2 ${isCurrent ? "border-primary bg-muted/20" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{plan.name}</p>
                      {isCurrent && <Badge>Current plan</Badge>}
                    </div>
                    <p className="text-2xl font-semibold">
                      ${plan.priceUsd}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      ${plan.creditsUsd} in credits every month (
                      {Math.round(((plan.creditsUsd - plan.priceUsd) / plan.priceUsd) * 100)}%
                      bonus over topping up).
                    </p>
                    {canManageBilling && !isCurrent && (
                      <Button
                        size="sm"
                        disabled={planPending}
                        onClick={() => handleSubscribe(tier)}
                      >
                        {planPending ? (
                          <IconLoader2 className="size-4 mr-1 animate-spin" />
                        ) : (
                          <IconPlus className="size-4 mr-1" />
                        )}
                        {planTier === "free" ? "Subscribe" : "Switch"}
                      </Button>
                    )}
                    {isCurrent && (
                      <p className="text-xs text-muted-foreground">
                        {planCancelAtPeriodEnd
                          ? `Ends ${planRenewsAt ? new Date(planRenewsAt).toLocaleDateString() : "at period end"} — credits keep working.`
                          : `Renews ${planRenewsAt ? new Date(planRenewsAt).toLocaleDateString() : "monthly"}.`}
                      </p>
                    )}
                  </div>
                );
              },
            )}
          </div>
          {planError && <p className="text-sm text-destructive mt-3">{planError}</p>}
          {canManageBilling && stripeCustomerId && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={portalLoading}
                onClick={handlePortal}
              >
                {portalLoading ? (
                  <IconLoader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <IconReceipt className="size-4 mr-1" />
                )}
                View invoices
              </Button>
            </div>
          )}
          {canManageBilling && planTier !== "free" && (
            <div className="mt-4">
              {planCancelAtPeriodEnd ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={planPending}
                  onClick={() => handleCancelToggle(false)}
                >
                  Resume subscription
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={planPending}
                  onClick={() => handleCancelToggle(true)}
                >
                  Cancel at period end
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>
            One card for your subscription, top-ups, and auto-refill.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {paymentMethods.length > 0 ? (
              <div className="space-y-2">
                {paymentMethods.map((pm, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2.5"
                  >
                    <IconCreditCard className="size-5 text-muted-foreground" />
                    <div className="flex-1">
                      <span className="text-sm font-medium capitalize">
                        {pm.brand}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {" "}•••• {pm.last4}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {String(pm.expMonth).padStart(2, "0")}/{pm.expYear}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No saved payment methods.
              </p>
            )}
            {canManageBilling && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setCardOpen(true)}>
                  <IconCreditCard className="size-4 mr-1" />
                  {paymentMethods.length > 0 ? "Replace card" : "Add card"}
                </Button>
                {stripeCustomerId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={handlePortal}
                    disabled={portalLoading}
                  >
                    {portalLoading ? (
                      <IconLoader2 className="size-4 animate-spin mr-1" />
                    ) : (
                      <IconExternalLink className="size-4 mr-1" />
                    )}
                    Manage on Stripe
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>
            Recent credit transactions for this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length > 0 && (() => {
            const types = Array.from(new Set(transactions.map((t) => t.type)));
            const filtered = typeFilter
              ? transactions.filter((t) => t.type === typeFilter)
              : transactions;
            const totalPages = typeFilter
              ? Math.ceil(filtered.length / PAGE_SIZE)
              : Math.ceil(totalTransactions / PAGE_SIZE);
            const page = Math.min(currentPage, totalPages || 1);
            const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            const isLastPage = page >= totalPages;
            const needsMoreForNextPage =
              !typeFilter && page * PAGE_SIZE >= transactions.length && hasMore;

            return (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <Badge
                    variant={typeFilter === null ? "default" : "outline"}
                    className="cursor-pointer text-[11px]"
                    onClick={() => { setTypeFilter(null); setCurrentPage(1); }}
                  >
                    All
                  </Badge>
                  {types.map((type) => (
                    <Badge
                      key={type}
                      variant={typeFilter === type ? "default" : "outline"}
                      className={`cursor-pointer text-[11px] ${typeFilter === type ? typeBadgeClass(type) : ""}`}
                      onClick={() => { setTypeFilter(typeFilter === type ? null : type); setCurrentPage(1); }}
                    >
                      {type}
                    </Badge>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block">
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-3 py-2 font-medium">Date</th>
                          <th className="text-left px-3 py-2 font-medium">Type</th>
                          <th className="text-left px-3 py-2 font-medium">Description</th>
                          <th className="text-right px-3 py-2 font-medium">Amount</th>
                          <th className="text-right px-3 py-2 font-medium">Balance</th>
                          <th className="text-center px-3 py-2 font-medium w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((t) => (
                          <tr key={t.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {t.createdAt.slice(0, 10)}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={typeBadgeVariant(t.type)}
                                className={`text-[10px] font-normal ${typeBadgeClass(t.type)}`}
                              >
                                {t.type}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                              {t.description || "—"}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono whitespace-nowrap ${
                                t.amount >= 0
                                  ? "text-green-600"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {t.amount >= 0 ? "+" : ""}
                              {formatUsd(Math.abs(t.amount))}
                            </td>
                            <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                              {formatUsd(t.balanceAfter)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="inline-flex items-center gap-2">
                                {INVOICEABLE_TXN_TYPES.includes(t.type) && (
                                  <a
                                    href={`/api/billing/invoice/${t.id}`}
                                    className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                                    title="Download invoice PDF"
                                  >
                                    <IconFileInvoice className="size-4" />
                                  </a>
                                )}
                                {t.receiptUrl && (
                                  <a
                                    href={t.receiptUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                                    title="View Stripe receipt"
                                  >
                                    <IconReceipt className="size-4" />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-2">
                  {paged.map((t) => (
                    <div key={t.id} className="rounded-md border p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={typeBadgeVariant(t.type)}
                          className={`text-[10px] font-normal ${typeBadgeClass(t.type)}`}
                        >
                          {t.type}
                        </Badge>
                        <span
                          className={`text-sm font-mono ${
                            t.amount >= 0
                              ? "text-green-600"
                              : "text-muted-foreground"
                          }`}
                        >
                          {t.amount >= 0 ? "+" : ""}
                          {formatUsd(Math.abs(t.amount))}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.description || "—"}
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{t.createdAt.slice(0, 10)}</span>
                        <div className="flex items-center gap-2">
                          {INVOICEABLE_TXN_TYPES.includes(t.type) && (
                            <a
                              href={`/api/billing/invoice/${t.id}`}
                              className="hover:text-foreground transition-colors"
                              title="Download invoice PDF"
                            >
                              <IconFileInvoice className="size-3.5" />
                            </a>
                          )}
                          {t.receiptUrl && (
                            <a
                              href={t.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-foreground transition-colors"
                            >
                              <IconReceipt className="size-3.5" />
                            </a>
                          )}
                          <span>Balance: {formatUsd(t.balanceAfter)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-xs text-muted-foreground">
                      {typeFilter
                        ? `${filtered.length} transaction${filtered.length !== 1 ? "s" : ""}`
                        : `${totalTransactions} transaction${totalTransactions !== 1 ? "s" : ""}`}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1 || loadingMore}
                      >
                        <IconChevronLeft className="size-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground px-2">
                        {page} / {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={async () => {
                          if (needsMoreForNextPage) {
                            const loaded = await handleLoadMore();
                            if (!loaded) return;
                          }
                          setCurrentPage((p) => Math.min(totalPages, p + 1));
                        }}
                        disabled={isLastPage || loadingMore}
                      >
                        {loadingMore ? (
                          <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                          <IconChevronRight className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          {transactions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No transactions yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={spendLimitOpen} onOpenChange={setSpendLimitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust monthly spend limit</DialogTitle>
            <DialogDescription>
              Set the maximum monthly platform-billed AI usage. Leave the field
              empty for no limit.
            </DialogDescription>
          </DialogHeader>
          <form action={spendAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="monthlySpendLimitUsd">
                Monthly Spend Limit (USD)
              </Label>
              <Input
                id="monthlySpendLimitUsd"
                name="monthlySpendLimitUsd"
                type="number"
                min={0}
                step={1}
                defaultValue={monthlySpendLimitUsd ?? ""}
                placeholder="No limit"
              />
              <p className="text-xs text-muted-foreground">
                AI features using platform credits pause when this limit is
                reached.
              </p>
            </div>
            {spendState.error && (
              <p className="text-sm text-destructive" role="alert">
                {spendState.error}
              </p>
            )}
            {spendState.success && (
              <p className="text-sm text-green-600" aria-live="polite">
                Spend limit updated.
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSpendLimitOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={spendPending}>
                {spendPending ? "Saving..." : "Save limit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        card={paymentMethods[0] ?? null}
      />
      <CardSetupDialog
        open={cardOpen}
        onOpenChange={setCardOpen}
        publishableKey={stripePublishableKey}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
