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
import { updateQueueConfig, type QueueConfig } from "./model-actions";

export function QueueConfigManager({
  initialConfig,
}: {
  initialConfig: QueueConfig;
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [timeoutSeconds, setTimeoutSeconds] = useState(initialConfig.reviewTimeoutSeconds);
  const [concurrency, setConcurrency] = useState(initialConfig.reviewConcurrency);

  const handleSave = () => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await updateQueueConfig({
        reviewTimeoutSeconds: timeoutSeconds,
        reviewConcurrency: concurrency,
      });
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
        <CardTitle className="text-base">Queue Configuration</CardTitle>
        <CardDescription>
          Review queue timeout and concurrency settings. Changes apply to new jobs after service restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Review timeout (seconds)</Label>
            <Input
              type="number"
              min={60}
              max={3600}
              step={60}
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">
              Max time a single review job can run before being marked as expired (60-3600s)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Review concurrency</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="h-8"
            />
            <p className="text-[10px] text-muted-foreground">
              Number of reviews that can run in parallel per container (1-10)
            </p>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && <p className="text-xs text-green-600">Saved.</p>}

        <Button size="sm" className="h-7" disabled={pending} onClick={handleSave}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
