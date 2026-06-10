"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { updateCheckFailureThreshold } from "../../actions";

const thresholdOptions = [
  {
    value: "critical",
    label: "Critical only",
    description: "Only critical findings will mark the check as failed.",
    emoji: "🔴",
  },
  {
    value: "high",
    label: "High & Critical",
    description: "Critical or high severity findings will mark the check as failed.",
    emoji: "🟠",
  },
  {
    value: "medium",
    label: "Medium & above",
    description: "Critical, high, or medium severity findings will mark the check as failed.",
    emoji: "🟡",
  },
  {
    value: "none",
    label: "Never fail",
    description: "The check will always pass regardless of findings.",
    emoji: "✅",
  },
];

export function ReviewSettingsForm({
  isOwner,
  currentThreshold,
}: {
  isOwner: boolean;
  currentThreshold: string;
}) {
  const [state, formAction, pending] = useActionState(updateCheckFailureThreshold, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check Failure Threshold</CardTitle>
        <CardDescription>
          Control which severity levels cause the GitHub check run to show as failed.
          This affects whether the PR is blocked by branch protection rules.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <fieldset disabled={!isOwner || pending} className="space-y-3">
            {thresholdOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="threshold"
                  value={option.value}
                  defaultChecked={currentThreshold === option.value}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Label className="cursor-pointer font-medium">
                      {option.emoji} {option.label}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {option.description}
                  </p>
                </div>
              </label>
            ))}
          </fieldset>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.success && (
            <p className="text-sm text-green-600">Threshold updated.</p>
          )}

          <Button
            type="submit"
            disabled={pending || !isOwner}
            className="w-full"
            size="sm"
          >
            {pending ? "Saving..." : "Save"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners and admins can change review settings.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
