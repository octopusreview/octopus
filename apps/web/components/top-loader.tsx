"use client";

import { Suspense, useEffect, useRef, useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function TopLoaderInner({ color }: { color: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = pathname + "?" + searchParams.toString();

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStartRef = useRef(false);

  const start = useCallback(() => {
    pendingStartRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (safetyRef.current) clearTimeout(safetyRef.current);
    setProgress(0);
    setLoading(true);

    let p = 0;
    timerRef.current = setInterval(() => {
      if (p < 30) p += 8;
      else if (p < 60) p += 3;
      else if (p < 80) p += 1;
      else if (p < 95) p += 0.3;
      else {
        if (timerRef.current) clearInterval(timerRef.current);
      }
      setProgress(p);
    }, 100);

    safetyRef.current = setTimeout(() => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setProgress(100);
      timeoutRef.current = setTimeout(() => {
        setLoading(false);
        setProgress(0);
        timeoutRef.current = null;
      }, 300);
    }, 8000);
  }, []);

  const scheduleStart = useCallback(() => {
    pendingStartRef.current = true;
    if (scheduleRef.current) clearTimeout(scheduleRef.current);
    scheduleRef.current = setTimeout(() => {
      scheduleRef.current = null;
      if (pendingStartRef.current) {
        start();
      }
    }, 0);
  }, [start]);

  const done = useCallback(() => {
    // Cancel any pending start that hasn't fired yet
    pendingStartRef.current = false;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }

    setProgress(100);
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      setProgress(0);
      timeoutRef.current = null;
    }, 300);
  }, []);

  // Complete on route/search param change (string comparison for reliability)
  useEffect(() => {
    done();
  }, [urlKey, done]);

  // Intercept link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:")) return;
      if (anchor.target === "_blank") return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const url = new URL(href, window.location.origin);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      start();
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [start]);

  // Intercept history.pushState for router.push() calls
  useEffect(() => {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      const url = args[2];
      if (url) {
        const next = new URL(String(url), window.location.origin);
        const current = new URL(window.location.href);
        // Only start loader if pathname or search changed (ignore hash-only changes)
        const routeChanged = next.pathname !== current.pathname || next.search !== current.search;
        if (routeChanged && !timerRef.current) {
          scheduleStart();
        }
      }
      return originalPushState(...args);
    };
    return () => {
      history.pushState = originalPushState;
    };
  }, [scheduleStart]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (safetyRef.current) clearTimeout(safetyRef.current);
      if (scheduleRef.current) clearTimeout(scheduleRef.current);
    };
  }, []);

  if (!loading && progress === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: 3,
          background: color,
          width: `${progress}%`,
          transition:
            progress === 0
              ? "none"
              : progress === 100
                ? "width 150ms ease-out, opacity 300ms ease"
                : "width 200ms ease",
          opacity: progress === 100 ? 0 : 1,
          boxShadow: `0 0 8px ${color}, 0 0 4px ${color}`,
        }}
      />
    </div>
  );
}

export function TopLoader({ color = "var(--primary)" }: { color?: string }) {
  return (
    <Suspense fallback={null}>
      <TopLoaderInner color={color} />
    </Suspense>
  );
}
