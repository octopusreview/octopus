"use client";

import { ErrorFallback, type BoundaryError } from "@/components/error-fallback";

/**
 * error.tsx boundaries never catch errors thrown in their own segment's
 * layout.tsx, only in nested segments. This root-level boundary exists so
 * that an error thrown in a route-group layout (e.g. (app)/layout.tsx, whose
 * database calls can fail) has somewhere to land instead of blanking the page.
 */
export default function RootError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} className="min-h-screen px-4" />;
}
