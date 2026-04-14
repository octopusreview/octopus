"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  IconPlus,
  IconTrash,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { createCoupon, toggleCouponActive, deleteCoupon } from "./actions";

interface CouponItem {
  id: string;
  code: string;
  description: string | null;
  creditAmount: number;
  maxRedemptions: number | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  redemptionCount: number;
}

interface Props {
  coupons: CouponItem[];
}

function getStatusBadge(coupon: CouponItem) {
  if (!coupon.isActive) {
    return <Badge variant="secondary">Inactive</Badge>;
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return (
      <Badge variant="destructive" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        Expired
      </Badge>
    );
  }
  if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
    return <Badge variant="secondary">Fully Used</Badge>;
  }
  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
      Active
    </Badge>
  );
}

export function CouponsAdmin({ coupons }: Props) {
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const filteredCoupons = search
    ? coupons.filter(
        (c) =>
          c.code.toLowerCase().includes(search.toLowerCase()) ||
          c.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : coupons;

  const handleCreate = (formData: FormData) => {
    startTransition(async () => {
      const result = await createCoupon(formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Coupon created");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Create Coupon */}
      <Card>
        <CardHeader>
          <CardTitle>Create Coupon</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  name="code"
                  placeholder="e.g. WELCOME50"
                  required
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creditAmount">Credit Amount ($)</Label>
                <Input
                  id="creditAmount"
                  name="creditAmount"
                  type="number"
                  min={0.01}
                  step={0.01}
                  placeholder="e.g. 50"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maxRedemptions">
                  Max Redemptions{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="maxRedemptions"
                  name="maxRedemptions"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiresAt">
                  Expiry Date{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="expiresAt"
                  name="expiresAt"
                  type="datetime-local"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                Description{" "}
                <span className="text-muted-foreground font-normal">(internal note)</span>
              </Label>
              <Input
                id="description"
                name="description"
                placeholder="e.g. Welcome campaign Q2 2026"
              />
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <IconLoader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <IconPlus className="mr-1 size-4" />
              )}
              Create Coupon
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Coupon List */}
      <Card>
        <CardHeader>
          <CardTitle>Coupons ({coupons.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search coupons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="space-y-2">
            {filteredCoupons.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No coupons found
              </p>
            )}
            {filteredCoupons.map((coupon) => (
              <div
                key={coupon.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-bold">{coupon.code}</code>
                    {getStatusBadge(coupon)}
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">
                      ${coupon.creditAmount.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      Used: {coupon.redemptionCount}
                      {coupon.maxRedemptions
                        ? ` / ${coupon.maxRedemptions}`
                        : " / unlimited"}
                    </span>
                    {coupon.expiresAt && (
                      <span>
                        Expires:{" "}
                        {new Date(coupon.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                    {coupon.description && (
                      <span className="truncate max-w-48">
                        {coupon.description}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await toggleCouponActive(coupon.id);
                        if (result.error) toast.error(result.error);
                        else
                          toast.success(
                            coupon.isActive
                              ? "Coupon deactivated"
                              : "Coupon activated",
                          );
                      })
                    }
                    title={coupon.isActive ? "Deactivate" : "Activate"}
                  >
                    {coupon.isActive ? (
                      <IconPlayerPause className="size-4" />
                    ) : (
                      <IconPlayerPlay className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteCoupon(coupon.id);
                        if (result.error) toast.error(result.error);
                        else toast.success("Coupon deleted");
                      })
                    }
                    title="Delete"
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
