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
import { updateUserName } from "../actions";

export function UserNameForm({ currentName }: { currentName: string }) {
  const [state, formAction, pending] = useActionState(updateUserName, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your personal account details.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Display name</Label>
              <div className="flex gap-3">
                <Input
                  id="user-name"
                  name="name"
                  defaultValue={currentName}
                  placeholder="e.g. John"
                  required
                  minLength={2}
                  maxLength={100}
                  className="max-w-xs"
                />
                <Button type="submit" disabled={pending} size="sm">
                  {pending ? "Saving..." : "Save"}
                </Button>
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              {state.success && (
                <p className="text-sm text-green-600">Updated successfully.</p>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
