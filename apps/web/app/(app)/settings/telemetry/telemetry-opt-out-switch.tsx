"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toggleTelemetryOptOut } from "../../actions";

/**
 * Per-member opt-out from live telemetry. Available to every member (it's their
 * own privacy choice). Shown only when the org has live telemetry active.
 */
export function TelemetryOptOutSwitch({ optedOut }: { optedOut: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(!optedOut); // "Include me" = NOT opted out
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your visibility</CardTitle>
        <CardDescription>
          Your organization has live activity monitoring enabled. While it&apos;s
          on, your admins can see when you&apos;re online and a coarse view of
          which area of the app you&apos;re in (never file contents, PR titles,
          or message text). You can opt out of being included at any time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="telemetry-opt-in" className="flex flex-col gap-1">
            <span className="font-medium">
              {checked ? "You're included" : "You've opted out"}
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              {checked
                ? "Your presence and activity are visible to your org's admins."
                : "No presence or activity is collected for or attributed to you."}
            </span>
          </Label>
          <Switch
            id="telemetry-opt-in"
            checked={checked}
            disabled={isPending}
            onCheckedChange={(next) => {
              setChecked(next);
              setError(null);
              startTransition(async () => {
                const res = await toggleTelemetryOptOut(!next);
                if (res?.error) {
                  setChecked(!next); // revert on failure
                  setError(res.error);
                }
              });
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
      </CardContent>
    </Card>
  );
}
