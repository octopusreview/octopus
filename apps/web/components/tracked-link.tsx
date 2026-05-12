"use client";

import Link from "@/components/link";
import { trackEvent } from "@/lib/analytics";

export function TrackedLink({
  href,
  event,
  eventParams,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  event: string;
  eventParams?: Record<string, string>;
}) {
  return (
    <Link
      href={href}
      onClick={() => trackEvent(event, eventParams)}
      {...props}
    >
      {children}
    </Link>
  );
}

export function TrackedAnchor({
  event,
  eventParams,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  event: string;
  eventParams?: Record<string, string>;
}) {
  return (
    <a
      onClick={() => trackEvent(event, eventParams)}
      {...props}
    >
      {children}
    </a>
  );
}
