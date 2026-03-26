"use client";

import { useState } from "react";
import { IconDatabase, IconLoader2, IconCheck, IconX } from "@tabler/icons-react";

export default function SeedDocsPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<{ totalDocuments?: number; totalChunks?: number; error?: string } | null>(null);

  async function handleSeed() {
    setStatus("loading");
    setResult(null);

    try {
      const res = await fetch("/api/admin/seed-docs", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setResult(data);
      } else {
        setStatus("error");
        setResult({ error: data.error || "Unknown error" });
      }
    } catch (err) {
      setStatus("error");
      setResult({ error: (err as Error).message });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Seed Docs to Qdrant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chunk and embed all landing page and documentation content into the <code className="rounded bg-muted px-1.5 py-0.5 text-xs">docs_chunks</code> Qdrant collection for the &quot;Ask Octopus&quot; public chat.
        </p>
      </div>

      <div className="rounded-lg border p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <IconDatabase className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Documentation Chunks</h2>
            <p className="text-sm text-muted-foreground">
              Pages: Landing, Getting Started, CLI, Pricing, Integrations, Self-Hosting, FAQ, Glossary, Skills, About, .octopusignore
            </p>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handleSeed}
            disabled={status === "loading"}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {status === "loading" ? (
              <>
                <IconLoader2 className="size-4 animate-spin" />
                Seeding...
              </>
            ) : (
              <>
                <IconDatabase className="size-4" />
                Seed Docs
              </>
            )}
          </button>
        </div>

        {result && (
          <div className={`mt-4 rounded-md border p-4 ${status === "success" ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950" : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"}`}>
            {status === "success" ? (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <IconCheck className="size-4" />
                Seeded {result.totalChunks} chunks from {result.totalDocuments} documents.
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <IconX className="size-4" />
                {result.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
