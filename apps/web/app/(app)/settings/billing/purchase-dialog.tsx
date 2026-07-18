"use client";

import { useState, useTransition } from "react";
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

const PRESETS = [10, 25, 50, 100];

export function PurchaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
            Select an amount or enter a custom value. Credits are non-refundable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                variant={amount === preset ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setAmount(preset);
                  setError(null);
                }}
              >
                ${preset}
              </Button>
            ))}
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

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={handlePurchase}
            disabled={pending || !amount}
            className="w-full"
          >
            {pending
              ? "Redirecting to Stripe..."
              : `Purchase $${amount || 0} Credits`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
