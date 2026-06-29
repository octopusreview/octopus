"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IconLoader2,
  IconCheck,
  IconDownload,
  IconAlertTriangle,
} from "@tabler/icons-react";

type CatalogEntry = {
  name: string;
  displayName: string;
  category: string;
  sizeGb: number;
  ramHint: string;
  blurb: string;
};

type Pull = {
  model: string;
  status: string;
  statusText: string | null;
  progress: number;
  error: string | null;
};

type ModelsResponse = {
  enabled: boolean;
  reachable: boolean;
  installed: string[];
  catalog: CatalogEntry[];
  pulls: Pull[];
};

const POLL_MS = 3000;

export function OllamaModels({ isOwner }: { isOwner: boolean }) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/models");
      if (!res.ok) throw new Error("Failed to load");
      setData((await res.json()) as ModelsResponse);
      setError(null);
    } catch {
      setError("Could not load local models.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a pull is in flight.
  const active =
    data?.pulls.some((p) => p.status === "pulling" || p.status === "queued") ?? false;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  const triggerPull = async (model: string) => {
    try {
      const res = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Failed to start download.");
        return;
      }
      setError(null);
      await load();
    } catch {
      setError("Failed to start download.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local Models (Ollama)</CardTitle>
        <CardDescription>
          Download models to your self-hosted Ollama server so reviews and
          embeddings run entirely on your own hardware.
          {data && data.enabled && !data.reachable && (
            <span className="mt-1 block text-amber-600 dark:text-amber-500">
              Ollama is configured but unreachable — start the service, then reload.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!data ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          (() => {
            const pullByModel = new Map(data.pulls.map((p) => [p.model, p]));
            const installed = new Set(data.installed);
            return data.catalog.map((entry) => {
              const pull = pullByModel.get(entry.name);
              // Ollama's /api/tags reports untagged models as "<name>:latest",
              // so match both forms (a model pulled outside this UI still shows
              // as installed).
              const isInstalled =
                installed.has(entry.name) ||
                installed.has(`${entry.name}:latest`) ||
                pull?.status === "completed";
              const isPulling = pull?.status === "pulling" || pull?.status === "queued";
              const isFailed = pull?.status === "failed";
              return (
                <div key={entry.name} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{entry.displayName}</span>
                        <Badge variant="secondary" className="h-5 text-[10px] font-normal">
                          {entry.category}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{entry.blurb}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        ~{entry.sizeGb} GB · {entry.ramHint} ·{" "}
                        <code className="rounded bg-muted px-1 py-0.5">{entry.name}</code>
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isInstalled ? (
                        <Badge className="gap-1">
                          <IconCheck className="size-3" />
                          Installed
                        </Badge>
                      ) : isPulling ? (
                        <Button size="sm" variant="outline" disabled>
                          <IconLoader2 className="mr-1 size-3.5 animate-spin" />
                          {pull?.progress ?? 0}%
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={isFailed ? "outline" : "default"}
                          disabled={!isOwner}
                          onClick={() => triggerPull(entry.name)}
                        >
                          <IconDownload className="mr-1 size-3.5" />
                          {isFailed ? "Retry" : "Download"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isPulling && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${pull?.progress ?? 0}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {pull?.statusText ?? "starting"}…
                      </p>
                    </div>
                  )}

                  {isFailed && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
                      <IconAlertTriangle className="size-3" />
                      {pull?.error ?? "Pull failed"}
                    </p>
                  )}
                </div>
              );
            });
          })()
        )}

        {!isOwner && (
          <p className="text-center text-xs text-muted-foreground">
            Only owners and admins can download models.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
