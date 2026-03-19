"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { updateOrgBlockedAuthors } from "../../actions";

export function BlockedAuthorsForm({
  isOwner,
  initialAuthors,
  globalAuthors,
}: {
  isOwner: boolean;
  initialAuthors: string[];
  globalAuthors: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [authors, setAuthors] = useState(initialAuthors.join(", "));

  const handleSave = () => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const list = authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const result = await updateOrgBlockedAuthors(list);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked Authors</CardTitle>
        <CardDescription>
          PRs from these authors will not trigger reviews, even when mentioned
          with @octopus. Use this to skip bot PRs or specific users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!isOwner || pending} className="space-y-4">
          {globalAuthors.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Platform-wide blocked (read-only)</Label>
              <div className="flex flex-wrap gap-1.5">
                {globalAuthors.map((author) => (
                  <span
                    key={author}
                    className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {author}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Organization blocked authors</Label>
            <Input
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="e.g. dependabot[bot], renovate[bot]"
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated. Use the exact GitHub/Bitbucket username.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-green-600">Blocked authors saved.</p>}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={pending || !isOwner}
            onClick={handleSave}
          >
            {pending ? "Saving..." : "Save Blocked Authors"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners can change blocked authors.
            </p>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
