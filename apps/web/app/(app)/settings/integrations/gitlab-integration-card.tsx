"use client";

import { useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { IconBrandGitlab, IconArrowRight } from "@tabler/icons-react";
import { disconnectGitlab, startGitlabOAuth } from "./actions";

type GitlabData = {
  namespaceName: string;
  namespacePath: string;
  gitlabHost: string;
} | null;

const DEFAULT_HOST = "https://gitlab.com";

export function GitlabIntegrationCard({ data }: { data: GitlabData }) {
  const [isPending, startTransition] = useTransition();
  const [host, setHost] = useState(DEFAULT_HOST);

  const isSelfHosted =
    host.trim() !== "" && host.replace(/\/+$/, "") !== DEFAULT_HOST;

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center">
              <IconBrandGitlab className="size-6 text-[#FC6D26]" />
            </div>
            <div>
              <CardTitle className="text-base">GitLab</CardTitle>
              <CardDescription>
                Connect your GitLab group or self-hosted instance for code reviews.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">How it works</p>
            <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside mb-5">
              <li>Enter your GitLab host and group/user namespace</li>
              <li>Self-hosted instances: register an OAuth application on your GitLab and paste its credentials below</li>
              <li>Authorize Octopus on GitLab — projects sync automatically</li>
            </ol>

            <form action={startGitlabOAuth} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="gl-host">GitLab host</Label>
                <Input
                  id="gl-host"
                  name="host"
                  placeholder={DEFAULT_HOST}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  onBlur={(e) => setHost(e.target.value.trim() || DEFAULT_HOST)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gl-namespace">Namespace (group, subgroup or username)</Label>
                <Input
                  id="gl-namespace"
                  name="namespace"
                  placeholder="my-group or my-group/team"
                  required
                />
              </div>

              {isSelfHosted && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                  <p className="text-amber-800 dark:text-amber-200 text-xs font-medium mb-2">
                    Self-hosted instance — paste your GitLab OAuth application credentials
                  </p>
                  <p className="text-amber-700 dark:text-amber-300 text-xs mb-3">
                    Create one at <span className="font-mono">{host.replace(/\/+$/, "")}/admin/applications</span>{" "}
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
          </div>
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
              <IconBrandGitlab className="size-6 text-[#FC6D26]" />
            </div>
            <div>
              <CardTitle className="text-base">GitLab</CardTitle>
              <CardDescription>
                Connected to <span className="font-medium">{data.namespaceName}</span>
                {" "}
                <span className="text-muted-foreground">({data.namespacePath})</span>
                {data.gitlabHost !== DEFAULT_HOST ? (
                  <span className="text-muted-foreground"> at {data.gitlabHost}</span>
                ) : null}
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="text-green-700 bg-green-100">
            Connected
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border-t pt-4">
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => {
              startTransition(() => {
                disconnectGitlab();
              });
            }}
          >
            Disconnect GitLab
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
