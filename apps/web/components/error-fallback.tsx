"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BoundaryError = Error & { digest?: string };

/**
 * An error that a boundary catches no longer reaches the window error handler, so it is
 * reported here. An error with a digest came from the server, which has already reported it.
 */
export function reportBoundaryError(error: BoundaryError): void {
  if (!error.digest) Sentry.captureException(error);
}

/** Shared body of the route error boundaries. */
export function ErrorFallback({
  error,
  retry,
  title = "Something went wrong",
  description = "An unexpected error occurred. Please try again.",
  className = "min-h-[60vh]",
}: {
  error: BoundaryError;
  retry: () => void;
  title?: string;
  description?: string;
  className?: string;
}) {
  useEffect(() => reportBoundaryError(error), [error]);

  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-4 text-center", className)}>
      <IconAlertTriangle aria-hidden className="size-10 text-destructive" />
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {/* retry() fetches the route again; reset() would only re-render the same failed result. */}
      <Button onClick={() => retry()} variant="outline" size="sm">
        <IconRefresh aria-hidden className="mr-1 size-3" />
        Try again
      </Button>
    </div>
  );
}
