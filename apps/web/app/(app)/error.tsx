
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"
    >
      <IconAlertTriangle
        aria-hidden="true"
        className="size-10 text-destructive"
      />

      <div>
        <h2 className="text-lg font-semibold">
          Something went wrong
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
      </div>

      <Button onClick={reset} variant="outline" size="sm">
        <IconRefresh aria-hidden="true" className="mr-1 size-3" />
        Try again
      </Button>
    </div>
  );
}
