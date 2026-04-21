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
  IconPlus,
  IconExternalLink,
  IconLoader2,
  IconReceipt,
  IconCreditCard,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { PurchaseDialog } from "./purchase-dialog";
import {
  updateAutoReload,
  updateBillingEmail,
  updateSpendLimit,
  loadMoreTransactions,
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
  isOwner: boolean;
  orgId: string;
  creditBalance: number;
  freeCreditBalance: number;
  billingEmail: string | null;
  monthlySpendLimitUsd: number | null;
  stripeCustomerId: string | null;
  autoReloadConfig: {
    enabled: boolean;
    thresholdAmount: number;
    reloadAmount: number;
  } | null;
  initialTransactions: Transaction[];
  totalTransactions: number;
  monthlySpend: number;
  paymentMethods: PaymentMethod[];
};

function formatUsd(n: number): string {
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
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
    default:
      return "";
  }
}

export function BillingSettings({
  isOwner,
  orgId,
  creditBalance,
  freeCreditBalance,
  billingEmail,
  monthlySpendLimitUsd,
  stripeCustomerId,
  autoReloadConfig,
  initialTransactions,
  totalTransactions,
  monthlySpend,
  paymentMethods,
}: Props) {
  const [purchaseOpen, setPurchaseOpen] = useState(false);
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

  const total = creditBalance + freeCreditBalance;

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
      {/* Card 1: Credit Balance */}
      <Card>
        <CardHeader>
          <CardTitle>Credit Balance</CardTitle>
          <CardDescription>
            Your organization&apos;s available credits for AI features.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground mb-1">Free Credits</p>
              <p className="text-2xl font-semibold">{formatUsd(freeCreditBalance)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground mb-1">
                Purchased Credits
              </p>
              <p className="text-2xl font-semibold">{formatUsd(creditBalance)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-muted-foreground">Total Balance: </span>
              <span className="text-sm font-semibold">{formatUsd(total)}</span>
            </div>
            {isOwner && (
              <Button size="sm" onClick={() => setPurchaseOpen(true)}>
                <IconPlus className="size-4 mr-1" />
                Purchase Credits
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Usage Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Summary</CardTitle>
          <CardDescription>Current month AI usage and spend limit.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                This month&apos;s usage
              </span>
              <span className="text-sm font-medium">{formatUsd(monthlySpend)}</span>
            </div>
            <Separator />
            {isOwner ? (
              <form action={spendAction} className="space-y-3">
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
                    Leave empty for no limit. AI features will be paused when
                    the limit is reached.
                  </p>
                </div>
                {spendState.error && (
                  <p className="text-sm text-destructive">{spendState.error}</p>
                )}
                {spendState.success && (
                  <p className="text-sm text-green-600">Spend limit updated.</p>
                )}
                <Button type="submit" size="sm" disabled={spendPending}>
                  {spendPending ? "Saving..." : "Update Limit"}
                </Button>
              </form>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Spend limit</span>
                <span className="text-sm font-medium">
                  {monthlySpendLimitUsd != null
                    ? formatUsd(monthlySpendLimitUsd)
                    : "No limit"}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>
            Manage your payment methods through Stripe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!stripeCustomerId ? (
            <p className="text-sm text-muted-foreground">
              Purchase credits to set up billing.
            </p>
          ) : (
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
              <Button
                variant="outline"
                size="sm"
                onClick={handlePortal}
                disabled={portalLoading || !isOwner}
              >
                {portalLoading ? (
                  <IconLoader2 className="size-4 animate-spin mr-1" />
                ) : (
                  <IconExternalLink className="size-4 mr-1" />
                )}
                Manage Payment Methods
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 4: Transaction History */}
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
                              {t.receiptUrl && (
                                <a
                                  href={t.receiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                                  title="View receipt"
                                >
                                  <IconReceipt className="size-4" />
                                </a>
                              )}
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

      {/* Card 5: Billing Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Settings</CardTitle>
          <CardDescription>
            Configure auto-reload and billing contact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto-reload */}
          <form action={autoReloadAction} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Reload</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically purchase credits when balance is low.
                </p>
              </div>
              <Switch
                checked={autoReloadEnabled}
                onCheckedChange={(checked) => setAutoReloadEnabled(checked)}
                disabled={!isOwner}
              />
            </div>
            <input type="hidden" name="enabled" value={String(autoReloadEnabled)} />

            {autoReloadEnabled && (
              <div className="grid grid-cols-2 gap-4">
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
                      step={1}
                      defaultValue={autoReloadConfig?.thresholdAmount ?? 10}
                      disabled={!isOwner}
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
                      step={1}
                      defaultValue={autoReloadConfig?.reloadAmount ?? 50}
                      disabled={!isOwner}
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

            {autoReloadEnabled && (
              <Button
                type="submit"
                size="sm"
                disabled={autoReloadPending || !isOwner}
              >
                {autoReloadPending ? "Saving..." : "Save Auto-Reload"}
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
                disabled={!isOwner}
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
            <Button type="submit" size="sm" disabled={emailPending || !isOwner}>
              {emailPending ? "Saving..." : "Update Email"}
            </Button>
          </form>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners can manage billing settings.
            </p>
          )}
        </CardContent>
      </Card>

      <PurchaseDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} />
    </div>
  );
}
