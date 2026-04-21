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
import { disconnectJira } from "./actions";

type JiraData = {
  siteName: string;
} | null;

function JiraLogo() {
  return (
    <div className="flex size-10 items-center justify-center rounded-md bg-[#0052CC]">
      <svg
        width="20"
        height="20"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="#fff"
          d="M15.1 13.4 7.6 5.9 6.9 5.2h16.7c0 1.8-.7 3.5-2 4.8l-6.5 6.6c-2.6-1.1-5.8-.5-7.9 1.6L3 22.4l-.7.7V8.5c1.8 0 3.5.7 4.8 2l7.9 7.9z"
        />
        <path
          fill="#fff"
          d="M16.3 16.3c-2.6-1.1-5.8-.5-7.9 1.6l-5.8 5.8H20c0-1.8-.7-3.5-2-4.8l-1.8-2.6z"
        />
      </svg>
    </div>
  );
}

export function JiraIntegrationCard({ data }: { data: JiraData }) {
  const [isPending, startTransition] = useTransition();

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <JiraLogo />
            <div>
              <CardTitle className="text-base">Jira</CardTitle>
              <CardDescription>
                Create Jira issues directly from code review findings.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <a href="/api/jira/oauth">
            <Button>Connect Jira</Button>
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <JiraLogo />
            <div>
              <CardTitle className="text-base">Jira</CardTitle>
              <CardDescription>
                Connected to <span className="font-medium">{data.siteName}</span>
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="text-green-700 bg-green-100">
            Connected
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              disconnectJira();
            });
          }}
        >
          Disconnect Jira
        </Button>
      </CardContent>
    </Card>
  );
}
