"use client";

import { IconMessageCircle } from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";

export function DocsAskAi() {
  return (
    <button
      onClick={() => {
        trackEvent("docs_ask_ai_click", { location: "docs_floating" });
        window.dispatchEvent(new Event("ask-octopus-open"));
      }}
      className="group fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#111] px-4 py-2.5 text-sm text-[#ccc] shadow-lg shadow-black/40 backdrop-blur transition-colors hover:border-[#10D8BE]/40 hover:bg-[#161616] hover:text-white"
      aria-label="Ask AI"
    >
      <IconMessageCircle className="size-4 text-[#10D8BE]" />
      <span className="font-medium">Ask AI</span>
    </button>
  );
}
