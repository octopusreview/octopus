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
  initJiraIssueCreation,
  saveJiraProjectMapping,
  createJiraIssueFromReview,
} from "@/app/(app)/settings/integrations/jira-task-action";
import { generateIssueContent } from "@/app/(app)/settings/integrations/issue-content-action";

type Step = "loading" | "select_project" | "generating" | "preview" | "creating" | "done" | "error";

type Project = {
  id: string;
  key: string;
  name: string;
  issueTypes: { id: string; name: string }[];
};

export function CreateJiraIssueButton({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const [isAuthError, setIsAuthError] = useState(false);

  // select_project state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedIssueTypeId, setSelectedIssueTypeId] = useState("");
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
    setProjects([]);
    setSelectedProjectId("");
    setSelectedIssueTypeId("");
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
    const result = await initJiraIssueCreation(issueId);
    if ("error" in result) {
      setErrorWithAuthCheck(result.error);
      setStep("error");
      return;
    }
    if (result.step === "mapped") {
      await startGeneration();
    } else {
      setProjects(result.projects);
      setRepoId(result.repoId);
      setRepoName(result.repoName);
      setStep("select_project");
    }
  }, [issueId, reset, startGeneration, setErrorWithAuthCheck]);

  useEffect(() => {
    if (open) {
      init();
    }
  }, [open, init]);

  // Reset issue type when project changes
  useEffect(() => {
    setSelectedIssueTypeId("");
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const issueTypes = selectedProject?.issueTypes ?? [];

  async function handleMapAndContinue() {
    if (!selectedProjectId || !selectedIssueTypeId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    const issueType = project?.issueTypes.find((t) => t.id === selectedIssueTypeId);
    if (!project || !issueType) return;

    setIsSaving(true);
    const result = await saveJiraProjectMapping(
      repoId,
      project.id,
      project.key,
      project.name,
      issueType.id,
      issueType.name,
    );
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
    const result = await createJiraIssueFromReview(issueId, title.trim(), description.trim());
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
          Add to Jira
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Jira Issue</DialogTitle>
          <DialogDescription>
            {step === "select_project"
              ? "Select a Jira project and issue type to map this repository to."
              : step === "preview"
                ? "Review the AI-generated content before creating."
                : "Create a Jira issue from this review finding."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex items-center justify-center py-8">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Select Project + Issue Type */}
          {step === "select_project" && (
            <>
              <p className="text-sm text-muted-foreground">
                No Jira project mapped for{" "}
                <span className="font-medium text-foreground">{repoName}</span>. Choose a project
                and issue type to link it to:
              </p>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select
                  value={selectedProjectId}
                  onValueChange={setSelectedProjectId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        [{p.key}] {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Issue type</Label>
                <Select
                  value={selectedIssueTypeId}
                  onValueChange={setSelectedIssueTypeId}
                  disabled={!selectedProjectId || issueTypes.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        selectedProjectId
                          ? issueTypes.length === 0
                            ? "No issue types available"
                            : "Select issue type..."
                          : "Select a project first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {issueTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
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
                  disabled={!selectedProjectId || !selectedIssueTypeId || isSaving}
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
              <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                <div className="space-y-2">
                  <Label htmlFor="jira-issue-title">Title</Label>
                  <Input
                    id="jira-issue-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Issue title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jira-issue-description">Description</Label>
                  <Textarea
                    id="jira-issue-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={10}
                    className="font-mono text-xs"
                    placeholder="Issue description"
                  />
                </div>
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
              <p className="text-sm text-muted-foreground">Creating Jira issue...</p>
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="flex size-10 items-center justify-center rounded-full bg-green-100 text-green-600">
                <IconCheck className="size-5" />
              </div>
              <p className="text-sm font-medium text-green-600">Jira issue created!</p>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <>
              <p className="text-sm text-destructive">
                {isAuthError
                  ? "Your Jira connection has expired or been revoked."
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
                      Reconnect Jira
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
