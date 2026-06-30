"use client";

import { useActionState, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toggleVendorMemberVisibility } from "../../actions";

/**
 * Org owner opt-in to vendor (Octopus staff) member-level visibility — separate
 * from enabling internal monitoring. Off by default; owner-only.
 */
export function VendorVisibilitySwitch({
  isOwner,
  allowed,
}: {
  isOwner: boolean;
  allowed: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(toggleVendorMemberVisibility, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor visibility</CardTitle>
        <CardDescription>
          By default, Octopus staff only ever see anonymous, org-level totals
          (counts and activity volume) for support and reliability. Turn this on
          to additionally let Octopus staff see your members&apos; names in their
          cross-org view. Most organizations leave this off.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="allowed" value={allowed ? "false" : "true"} />
          <div className="flex items-center justify-between">
            <Label htmlFor="vendor-visibility" className="flex flex-col gap-1">
              <span className="font-medium">
                {allowed ? "Vendor can see member names" : "Aggregates only"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {allowed
                  ? "Octopus staff may see member names in their cross-org console."
                  : "Octopus staff see only anonymous totals for your organization."}
              </span>
            </Label>
            <Switch
              id="vendor-visibility"
              checked={allowed}
              disabled={!isOwner || pending}
              onCheckedChange={() => formRef.current?.requestSubmit()}
            />
          </div>

          {state.error && <p className="text-sm text-destructive mt-3">{state.error}</p>}

          {!isOwner && (
            <p className="text-muted-foreground text-xs mt-3">
              Only the organization owner can change vendor visibility.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
