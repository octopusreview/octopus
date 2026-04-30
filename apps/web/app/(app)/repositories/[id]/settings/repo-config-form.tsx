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
import { IconPlus, IconX, IconAlertTriangle } from "@tabler/icons-react";
import { updateRepoConfigSettings } from "../../actions";

const FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_FILES = 10;

export function RepoConfigForm({
  repoId,
  isOwner,
  initialEnabled,
  initialFiles,
}: {
  repoId: string;
  isOwner: boolean;
  initialEnabled: boolean;
  initialFiles: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [files, setFiles] = useState<string[]>(initialFiles);
  const [draft, setDraft] = useState("");

  function addFile() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!FILENAME_RE.test(trimmed)) {
      setError(`"${trimmed}" is not a valid filename. Use letters, digits, ._- only.`);
      return;
    }
    if (files.includes(trimmed)) {
      setError(`"${trimmed}" is already in the list.`);
      return;
    }
    if (files.length >= MAX_FILES) {
      setError(`Up to ${MAX_FILES} filenames allowed.`);
      return;
    }
    setError(null);
    setFiles([...files, trimmed]);
    setDraft("");
  }

  function removeFile(name: string) {
    setFiles(files.filter((f) => f !== name));
  }

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (enabled && files.length === 0) {
      setError("Add at least one filename, or disable repo config.");
      return;
    }
    startTransition(async () => {
      const result = await updateRepoConfigSettings(repoId, {
        useRepoConfig: enabled,
        repoConfigFiles: files,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository Config Files</CardTitle>
        <CardDescription>
          Read coding rules from a Markdown file at the repository root and apply them
          during review. Useful for repo-pinned conventions like <code>AGENTS.md</code>,
          <code>CLAUDE.md</code>, or your own filename.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={!isOwner || pending} className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            <div className="flex gap-2">
              <IconAlertTriangle className="size-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="font-medium">Treated as untrusted input</p>
                <p className="text-muted-foreground">
                  Anyone with write access to this repo can change these files. Octopus
                  runs them through a sandboxed extraction pass that ignores meta-instructions
                  before applying any rules — but you should still only enable this for
                  repos with branch protection or trusted contributors.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Enable repo config</Label>
              <p className="text-[10px] text-muted-foreground">
                When on, the first matching file at repo root is read on each review.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Candidate filenames (in priority order)</Label>
            <div className="flex flex-wrap gap-2">
              {files.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1 font-mono text-xs"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeFile(name)}
                    aria-label={`Remove ${name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <IconX className="size-3" />
                  </button>
                </span>
              ))}
              {files.length === 0 && (
                <p className="text-xs text-muted-foreground">No filenames configured.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="AGENTS.md, AJAN.md, .octopus.md"
                className="h-8 font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFile();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={addFile} className="h-8">
                <IconPlus className="size-3.5" /> Add
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Octopus tries each filename in order and uses the first one that exists. Max {MAX_FILES} entries.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-600">Repo config settings saved.</p>}

          <Button type="button" size="sm" className="w-full" disabled={pending || !isOwner} onClick={handleSubmit}>
            {pending ? "Saving..." : "Save Repo Config Settings"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners can change repository config settings.
            </p>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
