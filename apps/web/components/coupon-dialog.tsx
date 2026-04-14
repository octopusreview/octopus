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
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { redeemCoupon } from "@/app/(app)/coupon/actions";

export function CouponDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleRedeem = () => {
    if (!code.trim()) {
      setError("Please enter a coupon code");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await redeemCoupon(code);
      if (result.error) {
        setError(result.error);
      } else if (result.success) {
        toast.success(`$${result.amount} credits added to your account!`);
        setCode("");
        setError(null);
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCode("");
          setError(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redeem Coupon</DialogTitle>
          <DialogDescription>
            Enter your coupon code to add credits to your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="coupon-code">Coupon Code</Label>
            <Input
              id="coupon-code"
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) handleRedeem();
              }}
              placeholder="Enter your code"
              autoComplete="off"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={handleRedeem}
            disabled={pending || !code.trim()}
            className="w-full"
          >
            {pending ? (
              <>
                <IconLoader2 className="mr-2 size-4 animate-spin" />
                Redeeming...
              </>
            ) : (
              "Redeem Code"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
