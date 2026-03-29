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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconLoader2, IconPlus, IconCheck, IconPlugConnected } from "@tabler/icons-react";
import Link from "next/link";
import {
  initLinearIssueCreation,
  saveLinearTeamMapping,
  createLinearIssueFromReview,
} from "@/app/(app)/settings/integrations/linear-task-action";
import { generateIssueContent } from "@/app/(app)/settings/integrations/collab-task-action";

type Step = "loading" | "select_team" | "generating" | "preview" | "creating" | "done" | "error";

type Team = { id: string; name: string; key: string };

export function CreateLinearIssueButton({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const [isAuthError, setIsAuthError] = useState(false);

  // select_team state
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [repoId, setRepoId] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // preview state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const AUTH_ERROR_MARKER = "revoked or expired";

  const setErrorWithAuthCheck = useCallback((message: string) => {
    setError(message);
    setIsAuthError(message.includes(AUTH_ERROR_MARKER));
  }, []);

  const reset = useCallback(() => {
    setStep("loading");
    setError("");
    setIsAuthError(false);
    setTeams([]);
    setSelectedTeamId("");
    setRepoId("");
    setRepoName("");
    setTitle("");
    setDescription("");
    setIsSaving(false);
  }, []);

  const startGeneration = useCallback(async () => {
    setStep("generating");
    const result = await generateIssueContent(issueId);
    if ("error" in result) {
      setErrorWithAuthCheck(result.error);
      setStep("error");
      return;
    }
    setTitle(result.title);
    setDescription(result.description);
    setStep("preview");
  }, [issueId, setErrorWithAuthCheck]);

  const init = useCallback(async () => {
    reset();
    const result = await initLinearIssueCreation(issueId);
    if ("error" in result) {
      setErrorWithAuthCheck(result.error);
      setStep("error");
      return;
    }
    if (result.step === "mapped") {
      await startGeneration();
    } else {
      setTeams(result.teams);
      setRepoId(result.repoId);
      setRepoName(result.repoName);
      setStep("select_team");
    }
  }, [issueId, reset, startGeneration, setErrorWithAuthCheck]);

  useEffect(() => {
    if (open) {
      init();
    }
  }, [open, init]);

  async function handleMapAndContinue() {
    if (!selectedTeamId) return;
    const team = teams.find((t) => t.id === selectedTeamId);
    if (!team) return;

    setIsSaving(true);
    const result = await saveLinearTeamMapping(repoId, team.id, team.name, team.key);
    if (result.error) {
      setErrorWithAuthCheck(result.error);
      setStep("error");
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    await startGeneration();
  }

  async function handleCreateIssue() {
    if (!title.trim()) return;
    setStep("creating");
    const result = await createLinearIssueFromReview(issueId, title.trim(), description.trim());
    if (result.error) {
      setErrorWithAuthCheck(result.error);
      setStep("error");
      return;
    }
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
          Add to Linear
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Linear Issue</DialogTitle>
          <DialogDescription>
            {step === "select_team"
              ? "Select a Linear team to map this repository to."
              : step === "preview"
                ? "Review the AI-generated content before creating."
                : "Create a Linear issue from this review finding."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Select Team */}
          {step === "select_team" && (
            <>
              <p className="text-sm text-muted-foreground">
                No team mapped for <span className="font-medium text-foreground">{repoName}</span>.
                Select a Linear team to link it to:
              </p>
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        [{t.key}] {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleMapAndContinue}
                  disabled={!selectedTeamId || isSaving}
                >
                  {isSaving ? (
                    <>
                      <IconLoader2 className="size-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Map & Continue"
                  )}
                </Button>
              </div>
            </>
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
                <Label htmlFor="linear-issue-title">Title</Label>
                <Input
                  id="linear-issue-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Issue title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="linear-issue-description">Description</Label>
                <Textarea
                  id="linear-issue-description"
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
              <p className="text-sm text-muted-foreground">Creating Linear issue...</p>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="flex size-10 items-center justify-center rounded-full bg-green-100 text-green-600">
                <IconCheck className="size-5" />
              </div>
              <p className="text-sm font-medium text-green-600">Linear issue created!</p>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <>
              <p className="text-sm text-destructive">
                {isAuthError
                  ? "Your Linear connection has expired or been revoked."
                  : error}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                {isAuthError ? (
                  <Button asChild>
                    <Link href="/settings/integrations">
                      <IconPlugConnected className="size-3.5" />
                      Reconnect Linear
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={init}>Retry</Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
