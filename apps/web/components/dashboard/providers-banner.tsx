"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  IconBrandGithub,
  IconBrandBitbucket,
  IconCircleCheck,
  IconCircle,
  IconX,
  IconArrowRight,
  IconGitPullRequest,
  IconShieldCheck,
} from "@tabler/icons-react";

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function ProvidersBanner({
  githubConnected,
  bitbucketConnected,
  githubAppSlug,
}: {
  githubConnected: boolean;
  bitbucketConnected: boolean;
  githubAppSlug: string | undefined;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [bbDialogOpen, setBbDialogOpen] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState("");

  if (dismissed) return null;

  const githubInstallUrl = githubAppSlug ? "/api/github/install?returnTo=/dashboard" : null;

  return (
    <>
      <Card className="mt-6 px-5 py-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold">Connect your code providers</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Link your repositories to get AI-powered code reviews on every pull request.
            </p>
          </div>
          <button
            onClick={() => {
              setCookie("providers_banner_dismissed", "1", 365);
              setDismissed(true);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors rounded-sm p-0.5 shrink-0"
            aria-label="Dismiss"
          >
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* GitHub Card */}
          <div className="border-border/60 bg-muted/30 flex flex-col rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              {githubConnected ? (
                <IconCircleCheck className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <IconCircle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <IconBrandGithub className="size-5 shrink-0" />
              <span className="text-sm font-medium">GitHub</span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Install the GitHub App to automatically review pull requests with inline comments and severity levels.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconGitPullRequest className="size-3" />
                <span>Auto-review PRs</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconShieldCheck className="size-3" />
                <span>Read-only access</span>
              </div>
            </div>
            <div className="mt-auto pt-3">
              {githubConnected ? (
                githubInstallUrl ? (
                  <Button size="sm" variant="outline" className="h-8 w-full text-xs" asChild>
                    <a href={githubInstallUrl}>
                      Manage Repos &rarr;
                    </a>
                  </Button>
                ) : (
                  <div className="flex h-8 items-center justify-center text-xs font-medium text-emerald-500">
                    Connected
                  </div>
                )
              ) : (
                githubInstallUrl && (
                  <Button size="sm" variant="cta" className="h-8 w-full text-xs" asChild>
                    <a href={githubInstallUrl}>
                      Connect GitHub &rarr;
                    </a>
                  </Button>
                )
              )}
            </div>
          </div>

          {/* Bitbucket Card */}
          <div className="border-border/60 bg-muted/30 flex flex-col rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              {bitbucketConnected ? (
                <IconCircleCheck className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <IconCircle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <IconBrandBitbucket className="size-5 shrink-0 text-[#0052CC] dark:text-[#79B8FF]" />
              <span className="text-sm font-medium">Bitbucket</span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Connect your Bitbucket workspace via OAuth to review pull requests and sync repositories.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconGitPullRequest className="size-3" />
                <span>Auto-review PRs</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconShieldCheck className="size-3" />
                <span>OAuth 2.0</span>
              </div>
            </div>
            <div className="mt-auto pt-3">
              {bitbucketConnected ? (
                <div className="flex h-8 items-center justify-center text-xs font-medium text-emerald-500">
                  Connected
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="cta"
                  className="h-8 w-full text-xs"
                  onClick={() => setBbDialogOpen(true)}
                >
                  Connect Bitbucket &rarr;
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          You can always manage integrations from{" "}
          <a
            href="/settings/integrations"
            className="underline hover:text-foreground transition-colors"
          >
            Settings
          </a>
          .
        </p>
      </Card>

      <Dialog open={bbDialogOpen} onOpenChange={setBbDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconBrandBitbucket className="size-5 text-[#0052CC] dark:text-[#79B8FF]" />
              Connect Bitbucket
            </DialogTitle>
            <DialogDescription>
              Connect your Bitbucket workspace for automated code reviews.
            </DialogDescription>
          </DialogHeader>

          <div className="pt-2">
            <p className="text-sm font-medium mb-3">How it works</p>
            <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside mb-5">
              <li>Enter your workspace slug below</li>
              <li>Authorize Octopus on Bitbucket</li>
              <li>Your repositories will be synced automatically</li>
            </ol>

            <div className="space-y-3">
              <Input
                placeholder="Workspace slug (e.g. my-team)"
                value={workspaceSlug}
                onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase())}
                onBlur={(e) => setWorkspaceSlug(e.target.value.trim())}
              />
              <p className="text-muted-foreground text-xs">
                Find it in your Bitbucket URL: bitbucket.org/<span className="font-medium text-foreground">{workspaceSlug || "your-workspace"}</span>
              </p>

              <Button
                className="w-full"
                size="lg"
                disabled={!workspaceSlug}
                onClick={() => {
                  if (workspaceSlug) {
                    window.location.href = `/api/bitbucket/oauth?workspace=${encodeURIComponent(workspaceSlug)}`;
                  }
                }}
              >
                <IconBrandBitbucket className="mr-2 size-4" />
                Connect Bitbucket workspace
                <IconArrowRight className="ml-2 size-4" />
              </Button>

              <p className="text-muted-foreground text-center text-xs">
                Secure access only - we never store your code.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
