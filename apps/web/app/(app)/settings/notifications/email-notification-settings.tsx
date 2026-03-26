"use client";

import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { IconMail, IconMailOff } from "@tabler/icons-react";
import { toggleEmailNotification, toggleAllEmailNotifications } from "./actions";

type EmailPreference = {
  eventType: string;
  enabled: boolean;
};

const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  "review-requested": {
    label: "Review Requested",
    description: "When a new PR review is triggered",
  },
  "review-completed": {
    label: "Review Completed",
    description: "When a PR review finishes with findings",
  },
  "review-failed": {
    label: "Review Failed",
    description: "When a PR review encounters an error",
  },
  "repo-indexed": {
    label: "Repository Indexed",
    description: "When a repository finishes indexing",
  },
  "repo-analyzed": {
    label: "Repository Analyzed",
    description: "When a repository analysis completes",
  },
  "knowledge-ready": {
    label: "Knowledge Document Ready",
    description: "When a knowledge document is processed",
  },
};

export function EmailNotificationSettings({
  preferences,
  userEmail,
}: {
  preferences: EmailPreference[];
  userEmail: string;
}) {
  const [isPending, startTransition] = useTransition();

  const allEventTypes = Object.keys(EVENT_LABELS);
  const allDisabled = allEventTypes.every((eventType) => {
    const pref = preferences.find((p) => p.eventType === eventType);
    return pref ? !pref.enabled : false; // default is enabled
  });

  const allEnabled = allEventTypes.every((eventType) => {
    const pref = preferences.find((p) => p.eventType === eventType);
    return pref ? pref.enabled : true; // default is enabled
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
              <IconMail className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base">Email Notifications</CardTitle>
              <CardDescription>
                Notifications will be sent to{" "}
                <span className="font-medium">{userEmail}</span>
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick toggle all */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || allEnabled}
            onClick={() => {
              startTransition(() => {
                toggleAllEmailNotifications(true);
              });
            }}
          >
            Enable All
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || allDisabled}
            onClick={() => {
              startTransition(() => {
                toggleAllEmailNotifications(false);
              });
            }}
          >
            <IconMailOff className="mr-1.5 size-4" />
            Disable All
          </Button>
        </div>

        {/* Event toggles */}
        <div className="space-y-4">
          {Object.entries(EVENT_LABELS).map(
            ([eventType, { label, description }]) => {
              const pref = preferences.find((p) => p.eventType === eventType);
              const enabled = pref?.enabled ?? true;

              return (
                <div
                  key={eventType}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-xs text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={isPending}
                    onCheckedChange={(checked) => {
                      startTransition(() => {
                        toggleEmailNotification(eventType, checked);
                      });
                    }}
                  />
                </div>
              );
            },
          )}
        </div>
      </CardContent>
    </Card>
  );
}
