"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconCircleCheck,
  IconCircle,
  IconX,
  IconRocket,
} from "@tabler/icons-react";

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

interface OnboardingTipsProps {
  hasIndexedRepo: boolean;
  hasAnalyzedRepo: boolean;
  hasAutoReviewRepo: boolean;
}

const steps = [
  {
    key: "index",
    label: "Index a repository",
    description: "Index at least one repository so Octopus can understand your codebase.",
  },
  {
    key: "analyze",
    label: "Analyze a repository",
    description: "Run an analysis to get insights about your codebase structure and quality.",
  },
  {
    key: "autoReview",
    label: "Enable auto-review",
    description: "Turn on automatic PR reviews to get feedback on every pull request.",
  },
] as const;

export function OnboardingTips({
  hasIndexedRepo,
  hasAnalyzedRepo,
  hasAutoReviewRepo,
}: OnboardingTipsProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const completionMap: Record<string, boolean> = {
    index: hasIndexedRepo,
    analyze: hasAnalyzedRepo,
    autoReview: hasAutoReviewRepo,
  };

  const completedCount = Object.values(completionMap).filter(Boolean).length;

  if (completedCount === 3) return null;

  return (
    <Card className="mt-6 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconRocket className="size-4 text-primary" />
          <p className="text-sm font-semibold">Get started with Octopus</p>
          <span className="text-xs text-muted-foreground">
            {completedCount}/3 completed
          </span>
        </div>
        <button
          onClick={() => {
            setCookie("onboarding_tips_dismissed", "1", 365);
            setDismissed(true);
          }}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {steps.map((step) => {
          const completed = completionMap[step.key];
          return (
            <div key={step.key} className="flex items-start gap-3">
              {completed ? (
                <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <IconCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <span
                  className={`text-sm ${completed ? "text-muted-foreground line-through" : "font-medium"}`}
                >
                  {step.label}
                </span>
                {!completed && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {step.description}
                  </p>
                )}
              </div>
              {!completed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 shrink-0 text-xs"
                  asChild
                >
                  <a href="/repositories">Go &rarr;</a>
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
