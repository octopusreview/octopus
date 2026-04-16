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
import { IconBrandBitbucket, IconArrowRight } from "@tabler/icons-react";
import { disconnectBitbucket } from "./actions";

type BitbucketData = {
  workspaceName: string;
  workspaceSlug: string;
} | null;

export function BitbucketIntegrationCard({ data }: { data: BitbucketData }) {
  const [isPending, startTransition] = useTransition();
  const [workspaceSlug, setWorkspaceSlug] = useState("");

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center">
              <IconBrandBitbucket className="size-6 text-[#0052CC] dark:text-[#79B8FF]" />
            </div>
            <div>
              <CardTitle className="text-base">Bitbucket</CardTitle>
              <CardDescription>
                Connect your Bitbucket workspace for code reviews.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border-t pt-4">
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
                onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().trim())}
              />
              <p className="text-muted-foreground text-xs">
                Find it in your Bitbucket URL: bitbucket.org/<span className="font-medium text-foreground">{workspaceSlug || "your-workspace"}</span>
              </p>

              <Button className="w-full" size="lg" asChild disabled={!workspaceSlug}>
                <a href={workspaceSlug ? `/api/bitbucket/oauth?workspace=${encodeURIComponent(workspaceSlug)}` : "#"}>
                  <IconBrandBitbucket className="mr-2 size-4" />
                  Connect Bitbucket workspace
                  <IconArrowRight className="ml-2 size-4" />
                </a>
              </Button>

              <p className="text-muted-foreground text-center text-xs">
                Secure access only - we never store your code.
              </p>
            </div>
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
              <IconBrandBitbucket className="size-6 text-[#0052CC] dark:text-[#79B8FF]" />
            </div>
            <div>
              <CardTitle className="text-base">Bitbucket</CardTitle>
              <CardDescription>
                Connected to <span className="font-medium">{data.workspaceName}</span>
                {" "}
                <span className="text-muted-foreground">({data.workspaceSlug})</span>
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
                disconnectBitbucket();
              });
            }}
          >
            Disconnect Bitbucket
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
