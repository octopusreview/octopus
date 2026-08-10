"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { purchaseCredits } from "./actions";
import { volumeBonusUsd } from "@/lib/plans";

const PRESETS = [50, 100, 250, 500];

export function PurchaseDialog({
  open,
  onOpenChange,
  card,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saved card to charge. `null` = none on file; omit if unknown. */
  card?: { brand: string; last4: string } | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | "">(25);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handlePurchase = () => {
    if (!amount || amount < 5 || amount > 1000) {
      setError("Amount must be between $5 and $1,000.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await purchaseCredits(amount);
      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        // Charged the saved card in-app — celebrate, close, and refresh the balance.
        const total = amount + volumeBonusUsd(amount);
        toast.success("Credits added", {
          description: `$${total.toFixed(2)} in credits added to your balance.`,
        });
        // Honor reduced-motion: the toast already confirms success; skip the burst.
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.7 } });
        }
        onOpenChange(false);
        router.refresh();
      } else if (result.url) {
        window.location.href = result.url;
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Purchase Credits</DialogTitle>
          <DialogDescription>
            Buy more, get more — up to 70% bonus credits. Select an amount or
            enter a custom value. Credits are non-refundable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((preset) => {
              const pct = Math.round((volumeBonusUsd(preset) / preset) * 100);
              return (
                <Button
                  key={preset}
                  variant={amount === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setAmount(preset);
                    setError(null);
                  }}
                  className="flex h-auto flex-col gap-0.5 py-2"
                >
                  <span>${preset}</span>
                  {pct > 0 && (
                    <span
                      className={`text-[10px] font-medium ${
                        amount === preset
                          ? "text-primary-foreground/80"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      +{pct}%
                    </span>
                  )}
                </Button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-amount">Custom Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="custom-amount"
                type="number"
                min={5}
                max={1000}
                step={1}
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  setAmount(val === "" ? "" : Number(val));
                  setError(null);
                }}
                className="pl-7"
                placeholder="Enter amount"
              />
            </div>
            <p className="text-xs text-muted-foreground">Min $5, max $1,000</p>
          </div>

          {typeof amount === "number" && volumeBonusUsd(amount) > 0 && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              +${volumeBonusUsd(amount).toFixed(2)} bonus credits — you&apos;ll get $
              {(amount + volumeBonusUsd(amount)).toFixed(2)} total.
            </p>
          )}

          {card ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Payment method</span>
              <span className="font-medium capitalize">
                {card.brand} •••• {card.last4}
              </span>
            </div>
          ) : card === null ? (
            <p className="text-xs text-muted-foreground">
              You&apos;ll enter your card securely at checkout.
            </p>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={handlePurchase}
            disabled={pending || !amount}
            className="w-full"
          >
            {pending
              ? "Processing…"
              : typeof amount === "number" && volumeBonusUsd(amount) > 0
                ? `Pay $${amount} → get $${(amount + volumeBonusUsd(amount)).toFixed(2)} credit`
                : `Purchase $${amount || 0} Credits`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
