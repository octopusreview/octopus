"use client";

import { useEffect, useState } from "react";
import Link from "@/components/link";
import { IconBroadcast } from "@tabler/icons-react";

/**
 * Per-user notice shown app-wide when the member's current org has live activity
 * monitoring enabled (and the member hasn't opted out — computed server-side in
 * the layout). Informs the member they may be visible and links to the opt-out.
 * Dismissal is client-side (localStorage, keyed by org) — no schema needed; it
 * reappears for a different org so each workspace is disclosed once.
 */
export function TelemetryNotice({ orgId }: { orgId: string }) {
  const storageKey = `octopus.telemetryNoticeDismissed.${orgId}`;
  // Start hidden until mounted to avoid an SSR/client flash and to read storage.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(storageKey) !== "1");
    } catch {
      setShow(true);
    }
  }, [storageKey]);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // ignore — worst case the notice shows again next load
    }
    setShow(false);
  };

  return (
    <div className="sticky top-0 z-50">
      <div className="flex items-center justify-between gap-3 bg-sky-950 px-4 py-1.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <IconBroadcast className="size-3.5 shrink-0 text-sky-400" />
          <p className="truncate text-xs text-sky-200">
            Live activity monitoring is{" "}
            <span className="font-medium">on</span> for this organization — your
            admins can see when you&apos;re online and which area you&apos;re in
            (never content).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/settings/telemetry"
            className="rounded bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/30"
          >
            Manage
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-sky-300/70 hover:text-sky-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
