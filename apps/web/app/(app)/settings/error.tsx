"use client";

import { ErrorFallback, type BoundaryError } from "@/components/error-fallback";

export default function SettingsError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <ErrorFallback
      error={error}
      retry={retry}
      title="Couldn't load settings"
      description="An unexpected error occurred while loading this page. Please try again."
      className="min-h-[50vh]"
    />
  );
}
