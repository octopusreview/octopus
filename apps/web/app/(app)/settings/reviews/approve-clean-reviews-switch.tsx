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
import { toggleApproveCleanReviews } from "../../actions";

export function ApproveCleanReviewsSwitch({
  isOwner,
  enabled,
}: {
  isOwner: boolean;
  enabled: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(toggleApproveCleanReviews, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approve Clean Reviews</CardTitle>
        <CardDescription>
          When enabled, Octopus posts an approving GitHub review when a review
          finds nothing. A first review approves when it surfaces zero findings
          and the input coverage is complete. A re-review approves when it
          surfaces zero new findings and every earlier inline comment is
          outdated or has a reply. The approval counts toward the required
          approving reviews of a branch rule, and an author who replies to
          every finding gets an approval. GitHub only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <div className="flex items-center justify-between">
            <Label htmlFor="approve-clean-reviews" className="flex flex-col gap-1">
              <span className="font-medium">
                {enabled ? "Clean reviews approve" : "Clean reviews comment"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {enabled
                  ? "A review with no findings is posted as an APPROVE review."
                  : "A review with no findings is posted as a COMMENT review."}
              </span>
            </Label>
            <Switch
              id="approve-clean-reviews"
              checked={enabled}
              disabled={!isOwner || pending}
              onCheckedChange={() => formRef.current?.requestSubmit()}
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive mt-3">{state.error}</p>
          )}

          {!isOwner && (
            <p className="text-muted-foreground text-xs mt-3">
              Only owners and admins can change review approval.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
