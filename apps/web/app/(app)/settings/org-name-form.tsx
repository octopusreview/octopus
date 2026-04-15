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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrganizationName } from "../actions";

export function OrgNameForm({
  currentName,
  isOwner,
}: {
  currentName: string;
  isOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationName, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Organization details and preferences.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization name</Label>
              <div className="flex gap-3">
                <Input
                  id="name"
                  name="name"
                  defaultValue={currentName}
                  placeholder="Acme Inc."
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={!isOwner}
                  className="max-w-xs"
                />
                <Button type="submit" disabled={pending || !isOwner} size="sm">
                  {pending ? "Saving..." : "Save"}
                </Button>
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              {state.success && (
                <p className="text-sm text-green-600">Updated successfully.</p>
              )}
              {!isOwner && (
                <p className="text-muted-foreground text-xs">
                  Only owners can change the organization name.
                </p>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
