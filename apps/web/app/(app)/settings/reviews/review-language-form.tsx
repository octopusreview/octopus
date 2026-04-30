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
import { REVIEW_LANGUAGES } from "@/lib/review-language";
import { updateOrgReviewLanguage } from "../../actions";

export function ReviewLanguageForm({
  isOwner,
  initialLanguage,
}: {
  isOwner: boolean;
  initialLanguage: string;
}) {
  const [pending, startTransition] = useTransition();
  const [language, setLanguage] = useState(initialLanguage);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = () => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await updateOrgReviewLanguage(language);
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
        <CardTitle>Review Output Language</CardTitle>
        <CardDescription>
          Language used for review prose: summary, finding titles and descriptions,
          highlights. Code, identifiers, file paths, and the suggestion field stay in
          their original language.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!isOwner || pending} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="review-language">Language</Label>
            <select
              id="review-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm"
            >
              {REVIEW_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-green-600">Language saved.</p>}

          <Button type="button" size="sm" className="w-full" disabled={pending || !isOwner} onClick={handleSave}>
            {pending ? "Saving..." : "Save Language"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners can change the review language.
            </p>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
