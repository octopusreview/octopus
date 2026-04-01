"use client";

import { useTransition } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { IconSpeakerphone } from "@tabler/icons-react";
import { toggleMarketingEmails } from "./actions";

export function MarketingEmailToggle({ enabled }: { enabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
              <IconSpeakerphone className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base">Product Updates</CardTitle>
              <CardDescription>
                Tips, feature announcements, and other non-essential emails
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={enabled}
            disabled={isPending}
            onCheckedChange={(checked) => {
              startTransition(() => {
                toggleMarketingEmails(checked);
              });
            }}
          />
        </div>
      </CardHeader>
    </Card>
  );
}
