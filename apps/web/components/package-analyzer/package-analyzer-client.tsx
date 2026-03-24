"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { DependencyRiskReport } from "@octopus/package-analyzer";
import { AnalysisForm } from "./analysis-form";
import { ProgressLog, type ProgressEntry } from "./progress-log";
import { ResultsSummary } from "./results-summary";
import { ResultsList } from "./results-list";
import { AnalysisHistory, type AnalysisHistoryItem } from "./analysis-history";

interface PackageAnalyzerClientProps {
  authenticated?: boolean;
  history?: AnalysisHistoryItem[];
  defaultUrl?: string;
  autoStart?: boolean;
}

export function PackageAnalyzerClient({ authenticated, history, defaultUrl, autoStart }: PackageAnalyzerClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [progressEntries, setProgressEntries] = useState<ProgressEntry[]>([]);
  const [reports, setReports] = useState<DependencyRiskReport[] | null>(null);
  const [repoName, setRepoName] = useState("");
  const [analyzedFiles, setAnalyzedFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const redirectingRef = useRef(false);

  const addProgress = useCallback((step: string, message: string, pkg?: string) => {
    setProgressEntries((prev) => [
      ...prev,
      { step, message, package: pkg, timestamp: Date.now() },
    ]);
  }, []);

  const handleAnalyze = useCallback(async (repoUrl: string) => {
    setIsLoading(true);
    setProgressEntries([]);
    setReports(null);
    setError(null);
    setIsComplete(false);
    redirectingRef.current = false;

    try {
      const resp = await fetch("/api/analyze-deps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: "Analysis failed" }));
        setError(data.error ?? "Analysis failed");
        setIsLoading(false);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setError("Failed to read response stream");
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (currentEvent) {
                case "progress":
                  addProgress(data.step, data.message, data.package);
                  break;
                case "finding":
                  addProgress(
                    "finding",
                    `${data.risk.toUpperCase()}: ${data.package} (score: ${data.score})`,
                    data.package,
                  );
                  break;
                case "complete":
                  if (data.cached) {
                    // Cached result — redirect to detail page
                    redirectingRef.current = true;
                    addProgress("completed", "Found cached analysis for this commit — redirecting...");
                    router.push(`/package-analyzer/${data.analysisId}`);
                    return;
                  }
                  setReports(data.reports);
                  setRepoName(data.repoName);
                  setAnalyzedFiles(data.analyzedFiles);
                  setIsComplete(true);
                  addProgress("completed", `Analysis complete — ${data.reports.length} packages analyzed`);
                  // Refresh page to update history
                  if (data.analysisId) {
                    setTimeout(() => router.refresh(), 500);
                  }
                  break;
                case "error":
                  setError(data.message);
                  setIsComplete(true);
                  addProgress("error", data.message);
                  break;
              }
            } catch {
              // Skip malformed events
            }
            currentEvent = "";
          }
        }
      }
    } catch {
      // Don't show error if we're redirecting to cached result
    } finally {
      if (!redirectingRef.current) {
        setIsLoading(false);
      }
    }
  }, [addProgress, router]);

  return (
    <div className="space-y-6">
      <AnalysisForm onAnalyze={handleAnalyze} isLoading={isLoading} defaultUrl={defaultUrl} autoStart={autoStart} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {progressEntries.length > 0 && (
        <ProgressLog entries={progressEntries} isComplete={isComplete} />
      )}

      {reports && (
        <>
          <ResultsSummary
            reports={reports}
            repoName={repoName}
            analyzedFiles={analyzedFiles}
          />
          <ResultsList reports={reports} authenticated={authenticated} />
        </>
      )}

      {!isLoading && !reports && history && (
        <AnalysisHistory items={history} />
      )}
    </div>
  );
}
