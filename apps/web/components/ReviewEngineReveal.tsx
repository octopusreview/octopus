"use client";

import { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { ReviewEnginePlayer } from "./ReviewEnginePlayer";

export function ReviewEngineReveal() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-12">
      {/* Collapsible content */}
      <div
        className="grid transition-all duration-700 ease-in-out"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/[0.06] pt-12">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
                Under the Hood
              </span>
              <h3 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                The Review Engine
              </h3>
              <p className="mt-3 text-sm text-[#888]">
                9 phases, fully automated. From webhook to PR comment in under 2 minutes.
              </p>
            </div>
            <div className="mt-10">
              {open && <ReviewEnginePlayer autoPlay loop showControls />}
            </div>
          </div>
        </div>
      </div>

      {/* Tab button with shimmer */}
      <div className="flex justify-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="group relative -mb-[52px] mt-8 flex items-center gap-2 overflow-hidden rounded-full border border-teal-500/20 bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-[#999] transition-all hover:border-teal-400/40 hover:text-white hover:shadow-[0_0_20px_rgba(20,184,166,0.15)]"
        >
          {/* Shimmer sweep */}
          {!open && (
            <span
              className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_3s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-teal-400/15 to-transparent"
            />
          )}
          {open ? "Hide" : "See how the engine works"}
          <IconChevronDown
            className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}
