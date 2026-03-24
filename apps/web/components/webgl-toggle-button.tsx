"use client";

import { useState, useEffect } from "react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext;
  } catch {
    return false;
  }
}

export function WebGLToggleButton() {
  const [hidden, setHidden] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isWebGLAvailable());
    const onToggle = () => setHidden((v) => !v);
    window.addEventListener("webgl-toggle", onToggle);
    return () => window.removeEventListener("webgl-toggle", onToggle);
  }, []);

  // Don't show the toggle if WebGL isn't available — there's nothing to toggle
  if (!supported) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] text-[#444] sm:inline">
        Press <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 font-mono text-[10px] text-[#555]">H</kbd> to toggle
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("webgl-toggle"))}
        className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-[#555] transition-colors hover:border-white/[0.15] hover:text-[#888]"
      >
        {hidden ? (
          <IconEyeOff className="size-3.5" />
        ) : (
          <IconEye className="size-3.5" />
        )}
        {hidden ? "Show 3D" : "Hide 3D"}
      </button>
    </div>
  );
}
