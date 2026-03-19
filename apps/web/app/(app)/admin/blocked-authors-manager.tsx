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
import { updateGlobalBlockedAuthors } from "./model-actions";

export function BlockedAuthorsManager({
  initialAuthors,
}: {
  initialAuthors: string[];
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

      const result = await updateGlobalBlockedAuthors(list);
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
        <CardTitle className="text-base">Global Blocked Authors</CardTitle>
        <CardDescription>
          PR authors listed here will never trigger auto-review on any
          organization, even when mentioned with @octopus. Applies
          platform-wide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Blocked authors</Label>
          <Input
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
            placeholder="e.g. dependabot[bot], renovate[bot], snyk-bot"
            className="h-8"
          />
          <p className="text-[10px] text-muted-foreground">
            Comma-separated. Use the exact GitHub/Bitbucket username (e.g.
            dependabot[bot]).
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && <p className="text-xs text-green-600">Saved.</p>}

        <Button
          size="sm"
          className="h-7"
          disabled={pending}
          onClick={handleSave}
        >
          {pending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
