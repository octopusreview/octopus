"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconSearch, IconLoader2 } from "@tabler/icons-react";

interface AnalysisFormProps {
  onAnalyze: (repoUrl: string) => void;
  isLoading: boolean;
  defaultUrl?: string;
  autoStart?: boolean;
}

export function AnalysisForm({ onAnalyze, isLoading, defaultUrl, autoStart }: AnalysisFormProps) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [started, setStarted] = useState(false);

  // Auto-start analysis when coming from repositories page
  useEffect(() => {
    if (autoStart && defaultUrl && !started && !isLoading) {
      setStarted(true);
      onAnalyze(defaultUrl);
    }
  }, [autoStart, defaultUrl, started, isLoading, onAnalyze]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    onAnalyze(url.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <Input
        type="url"
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="flex-1"
        disabled={isLoading}
      />
      <Button type="submit" disabled={!url.trim() || isLoading}>
        {isLoading ? (
          <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <IconSearch className="mr-2 h-4 w-4" />
        )}
        {isLoading ? "Analyzing..." : "Analyze"}
      </Button>
    </form>
  );
}
