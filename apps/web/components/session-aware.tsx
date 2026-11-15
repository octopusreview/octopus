"use client";

import type { ReactNode } from "react";
import Link from "@/components/link";
import { useSession } from "@/lib/auth-client";

// Public pages are rendered once and cached, so the server never knows who is
// looking at them. It always renders the signed-out version; these components
// switch to the signed-in version in the browser once the session has loaded.

/** Shows one of two server-rendered pieces, depending on whether the visitor is signed in. */
export function SessionSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  const { data: session } = useSession();
  return <>{session ? signedIn : signedOut}</>;
}

/** A call-to-action link: to sign-in for a signed-out visitor, to the dashboard for a signed-in one. */
export function SessionLink({
  signedOutLabel,
  className,
}: {
  signedOutLabel: string;
  className?: string;
}) {
  const { data: session } = useSession();
  return (
    <Link href={session ? "/dashboard" : "/login"} className={className}>
      {session ? "Go to Dashboard" : signedOutLabel}
    </Link>
  );
}
