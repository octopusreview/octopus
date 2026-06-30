"use client";

import { useActionState, useRef } from "react";
import Link from "@/components/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toggleLiveTelemetry } from "../../actions";

export function LiveTelemetrySwitch({
  canManage,
  enabled,
  paid,
}: {
  canManage: boolean;
  enabled: boolean;
  paid: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(toggleLiveTelemetry, {});

  // Unpaid orgs can never enable it; the control is locked with an upsell.
  const switchDisabled = !paid || !canManage || pending;
  const checked = paid && enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Activity</CardTitle>
        <CardDescription>
          When enabled, your organization&apos;s admins can see a real-time view
          of which members and agents are connected and what they&apos;re doing.
          Members are shown a notice and can opt out of being tracked. Only
          coarse activity (e.g. which area of the app) is recorded — never file
          contents, PR titles, or message text.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="enabled" value={checked ? "false" : "true"} />
          <div className="flex items-center justify-between">
            <Label htmlFor="live-telemetry" className="flex flex-col gap-1">
              <span className="font-medium">
                {checked ? "Live activity is on" : "Live activity is off"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {checked
                  ? "Presence and activity are being collected for this organization."
                  : "No presence or activity is collected."}
              </span>
            </Label>
            <Switch
              id="live-telemetry"
              checked={checked}
              disabled={switchDisabled}
              onCheckedChange={() => formRef.current?.requestSubmit()}
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive mt-3">{state.error}</p>
          )}

          {!paid && (
            <p className="text-muted-foreground text-xs mt-3">
              Live activity is a paid feature.{" "}
              <Link href="/settings/billing" className="underline hover:text-foreground">
                Upgrade your plan
              </Link>{" "}
              to enable it.
            </p>
          )}

          {paid && !canManage && (
            <p className="text-muted-foreground text-xs mt-3">
              Only organization owners and admins can change this setting.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
