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

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
