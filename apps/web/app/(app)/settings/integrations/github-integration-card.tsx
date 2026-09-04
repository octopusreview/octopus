"use client";

import { useEffect, useState, useTransition } from "react";
import { resolveGithubErrorCopy, type GitHubInstallErrorCode } from "@/lib/github-install-errors";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconBrandGithub } from "@tabler/icons-react";
import { disconnectGitHub } from "./actions";
import { trackEvent } from "@/lib/analytics";

type GitHubData = {
  repoCount: number;
} | null;

type GitHubError = GitHubInstallErrorCode | null;

const INSTALL_URL = "/api/github/install?returnTo=/settings/integrations";

export function GitHubIntegrationCard({
  data,
  appSlug,
  isSelfHosted = false,
  error,
}: {
  data: GitHubData;
  appSlug: string | null;
  isSelfHosted?: boolean;
  error?: GitHubError;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [errorOpen, setErrorOpen] = useState<boolean>(Boolean(error));
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [manifestOrg, setManifestOrg] = useState("");
  const createAppHref = `/api/github/app-manifest/new${
    manifestOrg.trim() ? `?org=${encodeURIComponent(manifestOrg.trim())}` : ""
  }`;

  useEffect(() => {
    setErrorOpen(Boolean(error));
  }, [error]);

  const errorCopy = error ? resolveGithubErrorCopy(error, isSelfHosted) : null;
  const errorTitle = errorCopy?.title ?? null;
  const errorMessage = errorCopy?.message ?? null;

  const dismissError = () => {
    setErrorOpen(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      router.replace(url.pathname + (url.search ? url.search : ""));
    }
  };

  const errorDialog = errorTitle && errorMessage ? (
    <AlertDialog
      open={errorOpen}
      onOpenChange={(open) => {
        if (!open) dismissError();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{errorTitle}</AlertDialogTitle>
          <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={dismissError}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  if (!data) {
    return (
      <>
        {errorDialog}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center">
                <IconBrandGithub className="size-6 text-[#24292f] dark:text-white" />
              </div>
              <div>
                <CardTitle className="text-base">GitHub</CardTitle>
                <CardDescription>
                  Connect your GitHub organization for code reviews.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {appSlug ? (
              <Button asChild>
                <a
                  href={INSTALL_URL}
                  onClick={() =>
                    trackEvent("cta_click", {
                      location: "settings_integrations",
                      label: "install_github_app",
                    })
                  }
                >
                  <IconBrandGithub className="mr-2 size-4" />
                  Install GitHub App
                </a>
              </Button>
            ) : isSelfHosted ? (
              <div className="space-y-3">
                <p className="text-sm text-[#888]">
                  Octopus needs a GitHub App (separate from OAuth login) to receive
                  PR webhooks and post reviews. Create one automatically — no manual
                  config. Leave the field blank to create it under your personal
                  account, or enter a GitHub organization to create it there (needed
                  if your repos live in an org).
                </p>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    trackEvent("cta_click", {
                      location: "settings_integrations",
                      label: "create_github_app_manifest",
                    });
                    window.location.href = createAppHref;
                  }}
                >
                  <Input
                    value={manifestOrg}
                    onChange={(e) => setManifestOrg(e.target.value)}
                    placeholder="GitHub organization (optional)"
                    aria-label="GitHub organization (optional)"
                  />
                  <Button type="submit">
                    <IconBrandGithub className="mr-2 size-4" />
                    Create GitHub App
                  </Button>
                </form>
                <p className="text-xs">
                  <a
                    href="/docs/github-app"
                    className="text-cyan-400 underline decoration-cyan-400/30 underline-offset-2 hover:decoration-cyan-400"
                  >
                    Prefer to set it up manually? →
                  </a>
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-3 text-sm">
                <p className="font-medium text-amber-200">
                  GitHub connection unavailable
                </p>
                <p className="mt-1 text-xs text-[#888]">
                  Something on our side is stopping GitHub connections right now.
                  It has been logged. Please try again in a few minutes; if it
                  keeps happening, email support@octopus-review.ai.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {errorDialog}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center">
                <IconBrandGithub className="size-6 text-[#24292f] dark:text-white" />
              </div>
              <div>
                <CardTitle className="text-base">GitHub</CardTitle>
                <CardDescription>
                  {data.repoCount} {data.repoCount === 1 ? "repository" : "repositories"} connected
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="text-green-700 bg-green-100">
              Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border-t pt-4 flex items-center gap-2">
            {appSlug && (
              <Button size="sm" asChild>
                <a href={INSTALL_URL}>Manage Repos</a>
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirmDisconnectOpen(true)}
            >
              Disconnect GitHub
            </Button>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={confirmDisconnectOpen} onOpenChange={setConfirmDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              {data.repoCount === 1
                ? "1 repository will be disconnected."
                : `${data.repoCount} repositories will be disconnected.`}{" "}
              Their indexed data, reviews and analysis are preserved. If you reconnect the
              same GitHub installation later, the repositories will come back with everything intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const result = await disconnectGitHub();
                  if (result?.error) {
                    setDisconnectError(result.error);
                    return;
                  }
                  setDisconnectError(null);
                  setConfirmDisconnectOpen(false);
                });
              }}
            >
              {isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {disconnectError && (
            <p
              role="alert"
              className="mt-2 text-sm text-destructive"
            >
              {disconnectError}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
