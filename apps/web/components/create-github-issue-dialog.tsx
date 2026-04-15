"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconLoader2, IconPlus, IconCheck } from "@tabler/icons-react";
import {
  initGitHubIssueCreation,
  createGitHubIssueFromReview,
} from "@/app/(app)/settings/integrations/github-issue-action";
import { generateIssueContent } from "@/app/(app)/settings/integrations/issue-content-action";

type Step = "loading" | "generating" | "preview" | "creating" | "done" | "error";

export function CreateGitHubIssueButton({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueUrl, setIssueUrl] = useState("");

  const reset = useCallback(() => {
    setStep("loading");
    setError("");
    setTitle("");
    setDescription("");
    setIssueUrl("");
  }, []);

  const init = useCallback(async () => {
    reset();
    const result = await initGitHubIssueCreation(issueId);
    if ("error" in result) {
      setError(result.error);
      setStep("error");
      return;
    }
    // No mapping step needed — go straight to content generation
    setStep("generating");
    const content = await generateIssueContent(issueId);
    if ("error" in content) {
      setError(content.error);
      setStep("error");
      return;
    }
    setTitle(content.title);
    setDescription(content.description);
    setStep("preview");
  }, [issueId, reset]);

  useEffect(() => {
    if (open) {
      init();
    }
  }, [open, init]);

  async function handleCreateIssue() {
    if (!title.trim()) return;
    setStep("creating");
    const result = await createGitHubIssueFromReview(issueId, title.trim(), description.trim());
    if (result.error) {
      setError(result.error);
      setStep("error");
      return;
    }
    setIssueUrl(result.issueUrl ?? "");
    setStep("done");
    setTimeout(() => {
      setOpen(false);
      router.refresh();
    }, 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <IconPlus className="size-3" />
          GitHub Issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create GitHub Issue</DialogTitle>
          <DialogDescription>
            {step === "preview"
              ? "Review the AI-generated content before creating."
              : "Create a GitHub issue from this review finding."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Generating AI content */}
          {step === "generating" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating issue content...</p>
            </div>
          )}

          {/* Preview & Edit */}
          {step === "preview" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="gh-issue-title">Title</Label>
                <Input
                  id="gh-issue-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Issue title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gh-issue-description">Description</Label>
                <Textarea
                  id="gh-issue-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={7}
                  className="resize-none font-mono text-xs"
                  placeholder="Issue description"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateIssue} disabled={!title.trim()}>
                  Create Issue
                </Button>
              </div>
            </>
          )}

          {/* Creating */}
          {step === "creating" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Creating GitHub issue...</p>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="flex size-10 items-center justify-center rounded-full bg-green-100 text-green-600">
                <IconCheck className="size-5" />
              </div>
              <p className="text-sm font-medium text-green-600">GitHub issue created!</p>
              {issueUrl && (
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  View on GitHub
                </a>
              )}
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button onClick={init}>Retry</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
