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
import { toggleReviewsPaused } from "../../actions";

export function ReviewsPausedSwitch({
  isOwner,
  paused,
}: {
  isOwner: boolean;
  paused: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(toggleReviewsPaused, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pause All Reviews</CardTitle>
        <CardDescription>
          When enabled, all automatic and triggered reviews will be paused
          across every repository in this organization. Incoming webhooks will
          be silently ignored until reviews are resumed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="paused" value={paused ? "false" : "true"} />
          <div className="flex items-center justify-between">
            <Label htmlFor="reviews-paused" className="flex flex-col gap-1">
              <span className="font-medium">
                {paused ? "Reviews are paused" : "Reviews are active"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {paused
                  ? "No reviews will be processed until you resume them."
                  : "Reviews are being processed normally."}
              </span>
            </Label>
            <Switch
              id="reviews-paused"
              checked={paused}
              disabled={!isOwner || pending}
              onCheckedChange={() => formRef.current?.requestSubmit()}
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive mt-3">{state.error}</p>
          )}

          {!isOwner && (
            <p className="text-muted-foreground text-xs mt-3">
              Only owners and admins can pause or resume reviews.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
