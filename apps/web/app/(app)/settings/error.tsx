"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SettingsError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <IconAlertTriangle className="size-10 text-destructive" />
      <div>
        <h2 className="text-lg font-semibold">Couldn&apos;t load settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. Please try again.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <IconRefresh className="mr-1 size-3" />
        Try again
      </Button>
    </div>
  );
}
