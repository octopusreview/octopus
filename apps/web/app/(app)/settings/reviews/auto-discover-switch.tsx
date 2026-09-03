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
import { toggleAutoDiscoverRepos } from "../../actions";

export function AutoDiscoverSwitch({
  isOwner,
  enabled,
}: {
  isOwner: boolean;
  enabled: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(toggleAutoDiscoverRepos, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatically add new repositories</CardTitle>
        <CardDescription>
          New repositories in your connected GitHub, GitLab and Bitbucket
          accounts are added to Octopus on their own: instantly for GitHub, and
          within an hour for every provider. Turn this off to add them yourself
          with the Sync button.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-discover-repos" className="flex flex-col gap-1">
              <span className="font-medium">
                {enabled ? "Discovery is on" : "Discovery is off"}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {enabled
                  ? "New repositories are picked up automatically."
                  : "New repositories appear only after you click Sync."}
              </span>
            </Label>
            <Switch
              id="auto-discover-repos"
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
              Only owners and admins can change repository discovery.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
