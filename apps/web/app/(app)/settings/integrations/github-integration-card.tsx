"use client";

import { useEffect, useState, useTransition } from "react";
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

type GitHubError =
  | "installation_already_bound"
  | "invalid_installation_id"
  | "missing_state"
  | "invalid_state_bad_signature"
  | "invalid_state_expired"
  | "invalid_state_malformed"
  | "replay_detected"
  | "state_store_unavailable"
  | "session_required"
  | "state_user_mismatch"
  | "state_browser_mismatch"
  | "github_app_not_configured"
  | "github_verification_not_configured"
  | "github_authorization_denied"
  | "github_authorization_failed"
  | "installation_not_accessible"
  | "not_a_member"
  | "manifest_forbidden"
  | "manifest_already_configured"
  | "manifest_bad_org"
  | "manifest_expired"
  | "manifest_failed"
  | null;

const ERROR_TITLES: Record<Exclude<GitHubError, null>, string> = {
  installation_already_bound: "Already connected elsewhere",
  invalid_installation_id: "Invalid installation",
  missing_state: "Install flow interrupted",
  invalid_state_bad_signature: "Install flow could not be verified",
  invalid_state_expired: "Install flow expired",
  invalid_state_malformed: "Install flow could not be verified",
  replay_detected: "Install link already used",
  state_store_unavailable: "Install verification unavailable",
  session_required: "Sign-in required",
  state_user_mismatch: "Install session changed",
  state_browser_mismatch: "Install browser could not be verified",
  github_app_not_configured: "GitHub App not configured",
  github_verification_not_configured: "GitHub verification needs configuration",
  github_authorization_denied: "GitHub authorization declined",
  github_authorization_failed: "GitHub authorization failed",
  installation_not_accessible: "Installation access not verified",
  not_a_member: "Organization access lost",
  manifest_forbidden: "Not allowed",
  manifest_already_configured: "GitHub App already set up",
  manifest_bad_org: "Invalid organization",
  manifest_expired: "Setup expired",
  manifest_failed: "Couldn't create the GitHub App",
};

const ERROR_MESSAGES: Record<Exclude<GitHubError, null>, string> = {
  installation_already_bound:
    "This GitHub installation is already connected to another Octopus organization. Disconnect it there first, then try again.",
  invalid_installation_id: "The installation ID GitHub returned is not valid.",
  missing_state:
    "The GitHub callback arrived without a valid flow token. Please start the install from Octopus again.",
  invalid_state_bad_signature:
    "The install token could not be verified. Please start the install from Octopus again.",
  invalid_state_expired:
    "The install flow expired. Please start it again and complete it within 10 minutes.",
  invalid_state_malformed:
    "The install token is malformed. Please start the install from Octopus again.",
  replay_detected:
    "This install link has already been used. Please start a new install flow.",
  state_store_unavailable:
    "The install verification store is temporarily unavailable. Please try again.",
  session_required:
    "Sign in again, then restart the GitHub App installation.",
  state_user_mismatch:
    "The signed-in user is not the user who started this installation. Restart the install from Octopus.",
  state_browser_mismatch:
    "This browser did not start the installation, or its install cookie expired. Start again from Octopus.",
  github_app_not_configured:
    "No GitHub App is configured for this instance yet. Create the GitHub App below, then start the install again.",
  github_verification_not_configured:
    "Add the GitHub App client ID, client secret, and Octopus callback URL, then restart the install.",
  github_authorization_denied:
    "GitHub authorization was declined. Authorize the GitHub App to verify the installation belongs to you.",
  github_authorization_failed:
    "Octopus could not verify your GitHub authorization. Check the GitHub App callback URL and try again.",
  installation_not_accessible:
    "Your GitHub user cannot access this installation. Ask an organization owner to install it or use an authorized account.",
  not_a_member:
    "You are no longer a member of the organization you started the install for. Switch organizations and try again.",
  manifest_forbidden:
    "Only an organization owner or admin can create the GitHub App. Ask an admin, or switch to an org you own.",
  manifest_already_configured:
    "A GitHub App is already configured for this instance. Reload the page — you should see an “Install GitHub App” button.",
  manifest_bad_org:
    "That doesn't look like a valid GitHub organization name. Leave it blank to create the App under your personal account.",
  manifest_expired:
    "The setup flow expired. Please start again and finish within 15 minutes.",
  manifest_failed:
    "Something went wrong creating the GitHub App. Please try again; if it persists, use the manual setup guide.",
};

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

  const errorTitle = error ? ERROR_TITLES[error] : null;
  const errorMessage = error ? ERROR_MESSAGES[error] : null;

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
                  GitHub App not configured
                </p>
                <p className="mt-1 text-xs text-[#888]">
                  Octopus needs a GitHub App (separate from OAuth login) to
                  receive PR webhooks and post review comments. Once you create
                  the App and set <code className="rounded bg-[#1a1a1a] px-1 text-[11px]">GITHUB_APP_ID</code>,{" "}
                  <code className="rounded bg-[#1a1a1a] px-1 text-[11px]">GITHUB_APP_PRIVATE_KEY</code>,{" "}
                  <code className="rounded bg-[#1a1a1a] px-1 text-[11px]">GITHUB_WEBHOOK_SECRET</code>, and{" "}
                  <code className="rounded bg-[#1a1a1a] px-1 text-[11px]">NEXT_PUBLIC_GITHUB_APP_SLUG</code>{" "}
                  in <code className="rounded bg-[#1a1a1a] px-1 text-[11px]">.env</code> and restart the server,
                  this button will turn into &quot;Install GitHub App&quot;.
                </p>
                <p className="mt-3 text-xs">
                  <a
                    href="/docs/github-app"
                    className="text-cyan-400 underline decoration-cyan-400/30 underline-offset-2 hover:decoration-cyan-400"
                  >
                    Step-by-step setup guide →
                  </a>
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
