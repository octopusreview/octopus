"use client";

import { ErrorFallback, type BoundaryError } from "@/components/error-fallback";

export default function AppError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />;
}
