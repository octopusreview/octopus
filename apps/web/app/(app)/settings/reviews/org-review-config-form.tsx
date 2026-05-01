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
import { Switch } from "@/components/ui/switch";
import { updateOrgDefaultReviewConfig } from "../../actions";
import { REVIEW_CATEGORIES } from "@/lib/review-categories";

type ReviewConfig = {
  maxFindings?: number;
  inlineThreshold?: string;
  enableConflictDetection?: boolean;
  disabledCategories?: string[];
  confidenceThreshold?: string;
  enableTwoPassReview?: boolean;
};

export function OrgReviewConfigForm({
  isOwner,
  initialConfig,
}: {
  isOwner: boolean;
  initialConfig: ReviewConfig;
}) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [maxFindings, setMaxFindings] = useState(initialConfig.maxFindings ?? 30);
  const [inlineThreshold, setInlineThreshold] = useState(initialConfig.inlineThreshold ?? "low");
  const [confidenceThreshold, setConfidenceThreshold] = useState(initialConfig.confidenceThreshold ?? "MEDIUM");
  const [enableConflict, setEnableConflict] = useState<string>(
    initialConfig.enableConflictDetection === undefined ? "auto" : initialConfig.enableConflictDetection ? "always" : "never",
  );
  const [twoPass, setTwoPass] = useState(initialConfig.enableTwoPassReview ?? false);
  const [disabledCategories, setDisabledCategories] = useState<string[]>(
    initialConfig.disabledCategories ?? [],
  );

  const toggleCategory = (cat: string) => {
    setDisabledCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSave = () => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const config: Record<string, unknown> = {
        maxFindings,
        inlineThreshold,
        confidenceThreshold,
        enableTwoPassReview: twoPass,
      };
      if (enableConflict !== "auto") {
        config.enableConflictDetection = enableConflict === "always";
      }
      if (disabledCategories.length > 0) config.disabledCategories = disabledCategories;

      const result = await updateOrgDefaultReviewConfig(config);
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
        <CardTitle>Review Defaults</CardTitle>
        <CardDescription>
          Default review settings for all repositories in this organization.
          Individual repositories can override these in their settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!isOwner || pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Max findings per review</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxFindings}
                onChange={(e) => setMaxFindings(Number(e.target.value))}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Inline comment threshold</Label>
              <select
                value={inlineThreshold}
                onChange={(e) => setInlineThreshold(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm"
              >
                <option value="low">Low & above (default)</option>
                <option value="medium">Medium & above</option>
                <option value="high">High & above</option>
                <option value="critical">Critical only</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confidence threshold</Label>
              <select
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm"
              >
                <option value="MEDIUM">Medium & above (default)</option>
                <option value="HIGH">High only</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Conflict detection</Label>
              <select
                value={enableConflict}
                onChange={(e) => setEnableConflict(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm"
              >
                <option value="auto">Auto (when shared files touched)</option>
                <option value="always">Always</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Two-pass review</Label>
              <p className="text-[10px] text-muted-foreground">
                Validates findings with a second LLM call. More accurate but costs more.
              </p>
            </div>
            <Switch checked={twoPass} onCheckedChange={setTwoPass} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Disabled categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {REVIEW_CATEGORIES.map((cat) => {
                const active = disabledCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors " +
                      (active
                        ? "border-destructive bg-destructive/10 text-destructive line-through"
                        : "border-input bg-background hover:bg-accent")
                    }
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Click a category to suppress its findings. Strikethrough = disabled.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-green-600">Defaults saved.</p>}

          <Button type="button" size="sm" className="w-full" disabled={pending || !isOwner} onClick={handleSave}>
            {pending ? "Saving..." : "Save Defaults"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners can change review defaults.
            </p>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
