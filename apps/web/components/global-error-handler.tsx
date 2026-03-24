"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function GlobalErrorHandler() {
  useEffect(() => {
    const isWebGLError = (msg: string) =>
      /webgl|could not create a webgl context/i.test(msg);

    const handleError = (event: ErrorEvent) => {
      // Prevent the default browser error overlay / white screen
      event.preventDefault();

      const message = event.error?.message ?? event.message ?? "";
      if (isWebGLError(message)) return;

      console.error("[GlobalErrorHandler]", event.error);
      toast.error("Something went wrong", {
        description: "An unexpected error occurred. Please refresh and try again.",
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();

      const message =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "");
      if (isWebGLError(message)) return;

      console.error("[GlobalErrorHandler] Unhandled rejection:", event.reason);
      toast.error("Something went wrong", {
        description: "An unexpected error occurred. Please refresh and try again.",
      });
    };

    // Press "H" to toggle WebGL on/off (dev testing for fallback UI)
    const handleKeyDown = process.env.NODE_ENV === "development"
      ? (e: KeyboardEvent) => {
          if (e.key === "h" || e.key === "H") {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if ((e.target as HTMLElement)?.isContentEditable) return;

            window.dispatchEvent(new Event("webgl-toggle"));
          }
        }
      : null;

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    if (handleKeyDown) window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      if (handleKeyDown) window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}
