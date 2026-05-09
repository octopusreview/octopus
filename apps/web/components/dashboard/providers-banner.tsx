"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  IconBrandGitlab,
  IconCircleCheck,
  IconCircle,
  IconX,
  IconArrowRight,
  IconGitPullRequest,
  IconShieldCheck,
} from "@tabler/icons-react";
import { startGitlabOAuth } from "@/app/(app)/settings/integrations/actions";

const DEFAULT_GITLAB_HOST = "https://gitlab.com";

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function ProvidersBanner({
  githubConnected,
  bitbucketConnected,
  gitlabConnected,
  githubAppSlug,
}: {
  githubConnected: boolean;
  bitbucketConnected: boolean;
  gitlabConnected: boolean;
  githubAppSlug: string | undefined;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [bbDialogOpen, setBbDialogOpen] = useState(false);
  const [glDialogOpen, setGlDialogOpen] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [glHost, setGlHost] = useState(DEFAULT_GITLAB_HOST);

  if (dismissed) return null;

  const githubInstallUrl = githubAppSlug ? "/api/github/install?returnTo=/dashboard" : null;
  const isGlSelfHosted =
    glHost.trim() !== "" && glHost.replace(/\/+$/, "") !== DEFAULT_GITLAB_HOST;

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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

          {/* GitLab Card */}
          <div className="border-border/60 bg-muted/30 flex flex-col rounded-lg border p-4">
            <div className="flex items-center gap-2.5">
              {gitlabConnected ? (
                <IconCircleCheck className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <IconCircle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <IconBrandGitlab className="size-5 shrink-0 text-[#FC6D26]" />
              <span className="text-sm font-medium">GitLab</span>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Connect a GitLab group via OAuth — supports gitlab.com and self-hosted instances.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconGitPullRequest className="size-3" />
                <span>Auto-review MRs</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
                <IconShieldCheck className="size-3" />
                <span>OAuth 2.0</span>
              </div>
            </div>
            <div className="mt-auto pt-3">
              {gitlabConnected ? (
                <div className="flex h-8 items-center justify-center text-xs font-medium text-emerald-500">
                  Connected
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="cta"
                  className="h-8 w-full text-xs"
                  onClick={() => setGlDialogOpen(true)}
                >
                  Connect GitLab &rarr;
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

      <Dialog open={glDialogOpen} onOpenChange={setGlDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconBrandGitlab className="size-5 text-[#FC6D26]" />
              Connect GitLab
            </DialogTitle>
            <DialogDescription>
              Connect a GitLab group or your self-hosted instance.
            </DialogDescription>
          </DialogHeader>

          <form action={startGitlabOAuth} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="gl-banner-host">GitLab host</Label>
              <Input
                id="gl-banner-host"
                name="host"
                placeholder={DEFAULT_GITLAB_HOST}
                value={glHost}
                onChange={(e) => setGlHost(e.target.value)}
                onBlur={(e) => setGlHost(e.target.value.trim() || DEFAULT_GITLAB_HOST)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gl-banner-namespace">Namespace (group, subgroup or username)</Label>
              <Input
                id="gl-banner-namespace"
                name="namespace"
                placeholder="my-group or my-group/team"
                required
              />
            </div>

            {isGlSelfHosted && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <p className="text-amber-800 dark:text-amber-200 text-xs font-medium mb-2">
                  Self-hosted instance — paste your GitLab OAuth application credentials
                </p>
                <p className="text-amber-700 dark:text-amber-300 text-xs mb-3">
                  Create one at <span className="font-mono">{glHost.replace(/\/+$/, "")}/admin/applications</span>{" "}
                  (or User Settings → Applications). Redirect URI must match this app&apos;s callback URL.
                </p>
                <div className="space-y-2">
                  <Input
                    name="clientId"
                    placeholder="Application ID (Client ID)"
                    autoComplete="off"
                    required
                  />
                  <Input
                    name="clientSecret"
                    type="password"
                    placeholder="Secret (Client Secret)"
                    autoComplete="off"
                    required
                  />
                </div>
              </div>
            )}

            <Button className="w-full" size="lg" type="submit">
              <IconBrandGitlab className="mr-2 size-4" />
              Connect GitLab
              <IconArrowRight className="ml-2 size-4" />
            </Button>

            <p className="text-muted-foreground text-center text-xs">
              Secure access only - we never store your code.
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
