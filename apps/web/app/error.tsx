"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

/**
 * error.tsx boundaries never catch errors thrown in their own segment's
 * layout.tsx — only in nested segments. This root-level boundary exists so
 * that an error thrown in a route-group layout (e.g. (app)/layout.tsx, which
 * does unguarded Prisma/GitHub-API calls) has somewhere to land instead of
 * blanking the page.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RootError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <IconAlertTriangle className="size-10 text-destructive" />
      <div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <IconRefresh className="mr-1 size-3" />
        Try again
      </Button>
    </div>
  );
}
