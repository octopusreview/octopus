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
  | "not_a_member"
  | null;

const ERROR_TITLES: Record<Exclude<GitHubError, null>, string> = {
  installation_already_bound: "Already connected elsewhere",
  invalid_installation_id: "Invalid installation",
  missing_state: "Install flow interrupted",
  invalid_state_bad_signature: "Install flow could not be verified",
  invalid_state_expired: "Install flow expired",
  invalid_state_malformed: "Install flow could not be verified",
  replay_detected: "Install link already used",
  not_a_member: "Organization access lost",
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
  not_a_member:
    "You are no longer a member of the organization you started the install for. Switch organizations and try again.",
};

const INSTALL_URL = "/api/github/install?returnTo=/settings/integrations";

export function GitHubIntegrationCard({
  data,
  appSlug,
  error,
}: {
  data: GitHubData;
  appSlug: string | null;
  error?: GitHubError;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [errorOpen, setErrorOpen] = useState<boolean>(Boolean(error));
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

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
            ) : (
              <p className="text-sm text-muted-foreground">
                GitHub App is not configured. Please set the
                NEXT_PUBLIC_GITHUB_APP_SLUG environment variable.
              </p>
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
                  await disconnectGitHub();
                  setConfirmDisconnectOpen(false);
                });
              }}
            >
              {isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
