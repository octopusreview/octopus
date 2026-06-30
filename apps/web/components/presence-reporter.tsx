"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { categorizePath } from "@/lib/activity-category";

const HEARTBEAT_MS = 30_000;

/**
 * Mounted once in the authenticated app layout. Pings /api/presence/heartbeat
 * every ~30s with the COARSE current area (route category only). The server
 * gates collection; if it reports telemetry inactive (free/disabled org), this
 * stops heartbeating for the session. Renders nothing.
 */
export function PresenceReporter({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  // Keep the ref current without touching it during render (the interval reads
  // the latest path at beat time without restarting on every navigation).
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!orgId) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const beat = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activity: categorizePath(pathnameRef.current) }),
          keepalive: true,
        });
        // Auth-terminal: session expired or membership revoked — stop polling
        // for the life of the tab rather than hammering an endpoint that will
        // never succeed. (5xx is transient → keep retrying on the next tick.)
        if (res.status === 401 || res.status === 403) {
          stopped = true;
          if (timer) clearInterval(timer);
          return;
        }
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { telemetry?: boolean } | null;
          if (data && data.telemetry === false) {
            stopped = true;
            if (timer) clearInterval(timer);
          }
        }
      } catch {
        // Network blip — retry on the next tick.
      }
    };

    void beat();
    timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [orgId]);

  return null;
}
