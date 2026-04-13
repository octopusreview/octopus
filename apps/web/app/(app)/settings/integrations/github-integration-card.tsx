"use client";

import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconBrandGithub } from "@tabler/icons-react";
import { disconnectGitHub } from "./actions";
import { trackEvent } from "@/lib/analytics";

type GitHubData = {
  repoCount: number;
} | null;

export function GitHubIntegrationCard({
  data,
  appSlug,
  orgId,
}: {
  data: GitHubData;
  appSlug: string | null;
  orgId: string;
}) {
  const [isPending, startTransition] = useTransition();

  if (!data) {
    return (
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
                href={`https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(`${orgId}|${window.location.origin}/settings/integrations`)}`}
                onClick={() => trackEvent("cta_click", { location: "settings_integrations", label: "install_github_app" })}
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
    );
  }

  return (
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
              <a
                href={`https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(`${orgId}|${window.location.origin}/settings/integrations`)}`}
              >
                Manage Repos
              </a>
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => {
              startTransition(() => {
                disconnectGitHub();
              });
            }}
          >
            Disconnect GitHub
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
